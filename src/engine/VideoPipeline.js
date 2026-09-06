import { FrameSequencer } from './FrameSequencer.js';
import { ElementaryVideoWriter, chooseEncoderConfig } from './WebCodecsEngine.js';
import { QUALITY_PRESETS } from './FFmpegEngine.js';
import { MODEL_REGISTRY, imageDataToChwFloat32, chwFloat32ToImageData } from './UpscaleEngine.js';
import { applyRealtimeEffects } from './RealtimePreviewEngine.js';
import { muxIVFToWebM } from './WebMMuxer.js';
import { NativeMP4Muxer, supportsNativeAAC } from './NativeMP4Muxer.js';
import { SceneChangeDetector } from './SceneChangeDetector.js';
import { buildFFmpegGeometryFilters, drawWithGeometry, resolveAIWorkingSize, resolveOutputGeometry } from './GeometryEngine.js';
import { FramePacingMonitor, validateMP4Export, validateMP4Tracks } from './ExportValidator.js';
import { TemporalArtifactGuard, splitEffectsForPipeline } from './QualityEngine.js';
import { CPUFrameWorker } from './CPUFrameWorker.js';
import { RenderStabilityMonitor } from './RenderStabilityMonitor.js';
import { FrameIntegrityMonitor } from './FrameIntegrityMonitor.js';
import { RenderLoadGovernor } from './RenderLoadGovernor.js';
import { AdaptiveBackpressure } from './AdaptiveBackpressure.js';
import { createQualityLockFingerprint, assertQualityLockFingerprint } from './RenderFingerprint.js';
import { TypedArrayPool } from './TypedArrayPool.js';
import { ProgressWatchdog } from './CrashProofRuntime.js';
import { CrashProofFallbackPolicy } from './CrashProofFallbackPolicy.js';
import { crashProofUserMessage } from './CrashProofUserNotice.js';

export class VideoPipeline {
  constructor(engineManager) {
    this.manager = engineManager;
  }

  async run({ jobId, file, previewCanvas, settings }, context) {
    const { engines, signal, update, checkpoint, waitIfPaused } = context;
    const {
      storage,
      performance,
      codecs,
      gpu,
      webgl,
      upscale,
      rife,
      face,
      audio,
      ffmpeg,
      media,
      temporal,
      qualityMetrics,
      quality: qualityEngine,
      color,
      blur,
      stabilization,
      temporalReconstruction,
      resilience,
      fabric,
    } = engines;
    let writer = null;
    let nativeMp4 = null;
    let sequencer = null;
    let sourceURL = null;
    let video = null;
    let mediaSession = null;
    let sceneDetector = null;
    let audioPromise = null;
    let audioFailure = null;
    let nativeAudioStats = null;
    let temporalArtifactGuard = null;
    let ffmpegWasUsed = false;
    let nativeMuxFailure = null;
    let watchdogError = null;
    let renderWatchdog = null;
    let rifeWorkspace = null;
    const crashFallback = new CrashProofFallbackPolicy();
    const reportCrashProofFailure = (error, fallback = null) => {
      console.error('[BARSA][crash-proof]', error);
      this.manager.dispatchEvent(new CustomEvent('warning', { detail: { code: error?.code || 'RUNTIME_FAILURE', error, message: crashProofUserMessage(error, { fallback }) } }));
    };
    crashFallback.addEventListener('fallback', ({ detail }) => reportCrashProofFailure(detail.error, detail.to));
    const cpuFrameWorker = new CPUFrameWorker({ onFailure: (error) => reportCrashProofFailure(error, 'Canvas2D/main-thread') });
    const stability = new RenderStabilityMonitor();
    const renderGovernor = new RenderLoadGovernor();
    let frameIntegrity = null;
    resilience?.reset?.();
    try {
      update({ progress: 0.01, stage: 'analyzing' });
      let sourceMetadata;
      try {
        mediaSession = await media.open(file);
        sourceMetadata = mediaSession.metadata;
      } catch (mediaError) {
        // Production renders are frame-perfect by default. Random-access
        // HTMLVideo seeking can silently repeat/skip frames, so it is never
        // used unless the caller explicitly opts out of strict integrity.
        if (settings.frameIntegrity?.strict !== false) {
          throw new Error(`Frame-perfect decoder unavailable: ${mediaError?.message || mediaError}`);
        }
        const fallback = await loadVideo(file);
        ({ video, url: sourceURL } = fallback);
        sourceMetadata = {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          fps: await estimateFrameRate(video, signal),
          hasAudio: detectAudioTrack(video),
          variableFrameRate: null,
        };
      }
      const sourceFps = settings.sourceFps || sourceMetadata.fps;
      const blurConfiguration = normalizeBlurConfiguration(settings.blur, sourceFps, settings.targetFps || sourceFps);
      if (blurConfiguration.enabled && typeof rife.setExecutionPreference === 'function') {
        rife.setExecutionPreference(blurConfiguration.gpuInterpolation !== false);
      }
      const targetFps = blurConfiguration.enabled ? blurConfiguration.outputFps : (settings.targetFps || sourceFps);
      const processingFps = blurConfiguration.enabled
        ? (blurConfiguration.interpolation
          ? Math.max(sourceFps, targetFps, blurConfiguration.interpolationFps)
          : sourceFps)
        : targetFps;
      const nativeWidth = sourceMetadata.width;
      const nativeHeight = sourceMetadata.height;
      const duration = sourceMetadata.duration;
      const sourceHasAudio = sourceMetadata.hasAudio;
      const sourceFrameCount = Math.max(1, Math.ceil(duration * sourceFps));
      const resumeCheckpoint = settings.__resumeSession === true ? await storage.getCheckpoint(jobId).catch(() => null) : null;
      const resumeSourceFrameIndex = Math.max(0, Number(resumeCheckpoint?.resumeSourceFrameIndex ?? resumeCheckpoint?.sourceFrameIndex ?? 0) || 0);
      const resumeEncodedFrames = Math.max(0, Number(resumeCheckpoint?.framesWritten || resumeCheckpoint?.durableEncodedFrames || 0) || 0);
      const remuxRecovery = resumeCheckpoint?.status === 'remux_pending';
      const resuming = Boolean(resumeCheckpoint && !remuxRecovery && resumeEncodedFrames > 0 && resumeSourceFrameIndex >= 0);
      frameIntegrity = new FrameIntegrityMonitor({ sourceFps, targetFps, strict: settings.frameIntegrity?.strict !== false });
      if (resuming) frameIntegrity.seedResume({
        decodedFrames: resumeSourceFrameIndex, processedFrames: resumeSourceFrameIndex, encodedFrames: resumeEncodedFrames,
        lastOutputTimestamp: resumeCheckpoint.lastOutputTimestamp,
      });

      if (remuxRecovery) {
        const outputSize = resumeCheckpoint?.metadata?.outputSize || resolveOutputGeometry(nativeWidth, nativeHeight, settings);
        const qualityBase = QUALITY_PRESETS[settings.quality || 'BALANCED'];
        const requestedAudioBitrateK = Number(settings.export?.audioBitrateK);
        const quality = { ...qualityBase, audioBitrateK: Number.isFinite(requestedAudioBitrateK) && requestedAudioBitrateK >= 64 ? Math.min(320, requestedAudioBitrateK) : qualityBase.audioBitrateK };
        ffmpegWasUsed = true;
        return recoverPendingRemux({
          storage, ffmpeg, audio, media, jobId, file, settings, quality, outputSize,
          sourceFps, targetFps, duration, sourceHasAudio, resumeCheckpoint, signal, update,
        });
      }

      const upscaleStatus = settings.upscaleModelId
        ? await upscale.isAvailable(settings.upscaleModelId)
        : { available: false };
      const rifeStatus = settings.rifeModelId
        ? await rife.isAvailable(settings.rifeModelId)
        : { available: false };
      const faceStatus = settings.faceModelId
        ? await face.isAvailable(settings.faceModelId)
        : { available: false };
      if (blurConfiguration.enabled && targetFps > sourceFps + 0.01 && !blurConfiguration.interpolation) {
        throw new Error('Blur output above the source FPS requires Interpolation ON; duplicate-frame FPS is blocked');
      }
      const rifeActive = rifeStatus.available && processingFps > sourceFps + 0.01;
      if (processingFps > sourceFps + 0.01 && !rifeActive) {
        throw new Error(`Real ${processingFps.toFixed(2)} FPS generation requires a verified RIFE ONNX model; metadata-only FPS changes are blocked`);
      }
      if (settings.colorLab?.lutStrength > 0 && settings.colorLab?.lutHash && !color.isLutReady(settings.colorLab.lutHash)) {
        throw new Error('The selected .cube LUT must be imported again before rendering');
      }
      const outputSize = resolveOutputGeometry(nativeWidth, nativeHeight, settings);
      const aiUpscaleActive = upscaleStatus.available
        && (outputSize.width > nativeWidth || outputSize.height > nativeHeight);
      const outputFrameCount = FrameSequencer.estimateOutputFrameCount(sourceFrameCount, sourceFps, targetFps);
      const qualityBase = QUALITY_PRESETS[settings.quality || 'BALANCED'];
      const requestedAudioBitrateK = Number(settings.export?.audioBitrateK);
      const quality = { ...qualityBase, audioBitrateK: Number.isFinite(requestedAudioBitrateK) && requestedAudioBitrateK >= 64 ? Math.min(320, requestedAudioBitrateK) : qualityBase.audioBitrateK };
      const automaticBitrate = outputSize.width * outputSize.height * targetFps * quality.bitsPerPixel;
      const requestedMbps = Number(settings.export?.videoBitrateMbps);
      const bitrate = Math.round(settings.export?.videoMode === 'custom' && Number.isFinite(requestedMbps) && requestedMbps > 0
        ? Math.min(240, requestedMbps) * 1_000_000
        : automaticBitrate * (settings.export?.videoMode === 'max' ? 1.35 : 1));
      const resolvedEffects = qualityEngine.resolve(settings.effects || {}, settings.qualityLab);
      const effectStages = splitEffectsForPipeline({
        ...resolvedEffects,
        ...gpuColorSettings(settings.colorLab, resolvedEffects),
      });
      const temporalMaster = normalizeTemporalMaster(settings.temporalMaster);
      if (temporalMaster.enabled) {
        effectStages.temporal.temporalDenoise = Math.max(effectStages.temporal.temporalDenoise || 0, temporalMaster.strength * 0.72);
        effectStages.temporal.antiFlicker = Math.max(effectStages.temporal.antiFlicker || 0, temporalMaster.strength * 0.58);
        effectStages.temporal.temporalDetailStability = Math.max(effectStages.temporal.temporalDetailStability || 0, temporalMaster.strength * 0.90);
      }
      const qualityWarnings = qualityEngine.inspectSettings(effectStages.finish);
      const estimatedVideoBytes = bitrate * duration / 8;
      const workspaceMultiplier = sourceHasAudio && settings.audioEnabled !== false ? 2.4 : 1.65;
      await storage.assertCapacity(file.size + estimatedVideoBytes * workspaceMultiplier);
      let encoderConfig;
      try {
        encoderConfig = await chooseEncoderConfig({
          width: outputSize.width,
          height: outputSize.height,
          framerate: targetFps,
          bitrate,
          preferred: settings.outputFormat === 'webm' ? ['vp9', 'av1', 'avc'] : ['avc', 'vp9', 'av1'],
          acceleration: settings.export?.acceleration || blurConfiguration.encoderSelection || 'auto',
        });
      } catch (encoderError) {
        if (aiUpscaleActive || rifeActive || faceStatus.available || blurConfiguration.enabled || color.needsPass(cpuColorSettings(settings.colorLab))) {
          throw new Error('WebCodecs encoding is required for per-frame AI on this device');
        }
        ffmpegWasUsed = true;
        return runFFmpegOnly({
          storage,
          ffmpeg,
          audio,
          media,
          jobId,
          file,
          settings,
          quality,
          outputSize,
          sourceFps,
          targetFps,
          duration,
          sourceHasAudio,
          resolvedEffects: {
            ...resolvedEffects,
            ...gpuColorSettings(settings.colorLab, resolvedEffects),
          },
          signal,
          update,
        });
      }

      // Keep Android hardware codecs and the OPFS writer from building a
      // large in-memory backlog. 4K/120fps uses the strictest queue.
      const outputPixels = outputSize.width * outputSize.height;
      const safetyPlan = renderGovernor.plan({
        width: outputSize.width, height: outputSize.height, fps: targetFps,
        aiUpscale: aiUpscaleActive, rife: rifeActive, face: faceStatus.available,
        deviceMemoryGB: this.manager.capabilities?.deviceMemoryGB,
        deviceProfile: this.manager.capabilities?.deviceProfile,
      });
      const renderPlan = fabric?.plan?.({
        safetyPlan, width: outputSize.width, height: outputSize.height, fps: targetFps,
        aiUpscale: aiUpscaleActive, rife: rifeActive, face: faceStatus.available,
      }) || safetyPlan;
      const safeCodecQueue = renderPlan.codecQueue; // compatibility alias used by v8.1 stability audit
      const qualityLockFingerprint = await createQualityLockFingerprint({
        settings, width: outputSize.width, height: outputSize.height, fps: targetFps, bitrate,
        models: { upscale: settings.upscaleModelId || null, rife: settings.rifeModelId || null, face: settings.faceModelId || null },
      });
      if (resuming && resumeCheckpoint?.qualityLockFingerprint) {
        assertQualityLockFingerprint(resumeCheckpoint.qualityLockFingerprint, qualityLockFingerprint, { phase: 'resume' });
      }
      codecs.setMaxQueueSize?.(safeCodecQueue);
      update({ stage:'render-plan', detail:`${renderPlan.tier} · load ${renderPlan.loadScore} · queue ${renderPlan.codecQueue} · tile ${renderPlan.tileSize || engines.tiles.tileSize} · RAM ${renderPlan.memoryBudgetMB || '—'} MB` });

      writer = new ElementaryVideoWriter({
        storage,
        sessionId: jobId,
        codec: encoderConfig.codec,
        width: outputSize.width,
        height: outputSize.height,
        fps: targetFps,
        expectedFrames: outputFrameCount,
        checkpointEvery: renderPlan.checkpointEvery,
      });
      await writer.initialize({
        jobOptions: sanitizeSettings({ ...settings, __resumeSession: false }),
        sourceName: file.name,
        duration,
        sourceFps,
        targetFps,
        processingFps,
        blur: blurConfiguration.enabled ? blurConfiguration : null,
        outputSize,
      }, { resume: resuming });
      if (!resuming) {
        await storage.cacheSourceFile(jobId, file, ({ progress }) => {
          update({ progress: 0.01 + progress * 0.04, stage: 'caching-source' });
        });
      } else {
        update({ progress: Math.max(.05, Number(resumeCheckpoint.progress || .05)), stage: 'resume-verified', detail: `متابعة من الإطار ${resumeSourceFrameIndex}` });
      }

      const wantsAudio = sourceHasAudio && settings.audioEnabled !== false;
      const nativeAAC = wantsAudio
        && Boolean(mediaSession?.metadata.audioDecodable)
        && await supportsNativeAAC({ bitrate: quality.audioBitrateK * 1000 });
      const canUseNativeMp4 = !resuming && (settings.outputFormat || 'mp4') === 'mp4'
        && encoderConfig.codec.startsWith('avc1')
        && (!wantsAudio || nativeAAC);
      if (canUseNativeMp4) {
        const cleanAudio = settings.audio?.enabled !== false;
        const streamProcessor = nativeAAC && cleanAudio ? audio.createStreamingProcessor(settings.audio || {}) : null;
        nativeMp4 = new NativeMP4Muxer({
          width: outputSize.width,
          height: outputSize.height,
          fps: targetFps,
          codec: encoderConfig.codec,
          expectedFrames: outputFrameCount,
          storage,
          sessionId: jobId,
          audio: nativeAAC ? {
            sampleRate: 48000,
            numberOfChannels: 2,
            bitrate: quality.audioBitrateK * 1000,
            maximumPacketCount: Math.ceil(duration * 100),
            process: streamProcessor?.process || undefined,
          } : null,
        });
        try {
          await nativeMp4.initialize();
          if (nativeAAC) {
            audioPromise = streamAudioTrack(mediaSession, nativeMp4, signal)
              .then((timeline) => { nativeAudioStats = { ...(streamProcessor?.stats?.() || {}), ...timeline, codec: 'AAC-LC', sampleRate: 48000, cleaned: cleanAudio }; })
              .catch((error) => { audioFailure = error; });
          }
        } catch (error) {
          nativeMuxFailure ||= error;
          await nativeMp4.cancel().catch(() => {});
          nativeMp4 = null;
        }
      }

      let writeChain = Promise.resolve();
      let writeBacklog = 0;
      let writeError = null;
      let maxWriteBacklog = renderPlan.writeBacklog;
      const backpressure = new AdaptiveBackpressure({ maxLimit: renderPlan.writeBacklog, targetWriteMs: Math.max(8, 1000 / Math.max(24, targetFps)) });
      let runtimeTileConcurrency = renderPlan.tileConcurrency;
      const waitForWriteBackpressure = async () => {
        while (writeBacklog >= maxWriteBacklog) {
          abortIfNeeded(signal);
          if (writeError) throw writeError;
          await new Promise((resolve) => setTimeout(resolve, 4));
        }
        if (writeError) throw writeError;
      };
      await codecs.createEncoder({
        config: encoderConfig,
        onChunk: (chunk, metadata) => {
          writeBacklog++;
          const task = writeChain.then(async () => {
            const writeStartedAt = globalThis.performance?.now?.() ?? Date.now();
            try {
              // The elementary stream is the durable recovery copy. Never let a
              // Native MP4 mux failure poison it: disable only the native mux and
              // keep writing H.264 so FFmpeg can salvage the completed render.
              await writer.write(chunk);
              if (nativeMp4) {
                try {
                  await nativeMp4.addChunk(chunk, metadata);
                } catch (error) {
                  nativeMuxFailure ||= error;
                  const failedMux = nativeMp4;
                  nativeMp4 = null;
                  await failedMux.cancel().catch(() => {});
                }
              }
            } finally {
              const elapsedMs = Math.max(0, (globalThis.performance?.now?.() ?? Date.now()) - writeStartedAt);
              maxWriteBacklog = backpressure.observeWrite(elapsedMs);
              const storageState = this.manager.storageGovernor?.observeWrite?.(elapsedMs, Number(chunk?.byteLength || 0));
              if (storageState) maxWriteBacklog = Math.min(maxWriteBacklog, this.manager.storageGovernor.queueCap(renderPlan.writeBacklog));
            }
          });
          writeChain = task
            .catch((error) => { writeError ||= error; })
            .finally(() => { writeBacklog = Math.max(0, writeBacklog - 1); });
        },
        onError: (error) => this.manager.dispatchEvent(new CustomEvent('warning', { detail: { code: 'ENCODER', error } })),
      });

      const nativeCanvas = new OffscreenCanvas(nativeWidth, nativeHeight);
      const nativeContext = nativeCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
      const faceCanvas = new OffscreenCanvas(nativeWidth, nativeHeight);
      const faceContext = faceCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
      const gpuCanvas = new OffscreenCanvas(nativeWidth, nativeHeight);
      const webglCanvas = new OffscreenCanvas(nativeWidth, nativeHeight);
      let effectsBackend = 'canvas2d';
      let webglReady = false;
      if (this.manager.capabilities.webGL2) {
        try { webgl.init(webglCanvas, { performanceManager: performance }); webglReady = true; } catch (error) { reportCrashProofFailure(error, 'Canvas2D'); }
      }
      if (this.manager.capabilities.webGPU) {
        try {
          await gpu.init(gpuCanvas, { performanceManager: performance });
          effectsBackend = 'webgpu';
          gpu.onFatalLoss = (error) => { const fallback = webglReady ? 'WebGL2' : 'Canvas2D'; effectsBackend = webglReady ? 'webgl2' : 'canvas2d'; reportCrashProofFailure(error, fallback); };
        } catch (error) { reportCrashProofFailure(error, webglReady ? 'WebGL2' : 'Canvas2D'); }
      }
      if (effectsBackend === 'canvas2d' && webglReady) effectsBackend = 'webgl2';

      // Lazy warmup loads only the models selected for this render. Running
      // these sequentially avoids a simultaneous allocation spike on phones.
      if (rifeActive) await rife.warmup?.(settings.rifeModelId);
      if (faceStatus.available) await face.warmup?.(settings.faceModelId);
      if (aiUpscaleActive) await upscale.warmup?.(settings.upscaleModelId);
      temporalArtifactGuard = rifeActive ? new TemporalArtifactGuard() : null;
      if (blurConfiguration.enabled) {
        blur.configure({
          ...blurConfiguration,
          width: nativeWidth,
          height: nativeHeight,
          inputFps: processingFps,
          outputFps: targetFps,
          gpuDevice: effectsBackend === 'webgpu' ? gpu.device : null,
          maxSamples: Math.min(renderPlan.blurSamples, performance.getAdaptiveSettings().batchSize > 1 ? 24 : 12),
        });
      }

      // Never render the full-resolution encode surface directly into the visible
      // UI canvas. On mobile, a 4K/60 render would otherwise force the WebView to
      // paint a 4K canvas for every encoded frame, causing jank and heat even
      // though that extra display work has no effect on export quality.
      const outputCanvas = new OffscreenCanvas(outputSize.width, outputSize.height);
      const outputContext = outputCanvas.getContext('2d', { alpha: false, willReadFrequently: color.needsPass(cpuColorSettings(settings.colorLab)) });
      const renderPreview = createThrottledRenderPreview(previewCanvas, outputSize, {
        maxLongEdge: renderPlan.previewLongEdge || (renderPlan.tier === 'EXTREME' ? 720 : 960),
        maxFps: renderPlan.previewMaxFps || (renderPlan.tier === 'EXTREME' ? 5 : renderPlan.tier === 'HEAVY' ? 8 : 12),
      });
      const upscaleConfig = aiUpscaleActive ? MODEL_REGISTRY[settings.upscaleModelId] : null;
      // Final-render quality lock: performance adaptation may change queue
      // depth/concurrency/preview load, but never the neural tiling geometry.
      // Tile geometry can subtly affect boundary pixels even with overlap, so
      // it stays deterministic for the selected model on every device.
      const qualityLockedTileSize = aiUpscaleActive
        ? Math.max(32, Number(upscaleConfig.tileSize || engines.tiles.tileSize || 256))
        : null;
      const aiWork = aiUpscaleActive
        ? resolveAIWorkingSize(nativeWidth, nativeHeight, upscaleConfig.scale)
        : null;
      const aiInputCanvas = aiUpscaleActive
        ? new OffscreenCanvas(aiWork.inputWidth, aiWork.inputHeight)
        : null;
      const aiInputContext = aiInputCanvas?.getContext('2d', { alpha: false, willReadFrequently: true }) || null;
      const aiCanvas = aiUpscaleActive
        ? new OffscreenCanvas(aiWork.outputWidth, aiWork.outputHeight)
        : null;
      const aiContext = aiCanvas?.getContext('2d', { alpha: false, willReadFrequently: false }) || null;
      const frameDurationUs = Math.round(1_000_000 / targetFps);
      const framePacing = new FramePacingMonitor(targetFps);
      if (resuming) framePacing.seedResume({ frames: resumeEncodedFrames, lastTimestamp: resumeCheckpoint.lastOutputTimestamp });
      const keyFrameInterval = Math.max(1, Math.round(targetFps * 2));
      let encodedFrames = resuming ? resumeEncodedFrames : 0;
      const encodedFramesAtResume = encodedFrames;
      renderWatchdog = new ProgressWatchdog({
        timeoutMs: Math.max(15_000, Math.round(8_000 + 4 * 1000 / Math.max(1, targetFps))),
        pollMs: 500,
        label: 'video render frame pipeline',
        onStall: async (error) => {
          watchdogError = error;
          reportCrashProofFailure(error);
          cpuFrameWorker.destroy(error);
          try { gpu.destroy?.(); } catch (cleanupError) { console.error('[BARSA][watchdog][gpu-cleanup-failed]', cleanupError); }
          try { webgl.destroy?.(); } catch (cleanupError) { console.error('[BARSA][watchdog][webgl-cleanup-failed]', cleanupError); }
        },
      }).start(encodedFrames);
      let temporalFrames = 0;
      let temporalSceneResets = 0;
      let colorDiagnostics = { applied: false };
      let activeCleanupEffects = effectStages.cleanup;
      let activeFinishEffects = effectStages.finish;
      let lastSceneMetrics = null;
      let temporalFallbacks = 0;
      let lastProgressUiAt = 0;
      const reportRenderProgress = (payload, force = false) => {
        const now = globalThis.performance?.now?.() ?? Date.now();
        if (!force && now - lastProgressUiAt < 125) return false;
        lastProgressUiAt = now;
        update(payload);
        return true;
      };

      const renderOutput = async ({ frame, timestamp }) => {
        if (watchdogError) throw watchdogError;
        abortIfNeeded(signal);
        await waitIfPaused();
        nativeContext.clearRect(0, 0, nativeWidth, nativeHeight);
        nativeContext.drawImage(frame, 0, 0, nativeWidth, nativeHeight);
        let sourceCanvas = nativeCanvas;

        if (faceStatus.available) {
          await face.restoreFrame(settings.faceModelId, nativeCanvas, faceContext, {
            strength: settings.faceStrength ?? 0.7,
            faceDetail: enabledStrength(settings.faceLab?.faceDetail),
            skinCleanup: enabledStrength(settings.faceLab?.skinCleanup),
            skinSmoothing: enabledStrength(settings.faceLab?.skinSmoothing),
            microContrast: enabledStrength(settings.faceLab?.microContrast),
            skinToneProtect: enabledStrength(settings.faceLab?.skinToneProtect),
            eyeDetail: enabledStrength(settings.faceLab?.eyeDetail),
            hairDetail: enabledStrength(settings.faceLab?.hairDetail),
            signal,
          });
          sourceCanvas = faceCanvas;
        }

        if (aiUpscaleActive) {
          aiInputContext.clearRect(0, 0, aiWork.inputWidth, aiWork.inputHeight);
          aiInputContext.drawImage(sourceCanvas, 0, 0, aiWork.inputWidth, aiWork.inputHeight);
          await upscale.upscaleFrame(
            settings.upscaleModelId,
            aiInputContext,
            aiWork.inputWidth,
            aiWork.inputHeight,
            aiContext,
            {
              tileSize: qualityLockedTileSize,
              overlap: MODEL_REGISTRY[settings.upscaleModelId].overlap,
              concurrency: Math.min(runtimeTileConcurrency, engines.tiles.batchSize),
              signal,
            },
          );
          drawWithGeometry(aiCanvas, outputContext, outputSize, aiCanvas.width, aiCanvas.height);
        } else {
          drawWithGeometry(sourceCanvas, outputContext, outputSize, nativeWidth, nativeHeight);
        }

        // Detail, sharpening and color deliberately run after AI reconstruction
        // and temporal Blur so compression residue is never sharpened first.
        if (effectsBackend === 'webgpu') {
          try {
            gpu.renderFrame(outputCanvas, activeFinishEffects, { width: outputSize.width, height: outputSize.height }, { releaseSource: false });
            outputContext.drawImage(gpuCanvas, 0, 0, outputSize.width, outputSize.height);
          } catch (error) {
            resilience?.noteBackendFallback?.();
            const fallback = webglReady ? 'WebGL2' : 'Canvas2D';
            effectsBackend = webglReady ? 'webgl2' : 'canvas2d';
            reportCrashProofFailure(error, fallback);
          }
        }
        if (effectsBackend === 'webgl2') {
          try {
            webgl.renderFrame(outputCanvas, activeFinishEffects, { width: outputSize.width, height: outputSize.height });
            outputContext.drawImage(webglCanvas, 0, 0, outputSize.width, outputSize.height);
          } catch (error) {
            resilience?.noteBackendFallback?.();
            effectsBackend = 'canvas2d';
            reportCrashProofFailure(error, 'Canvas2D');
          }
        }
        const cpuColor = cpuColorSettings(settings.colorLab);
        const compiledColor = color.compileForWorker(cpuColor);
        if (effectsBackend === 'canvas2d' || compiledColor) {
          const image = outputContext.getImageData(0, 0, outputSize.width, outputSize.height);
          const workerImage = await cpuFrameWorker.process(image, {
            effects: effectsBackend === 'canvas2d' ? activeFinishEffects : null,
            compiledColor,
            signal,
          }).catch((error) => {
            reportCrashProofFailure(error, 'Canvas2D/main-thread');
            return null;
          });
          if (workerImage) {
            outputContext.putImageData(workerImage, 0, 0);
            colorDiagnostics = compiledColor ? { applied: true, backend: 'worker', precision: 'float32-intermediate', colorSpace: 'BT.709/sRGB SDR', lut: compiledColor.lut ? color.activeLutInfo : null, curves: compiledColor.curvesActive } : { applied: false };
          } else {
            if (effectsBackend === 'canvas2d') {
              applyRealtimeEffects(image, activeFinishEffects);
              outputContext.putImageData(image, 0, 0);
            }
            colorDiagnostics = await color.applyToCanvas(outputCanvas, outputContext, cpuColor, { signal });
          }
        } else {
          colorDiagnostics = { applied: false };
        }
        qualityMetrics.sample(outputCanvas, encodedFrames);
        renderPreview?.draw(outputCanvas, timestamp);

        const normalizedTimestamp = Math.max(0, Math.round(timestamp));
        framePacing.observe(normalizedTimestamp);
        frameIntegrity.observeEncoded(normalizedTimestamp);
        const encodedFrame = new VideoFrame(outputCanvas, {
          timestamp: normalizedTimestamp,
          duration: frameDurationUs,
        });
        const nextEncodedFrame = encodedFrames + 1;
        const durableProgress = 0.08 + nextEncodedFrame / Math.max(1, outputFrameCount) * 0.74;
        writer.stageResumeMetadata(nextEncodedFrame, {
          progress: durableProgress,
          stage: 'processing',
          sourceFrameIndex: currentSourceIndex,
          resumeSourceFrameIndex: currentSourceIndex,
          sourceTimestampOrigin,
          nextOutputTimestamp: sequencer?.nextOutputTimestamp ?? null,
          lastOutputTimestamp: normalizedTimestamp,
          renderPlan,
          qualityLockFingerprint,
          durableResume: writer.format === 'annexb-h264',
        });
        await waitForWriteBackpressure();
        await codecs.encode(encodedFrame, {
          keyFrame: (resuming && encodedFrames === encodedFramesAtResume) || encodedFrames % keyFrameInterval === 0,
          signal,
        });
        encodedFrames++;
        renderWatchdog?.progress(encodedFrames);
        performance.recordFrame();
        stability.sample(encodedFrames, codecs.encoder?.encodeQueueSize || 0);
        const resilienceAction = resilience?.evaluate?.({ frameIndex: encodedFrames, codecQueue: codecs.encoder?.encodeQueueSize || 0, writeBacklog, plan: renderPlan });
        if (resilienceAction && resilienceAction.tier !== 'NORMAL') {
          maxWriteBacklog = Math.min(maxWriteBacklog, resilienceAction.writeBacklog || 1);
          runtimeTileConcurrency = Math.min(runtimeTileConcurrency, resilienceAction.tileConcurrency || 1);
          codecs.setMaxQueueSize?.(Math.min(safeCodecQueue, resilienceAction.codecQueue || 1));
          if (resilienceAction.forceYield) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const progress = 0.08 + encodedFrames / Math.max(1, outputFrameCount) * 0.74;
        reportRenderProgress({
          progress,
          stage: 'processing',
          detail: `${encodedFrames} / ${outputFrameCount}`,
          fps: performance.telemetry.fps,
        });
        if (encodedFrames % renderPlan.checkpointEvery === 0) await checkpoint({
          progress, stage: 'processing', renderPlan, qualityLockFingerprint, durableResume: writer.format === 'annexb-h264',
        });
        await renderGovernor.yieldIfNeeded(encodedFrames, renderPlan, signal);
      };

      const emitProcessedFrame = async (item) => {
        if (!blurConfiguration.enabled) {
          await renderOutput(item);
          return;
        }
        const outputs = await blur.push(item.frame, {
          timestamp: item.timestamp,
          duration: item.duration,
          signal,
        });
        for (const outputFrame of outputs) {
          try {
            await renderOutput({ frame: outputFrame, timestamp: outputFrame.timestamp });
          } finally {
            outputFrame.close();
          }
        }
      };

      let sceneCutsProtected = 0;
      let staticInterpolationSkips = 0;
      rifeWorkspace = rifeActive ? new RifeFrameWorkspace(nativeWidth, nativeHeight) : null;
      sceneDetector = rifeActive && settings.protectSceneCuts !== false ? new SceneChangeDetector() : null;
      const interpolate = rifeActive
        ? async (a, b, t, timestamp) => {
          const motion = sceneDetector?.analyze?.(a, b);
          if (motion?.cut) {
            sceneCutsProtected++;
            return (t < 0.5 ? a : b).clone();
          }
          // No motion-based inference shortcut in final render. Even a nearly
          // static pair is passed through the selected RIFE model so the
          // exported pixels are independent of device load/thermal state.
          const candidate = await interpolateVideoFrames(rife, settings.rifeModelId, a, b, t, timestamp, nativeWidth, nativeHeight, blurConfiguration.preInterpolation ? 4 : 3, rifeWorkspace);
          const guard = temporalArtifactGuard?.inspect(a, b, candidate);
          if (guard && !guard.safe) {
            candidate.close();
            temporalFallbacks++;
            return (t < 0.5 ? a : b).clone();
          }
          return candidate;
        }
        : null;
      sequencer = new FrameSequencer({ sourceFps, targetFps: processingFps, maxQueueSize: 3 });
      if (resuming) sequencer.nextOutputTimestamp = Number.isFinite(Number(resumeCheckpoint.nextOutputTimestamp))
        ? Number(resumeCheckpoint.nextOutputTimestamp) : resumeEncodedFrames * (1_000_000 / targetFps);
      let currentSourceIndex = 0;
      const analysisWidth = Math.min(320, nativeWidth);
      const analysisHeight = Math.max(2, Math.round(nativeHeight * analysisWidth / nativeWidth));
      const analysisCanvas = new OffscreenCanvas(analysisWidth, analysisHeight);
      const analysisContext = analysisCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
      const analysisInterval = Math.max(1, Math.round(sourceFps));
      const sourceFrames = mediaSession
        ? mediaSession.frames({ signal })
        : legacyFrames(video, sourceFrameCount, sourceFps, duration, signal);
      let sourceTimestampOrigin = resuming && Number.isFinite(Number(resumeCheckpoint.sourceTimestampOrigin)) ? Number(resumeCheckpoint.sourceTimestampOrigin) : null;
      for await (const sourceFrame of sourceFrames) {
        abortIfNeeded(signal);
        await waitIfPaused();
        const frameSource = sourceFrame.source;
        let processedFrame = null;
        let processedFrameOwnedBySequencer = false;
        try {
        if (resuming && currentSourceIndex < resumeSourceFrameIndex) {
          sourceTimestampOrigin ??= sourceFrame.timestamp;
          currentSourceIndex++;
          continue;
        }
        // Container presentation timelines commonly begin at a positive edit
        // offset. The newly encoded elementary stream must start at zero;
        // otherwise Chromium can reject an otherwise valid MP4 after remux.
        // Keep all subsequent deltas intact so pacing and A/V duration remain
        // faithful to the source.
        sourceTimestampOrigin ??= sourceFrame.timestamp;
        const timestamp = Math.max(0, sourceFrame.timestamp - sourceTimestampOrigin);
        const sourceDuration = sourceFrame.duration || Math.round(1_000_000 / sourceFps);
        frameIntegrity.observeDecoded(timestamp, sourceDuration);

        // Re-sample once per source second. The small surface keeps analysis
        // bounded while still adapting cleanup/detail strength between scenes.
        if (currentSourceIndex % analysisInterval === 0 || !lastSceneMetrics) {
          analysisContext.drawImage(frameSource, 0, 0, analysisWidth, analysisHeight);
          lastSceneMetrics = qualityEngine.analyze(analysisContext.getImageData(0, 0, analysisWidth, analysisHeight));
          const sceneAware = settings.qualityLab?.sceneAware !== false;
          activeCleanupEffects = qualityEngine.adaptToScene(effectStages.cleanup, lastSceneMetrics, sceneAware);
          activeFinishEffects = qualityEngine.adaptToScene(effectStages.finish, lastSceneMetrics, sceneAware);
        }
        if (effectsBackend === 'webgpu') {
          try {
            gpu.renderFrame(frameSource, activeCleanupEffects, { width: nativeWidth, height: nativeHeight }, { releaseSource: false });
            nativeContext.drawImage(gpuCanvas, 0, 0);
            processedFrame = new VideoFrame(nativeCanvas, {
              timestamp,
              duration: sourceDuration,
            });
          } catch (error) {
            resilience?.noteBackendFallback?.();
            const fallback = webglReady ? 'WebGL2' : 'Canvas2D';
            effectsBackend = webglReady ? 'webgl2' : 'canvas2d';
            reportCrashProofFailure(error, fallback);
          }
        }
        if (!processedFrame && effectsBackend === 'webgl2') {
          try {
            webgl.renderFrame(frameSource, activeCleanupEffects, { width: nativeWidth, height: nativeHeight });
            nativeContext.drawImage(webglCanvas, 0, 0);
            processedFrame = new VideoFrame(nativeCanvas, { timestamp, duration: sourceDuration });
          } catch (error) {
            resilience?.noteBackendFallback?.();
            effectsBackend = 'canvas2d';
            reportCrashProofFailure(error, 'Canvas2D');
          }
        }
        if (!processedFrame) {
          applyCanvasFallback(frameSource, nativeContext, nativeWidth, nativeHeight, activeCleanupEffects);
          processedFrame = new VideoFrame(nativeCanvas, {
            timestamp,
            duration: sourceDuration,
          });
        }
        const temporalDenoise = effectStages.temporal.temporalDenoise || 0;
        const antiFlicker = effectStages.temporal.antiFlicker || 0;
        const detailStability = effectStages.temporal.temporalDetailStability || 0;
        if (temporalDenoise > 0 || antiFlicker > 0 || detailStability > 0) {
          // The effect engines have already written the current frame into
          // nativeCanvas. Replace the temporary VideoFrame after the bounded
          // temporal pass so the sequencer receives the stabilized pixels.
          processedFrame.close();
          const temporalResult = temporal.process(nativeCanvas, nativeContext, {
            denoise: temporalDenoise,
            antiFlicker,
            detailStability,
          });
          temporalFrames++;
          if (temporalResult.sceneCut) temporalSceneResets++;
          processedFrame = new VideoFrame(nativeCanvas, {
            timestamp,
            duration: sourceDuration,
          });
        }
        if (settings.temporalReconstruction?.enabled) {
          processedFrame.close();
          const reconstructionResult = temporalReconstruction.process(nativeCanvas, nativeContext, settings.temporalReconstruction);
          if (reconstructionResult.applied) temporalFrames++;
          processedFrame = new VideoFrame(nativeCanvas, { timestamp, duration: sourceDuration });
        }
        if (settings.stabilization?.enabled) {
          processedFrame.close();
          stabilization.process(nativeCanvas, nativeContext, settings.stabilization);
          processedFrame = new VideoFrame(nativeCanvas, { timestamp, duration: sourceDuration });
        }
        frameIntegrity.observeProcessed();
        await sequencer.push(processedFrame, { timestamp, duration: sourceDuration });
        processedFrameOwnedBySequencer = true;
        processedFrame = null;
        for (const item of await sequencer.drainPair(interpolate)) {
          try {
            await emitProcessedFrame(item);
          } finally {
            item.frame.close();
          }
        }
        currentSourceIndex++;
        } finally {
          if (!processedFrameOwnedBySequencer) {
            try { processedFrame?.close?.(); } catch (cleanupError) { console.error('[BARSA][frame-cleanup][processed-failed]', cleanupError); }
          }
          try { frameSource?.close?.(); } catch (cleanupError) { console.error('[BARSA][frame-cleanup][source-failed]', cleanupError); }
        }
      }
      for (const item of await sequencer.flush(interpolate)) {
        try {
          await emitProcessedFrame(item);
        } finally {
          item.frame.close();
        }
      }
      if (blurConfiguration.enabled) {
        for (const outputFrame of await blur.flush({ signal })) {
          try {
            await renderOutput({ frame: outputFrame, timestamp: outputFrame.timestamp });
          } finally {
            outputFrame.close();
          }
        }
      }

      update({ progress: 0.84, stage: 'flushing-encoder' });
      await codecs.flushEncoder({ signal });
      await writeChain;
      if (writeError) throw writeError;
      if (writer.frameIndex !== encodedFrames) {
        throw new Error(`Encoder packet accounting mismatch: submitted=${encodedFrames}, written=${writer.frameIndex}`);
      }
      if (audioPromise) await audioPromise;
      // AAC/WebCodecs failure is recoverable because the durable elementary
      // H.264 stream still exists. Drop the partial native MP4 and remux audio
      // from the original source through FFmpeg instead of losing the render.
      if (audioFailure && nativeMp4) {
        nativeMuxFailure ||= audioFailure;
        const failedMux = nativeMp4;
        nativeMp4 = null;
        await failedMux.cancel().catch(() => {});
      }
      const framePacingValidation = framePacing.finalize({ allowIrregularRatio: 0 });
      const frameIntegrityValidation = frameIntegrity.finalize({ outputDurationUs: duration * 1_000_000, blurEnabled: blurConfiguration.enabled });
      const elementaryFile = await writer.finalize({ remuxPending: true, patch: {
        encodedFrames: writer.frameIndex,
        lastOutputTimestamp: frameIntegrity?.lastEncodedTimestamp ?? null,
        durableResume: writer.format === 'annexb-h264',
      } });
      update({ progress: 0.87, stage: 'remuxing' });
      let outputBlob;
      if (nativeMp4) {
        try {
          outputBlob = await nativeMp4.finalize();
          update({ progress: .98, stage: 'remuxing', detail: 'MP4 native mux · Fast Start' });
        } catch (error) {
          nativeMuxFailure ||= error;
          const failedMux = nativeMp4;
          nativeMp4 = null;
          await failedMux.cancel().catch(() => {});
        }
      }
      if (!outputBlob && (settings.outputFormat || 'mp4') === 'webm' && writer.format.startsWith('ivf') && (!sourceHasAudio || settings.audioEnabled === false)) {
        outputBlob = await muxIVFToWebM(elementaryFile, { codec: encoderConfig.codec, width: outputSize.width, height: outputSize.height, fps: targetFps, duration });
        update({ progress: .98, stage: 'remuxing', detail: 'WebM native mux' });
      }
      if (!outputBlob) {
        update({ progress: 0.87, stage: 'remuxing', detail: nativeMuxFailure ? 'استعادة الرندر عبر FFmpeg بعد تعذر MP4 native' : 'تهيئة محرك MP4/الصوت محلياً — أول مرة قد تستغرق أطول' });
        ffmpegWasUsed = true;
        await ffmpeg.load({ multiThread: this.manager.capabilities.sharedArrayBuffer, onProgress: ({ progress }) => update({ progress: 0.87 + progress * 0.11, stage: 'remuxing' }) });
        outputBlob = await ffmpeg.remux({ video: elementaryFile, source: sourceHasAudio && settings.audioEnabled !== false ? file : null, outputFormat: settings.outputFormat || 'mp4', elementaryFormat: writer.format, fps: targetFps, audioFilter: settings.audioEnabled === false || settings.audio?.enabled === false ? null : audio.buildFFmpegFilter(settings.audio || {}), audioBitrateK: quality.audioBitrateK, videoCRF: quality.crf, videoPreset: quality.preset, signal });
      }
      let exportValidation = null;
      let trackValidation = null;
      let avSyncValidation = null;
      if ((settings.outputFormat || 'mp4') === 'mp4') {
        update({ progress: 0.985, stage: 'validating-output', detail: 'فحص سلامة MP4 والتشغيل' });
        try {
          exportValidation = await validateMP4Export(outputBlob, { width: outputSize.width, height: outputSize.height, duration });
        } catch (error) {
          const ffmpegTail = ffmpeg.lastLogs?.slice(-4).join(' | ') || 'native mux';
          throw new Error(`MP4 playback validation failed after ${encodedFrames} frames/${writer.frameIndex} packets (${writer.format}, ${outputBlob.size} bytes): ${error.message}; mux=${ffmpegTail}`);
        }
        let outputMetadata;
        try {
          outputMetadata = await media.probe(outputBlob);
        } catch (error) {
          throw new Error(`MP4 track inspection failed after ${encodedFrames} encoded frames (${writer.format}, ${outputBlob.size} bytes): ${error.message}`);
        }
        trackValidation = validateMP4Tracks(outputMetadata, { width: outputSize.width, height: outputSize.height, expectAudio: wantsAudio });
        avSyncValidation = validateAVSync({ expectedVideoDuration: duration, outputDuration: outputMetadata.duration, nativeAudioStats, expectAudio: wantsAudio });
      }
      const finalQualityLockFingerprint = await createQualityLockFingerprint({
        settings, width: outputSize.width, height: outputSize.height, fps: targetFps, bitrate,
        models: { upscale: settings.upscaleModelId || null, rife: settings.rifeModelId || null, face: settings.faceModelId || null },
      });
      assertQualityLockFingerprint(qualityLockFingerprint, finalQualityLockFingerprint, { phase: 'commit' });

      // OPFS-backed File/Blob objects are not portable snapshots in Chromium: deleting
      // their directory entry can invalidate a blob: URL that has not finished opening.
      // Keep exactly one durable final MP4 leased to the consumer, while removing
      // resume/source/frame artifacts immediately. No second 4K copy is created.
      const nativeOutputLeased = Boolean(nativeMp4?.opfsOutput);
      if (nativeOutputLeased) await storage.completeSessionWithOutput(jobId);
      else await storage.deleteSession(jobId).catch((cleanupError) => console.error('[BARSA][storage][completed-session-cleanup-failed]', { jobId, cleanupError }));
      let outputLeaseReleased = false;
      const releaseOutputLease = nativeOutputLeased ? async () => {
        if (outputLeaseReleased) return;
        outputLeaseReleased = true;
        await storage.deleteSession(jobId);
      } : null;
      // The final file itself stays durable only while the result is owned by the UI.
      // Crash/restart cleanup is covered by terminal-session pruning.
      update({ progress: 1, stage: 'completed', detail: formatBytes(outputBlob.size) });
      return {
        blob: outputBlob,
        url: URL.createObjectURL(outputBlob),
        fileName: `video-toolkit-pro-${jobId.slice(0, 8)}.${settings.outputFormat || 'mp4'}`,
        release: releaseOutputLease,
        metadata: {
          sessionId: jobId,
          width: outputSize.width,
          height: outputSize.height,
          sourceFps,
          targetFps,
          processingFps,
          encodedFrames,
          codec: (settings.outputFormat || 'mp4') === 'mp4' && writer.format.startsWith('ivf') ? 'H.264 · FFmpeg' : encoderConfig.codec,
          gpuEffects: effectsBackend !== 'canvas2d',
          effectsBackend,
          aiUpscale: aiUpscaleActive,
          aiUpscaleProvider: aiUpscaleActive ? (upscale.lastExecutionProvider || upscale.executionProvider || null) : null,
          aiUpscaleGraphCapture: aiUpscaleActive ? Boolean(upscale.graphCaptureEnabled) : false,
          aiUpscaleTileSize: qualityLockedTileSize,
          qualityLockedRender: true,
          qualityLockFingerprint: finalQualityLockFingerprint,
          aiTensorPool: aiUpscaleActive ? upscale.tensorPool?.stats?.() || null : null,
          rifeTensorPool: rifeActive ? rife.tensorPool?.stats?.() || null : null,
          aiWorkingSize: aiWork ? `${aiWork.inputWidth}×${aiWork.inputHeight}→${aiWork.outputWidth}×${aiWork.outputHeight}` : null,
          aiInterpolation: rifeActive,
          faceRestoration: faceStatus.available,
          faceProvider: faceStatus.available ? (face.lastExecutionProvider || face.executionProvider || null) : null,
          sceneCutsProtected, staticInterpolationSkips,
          temporalArtifactGuard: temporalArtifactGuard?.diagnostics() || null,
          temporalFallbacks,
          temporalFrames,
          temporalSceneResets,
          temporalMaster,
          sceneAnalysis: lastSceneMetrics,
          qualityWarnings,
          blur: blurConfiguration.enabled ? blur.diagnostics() : null,
          color: colorDiagnostics,
          directDemux: Boolean(mediaSession),
          variableFrameRate: sourceMetadata.variableFrameRate,
          exportValidation,
          trackValidation,
          avSyncValidation,
          framePacingValidation,
          frameIntegrity: frameIntegrityValidation,
          resumedFromCheckpoint: resuming,
          resumeSourceFrameIndex: resuming ? resumeSourceFrameIndex : null,
          audioPath: nativeAudioStats ? 'WebCodecs AAC · streaming' : wantsAudio ? 'FFmpeg AAC' : 'disabled',
          nativeAudioStats,
          qualityAudit: qualityMetrics.finalize(),
          renderStability: stability.finalize(),
          resilience: resilience?.diagnostics?.() || null,
        renderPlan,
          nativeMuxRecovered: Boolean(nativeMuxFailure),
          nativeMuxFailure: nativeMuxFailure ? String(nativeMuxFailure.message || nativeMuxFailure) : null,
          cpuFallbackWorker: cpuFrameWorker.supported,
        },
      };
    } catch (error) {
      sequencer?.cancel();
      await nativeMp4?.cancel().catch(() => {});
      await writer?.abort(error).catch(() => {});
      throw error;
    } finally {
      codecs.close();
      gpu.destroy();
      webgl.destroy();
      sceneDetector?.destroy();
      temporalArtifactGuard?.destroy();
      renderWatchdog?.stop();
      temporal.reset();
      temporalReconstruction.destroy?.();
      stabilization.destroy?.();
      qualityMetrics.reset();
      blur.destroy();
      cpuFrameWorker.destroy();
      if (ffmpegWasUsed) ffmpeg.terminate();
      rifeWorkspace?.destroy();
      if (settings.rifeModelId) rife.destroy();
      if (settings.upscaleModelId) upscale.destroy();
      if (settings.faceModelId) face.destroy();
      else face.resetTracking();
      mediaSession?.close();
      video?.pause();
      if (sourceURL) URL.revokeObjectURL(sourceURL);
    }
  }
}

async function recoverPendingRemux({
  storage, ffmpeg, audio, media, jobId, file, settings, quality, outputSize,
  sourceFps, targetFps, duration, sourceHasAudio, resumeCheckpoint, signal, update,
}) {
  abortIfNeeded(signal);
  const elementaryFormat = resumeCheckpoint?.metadata?.elementaryFormat || 'annexb-h264';
  const expectedBytes = Math.max(0, Number(resumeCheckpoint?.bytesWritten) || 0);
  const elementaryFile = await storage.getSessionFile(jobId);
  if (!elementaryFile?.size || elementaryFile.size < expectedBytes) {
    throw new Error('ملف الرندر المكتمل غير صالح للاستكمال إلى MP4؛ بيانات الفيديو المثبتة ناقصة');
  }
  update({ progress: Math.max(0.87, Number(resumeCheckpoint?.progress) || 0.87), stage: 'remuxing', detail: 'استعادة MP4 مباشرة بدون إعادة رندر الإطارات' });
  await ffmpeg.load({
    multiThread: crossOriginIsolated,
    onProgress: ({ progress }) => update({ progress: 0.87 + progress * 0.11, stage: 'remuxing' }),
  });
  const format = settings.outputFormat || 'mp4';
  const wantsAudio = sourceHasAudio && settings.audioEnabled !== false;
  const blob = await ffmpeg.remux({
    video: elementaryFile,
    source: wantsAudio ? file : null,
    outputFormat: format,
    elementaryFormat,
    fps: targetFps,
    audioFilter: !wantsAudio || settings.audio?.enabled === false ? null : audio.buildFFmpegFilter(settings.audio || {}),
    audioBitrateK: quality.audioBitrateK,
    videoCRF: quality.crf,
    videoPreset: quality.preset,
    signal,
  });
  let exportValidation = null;
  let trackValidation = null;
  if (format === 'mp4') {
    exportValidation = await validateMP4Export(blob, { width: outputSize.width, height: outputSize.height, duration });
    trackValidation = validateMP4Tracks(await media.probe(blob), { width: outputSize.width, height: outputSize.height, expectAudio: wantsAudio });
  }
  await storage.deleteSession(jobId);
  update({ progress: 1, stage: 'completed', detail: formatBytes(blob.size) });
  return {
    blob,
    url: URL.createObjectURL(blob),
    fileName: `video-toolkit-pro-${jobId.slice(0, 8)}.${format}`,
    metadata: {
      sessionId: jobId,
      width: outputSize.width,
      height: outputSize.height,
      sourceFps,
      targetFps,
      encodedFrames: Number(resumeCheckpoint?.framesWritten || 0),
      codec: elementaryFormat === 'annexb-h264' ? 'H.264 · recovered remux' : elementaryFormat,
      fallback: 'remux-recovery',
      resumedFromCheckpoint: true,
      recoveredWithoutRerender: true,
      exportValidation,
      trackValidation,
    },
  };
}

export async function streamAudioTrack(mediaSession, muxer, signal) {
  // Mediabunny AudioSample timestamps/durations are expressed in seconds
  // (unlike WebCodecs AudioData, whose timestamps are microseconds). Keeping
  // the timeline in seconds prevents false A/V drift failures and needless
  // FFmpeg fallback on otherwise healthy native AAC exports.
  let count = 0, firstTimestamp = null, lastTimestamp = null, lastEnd = null;
  for await (const sample of mediaSession.audioSamples({ signal })) {
    abortIfNeeded(signal);
    try {
      const timestamp = Number(sample.timestamp);
      const duration = Number(sample.duration) || (Number(sample.numberOfFrames) / Math.max(1, Number(sample.sampleRate)));
      if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('Native audio sample has an invalid timestamp');
      if (lastTimestamp != null && timestamp + 1e-6 < lastTimestamp) throw new Error('Native audio timeline is not monotonic');
      firstTimestamp ??= timestamp;
      lastTimestamp = timestamp;
      lastEnd = Math.max(lastEnd ?? timestamp, timestamp + Math.max(0, Number.isFinite(duration) ? duration : 0));
      await muxer.addAudioSample(sample);
      count++;
    } finally {
      sample.close();
    }
  }
  if (!count) throw new Error('Native audio track produced no decodable samples');
  return {
    inputChunks: count,
    firstTimestamp,
    lastEnd,
    measuredDuration: firstTimestamp != null && lastEnd != null ? Math.max(0, lastEnd - firstTimestamp) : null,
  };
}

export function validateAVSync({ expectedVideoDuration, outputDuration, nativeAudioStats = null, expectAudio = true, toleranceSeconds = null } = {}) {
  const videoDuration = Number(outputDuration) || Number(expectedVideoDuration);
  if (!(videoDuration > 0)) throw new Error('A/V sync validation requires a valid video duration');
  const tolerance = toleranceSeconds ?? Math.max(0.12, Math.min(0.5, videoDuration * 0.0025));
  if (!expectAudio) return { valid: true, audio: false, videoDuration, measuredAudioDuration: null, driftSeconds: 0, toleranceSeconds: tolerance };
  if (!(nativeAudioStats?.measuredDuration > 0)) return { valid: true, audio: true, videoDuration, measuredAudioDuration: null, driftSeconds: null, toleranceSeconds: tolerance, mode: 'container-duration-only' };
  const driftSeconds = nativeAudioStats.measuredDuration - videoDuration;
  if (Math.abs(driftSeconds) > tolerance) throw new Error(`Audio sync drift is ${driftSeconds.toFixed(3)}s (limit ${tolerance.toFixed(3)}s)`);
  return { valid: true, audio: true, videoDuration, measuredAudioDuration: nativeAudioStats.measuredDuration, driftSeconds, toleranceSeconds: tolerance, mode: 'decoded-audio-timeline' };
}

async function interpolateVideoFrames(rife, modelId, a, b, t, timestamp, width, height, recursionDepth = 3, workspace = null) {
  const localWorkspace = workspace || new RifeFrameWorkspace(width, height);
  const { canvas, context, pool } = localWorkspace;
  const elements = 3 * width * height;
  const chwA = pool.acquire(Float32Array, elements);
  const chwB = pool.acquire(Float32Array, elements);
  try {
    context.clearRect(0, 0, width, height);
    context.drawImage(a, 0, 0);
    imageDataToChwFloat32(context.getImageData(0, 0, width, height), chwA);
    context.clearRect(0, 0, width, height);
    context.drawImage(b, 0, 0);
    imageDataToChwFloat32(context.getImageData(0, 0, width, height), chwB);
    const interpolated = await rife.interpolateAt(modelId, chwA, chwB, width, height, t, recursionDepth);
    context.putImageData(chwFloat32ToImageData(interpolated, width, height), 0, 0);
    return new VideoFrame(canvas, { timestamp: Math.round(timestamp) });
  } finally {
    pool.release(chwA);
    pool.release(chwB);
    if (!workspace) localWorkspace.destroy();
  }
}

class RifeFrameWorkspace {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.canvas = new OffscreenCanvas(width, height);
    this.context = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    // Retain at most two 1080p-ish CHW buffers. 4K arrays are intentionally
    // not retained by the pool cap, preventing a speed optimization from
    // becoming a permanent >200 MB memory reservation.
    this.pool = new TypedArrayPool({ maxPerLength: 2, maxRetainedBytes: 64 * 1024 * 1024 });
  }

  destroy() {
    this.pool.clear();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}

async function loadVideo(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await eventOnce(video, 'loadedmetadata', 'error');
    if (!Number.isFinite(video.duration) || !video.videoWidth || !video.videoHeight) throw new Error('The browser could not read this video');
    return { video, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function estimateFrameRate(video, signal) {
  if (!video.requestVideoFrameCallback) return 30;
  const samples = [];
  let previous = null;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; clearTimeout(timeout); resolve(); };
    const timeout = setTimeout(finish, 1000);
    const step = (_now, metadata) => {
      if (settled) return;
      if (previous != null && metadata.mediaTime > previous) samples.push(metadata.mediaTime - previous);
      previous = metadata.mediaTime;
      if (samples.length >= 16 || signal?.aborted) finish();
      else video.requestVideoFrameCallback(step);
    };
    video.requestVideoFrameCallback(step);
    video.play().catch(finish);
  });
  video.pause();
  await seekVideo(video, 0, signal);
  if (!samples.length) return 30;
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  return Math.max(1, Math.min(240, Math.round(1 / median * 1000) / 1000));
}

function applyCanvasFallback(source, context, width, height, effects) {
  context.drawImage(source, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  applyRealtimeEffects(image, effects);
  context.putImageData(image, 0, 0);
}

async function* legacyFrames(video, frameCount, fps, duration, signal) {
  for (let index = 0; index < frameCount; index++) {
    const time = Math.min(duration - 0.0001, index / fps);
    await seekVideo(video, time, signal);
    yield {
      source: video,
      timestamp: Math.round(time * 1_000_000),
      duration: Math.round(1_000_000 / fps),
    };
  }
}

function seekVideo(video, time, signal) {
  abortIfNeeded(signal);
  if (Math.abs(video.currentTime - time) < 0.0005 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => finish(reject, signal.reason || new DOMException('Operation cancelled', 'AbortError'));
    const onSeeked = () => finish(resolve);
    const onError = () => finish(reject, new Error('Video seek failed'));
    const finish = (callback, value) => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    video.currentTime = Math.max(0, Math.min(time, video.duration - 0.0001));
  });
}

function eventOnce(target, success, failure) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { target.removeEventListener(success, onSuccess); target.removeEventListener(failure, onFailure); };
    const onSuccess = (event) => { cleanup(); resolve(event); };
    const onFailure = () => { cleanup(); reject(new Error(`Media event failed: ${failure}`)); };
    target.addEventListener(success, onSuccess, { once: true });
    target.addEventListener(failure, onFailure, { once: true });
  });
}

export function normalizeBlurConfiguration(input = {}, sourceFps, requestedOutputFps = sourceFps) {
  const enabled = Boolean(input?.enabled);
  const mobileSafeMode = input.mobileSafeMode !== false;
  const fpsCap = mobileSafeMode ? 240 : 480;
  const outputFps = input.outputFps === 'source' || input.outputFps === 'same'
    ? sourceFps
    : resolveFpsChoice(input.outputFps, input.customOutputFps, requestedOutputFps || sourceFps);
  const multiplier = Math.max(1, Math.min(mobileSafeMode ? 5 : 8, Number(input.interpolationMultiplier) || 2));
  const selectedInterpolationFps = resolveFpsChoice(
    input.interpolationFps,
    input.customInterpolationFps,
    sourceFps * multiplier,
  );
  return {
    enabled,
    amount: Math.max(0, Math.min(4, Number(input.amount ?? 1))),
    outputFps: Math.max(1, Math.min(fpsCap, outputFps)),
    gamma: Math.max(0.25, Math.min(4, Number(input.gamma ?? 1))),
    weighting: input.weighting || 'gaussian_sym',
    customWeights: input.customWeights || '',
    gaussian: {
      stdDev: Math.max(0.001, Number(input.gaussian?.stdDev ?? input.gaussianStdDev ?? 1)),
      mean: Number(input.gaussian?.mean ?? input.gaussianMean ?? 0),
      bound: normalizeGaussianBound(input.gaussian?.bound ?? input.gaussianBound),
    },
    interpolation: enabled && input.interpolation !== false,
    interpolationFps: Math.max(1, Math.min(fpsCap, selectedInterpolationFps)),
    interpolationMultiplier: multiplier,
    interpolationMethod: 'rife',
    preInterpolation: input.preInterpolation !== false,
    deduplicate: Boolean(input.deduplicate),
    deduplicateRange: Math.max(1, Math.min(12, Math.round(Number(input.deduplicateRange) || 2))),
    deduplicateThreshold: Math.max(0.0001, Math.min(0.2, Number(input.deduplicateThreshold ?? 0.006))),
    deduplicateMethod: input.deduplicateMethod === 'nearest' ? 'nearest' : 'skip',
    encoderSelection: ['auto', 'hardware', 'software'].includes(input.encoderSelection) ? input.encoderSelection : 'auto',
    mobileSafeMode,
    renderQualityCrf: Math.max(0, Math.min(35, Number(input.renderQualityCrf ?? 16))),
    renderPreset: ['fast','balanced','quality'].includes(input.renderPreset) ? input.renderPreset : 'balanced',
    detailedFilenames: input.detailedFilenames !== false,
    copyDates: Boolean(input.copyDates),
    gpuDecoding: input.gpuDecoding !== false,
    gpuInterpolation: input.gpuInterpolation !== false,
    gpuEncoding: input.gpuEncoding !== false,
    filtersEnabled: Boolean(input.filtersEnabled),
    filterBrightness: Math.max(0, Math.min(2.5, Number(input.filterBrightness ?? 1))),
    filterSaturation: Math.max(0, Math.min(2.5, Number(input.filterSaturation ?? 1))),
    filterContrast: Math.max(0.1, Math.min(2.5, Number(input.filterContrast ?? 1))),
  };
}

function resolveFpsChoice(value, custom, fallback) {
  if (value === 'source' || value === 'same' || value == null || value === '') return Number(fallback);
  if (value === 'custom') return Number(custom) || Number(fallback);
  return Number(value) || Number(fallback);
}

function normalizeGaussianBound(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const parsed = value.slice(0, 2).map(Number);
    if (parsed.every(Number.isFinite) && parsed[1] > parsed[0]) return parsed;
  }
  if (typeof value === 'string') {
    const parsed = value.split(/[,:\s]+/).filter(Boolean).slice(0, 2).map(Number);
    if (parsed.length === 2 && parsed.every(Number.isFinite) && parsed[1] > parsed[0]) return parsed;
  }
  return [-2, 2];
}

function gpuColorSettings(colorLab, legacyEffects = {}) {
  if (!colorLab || colorLab.enabled === false) {
    return { tint: 0, lift: 0, gain: 1 };
  }
  const value = (name, fallback) => Number.isFinite(Number(colorLab[name])) ? Number(colorLab[name]) : fallback;
  return {
    exposure: value('exposure', legacyEffects.exposure || 0),
    contrast: value('contrast', legacyEffects.contrast ?? 1),
    highlights: value('highlights', legacyEffects.highlights || 0),
    shadows: value('shadows', legacyEffects.shadows || 0),
    whites: value('whites', legacyEffects.whites || 0),
    blacks: value('blacks', legacyEffects.blacks || 0),
    temperature: value('temperature', legacyEffects.temperature || 0),
    tint: value('tint', 0),
    saturation: value('saturation', legacyEffects.saturation ?? 1),
    vibrance: value('vibrance', legacyEffects.vibrance || 0),
    lift: value('lift', 0),
    gamma: value('gamma', legacyEffects.gamma ?? 1),
    gain: value('gain', 1),
    clarity: value('clarity', legacyEffects.clarity || 0),
    dehaze: value('dehaze', legacyEffects.dehaze || 0),
  };
}

/** Curves and LUT are the only Color Lab features not fused into the GPU pass. */
function cpuColorSettings(colorLab = {}) {
  return {
    enabled: colorLab.enabled !== false,
    tint: 0,
    lift: 0,
    colorGamma: 1,
    gain: 1,
    curves: colorLab.curves || {},
    offset: Number(colorLab.offset) || 0,
    hueRotate: Number(colorLab.hueRotate) || 0,
    shadowSat: Number.isFinite(Number(colorLab.shadowSat)) ? Number(colorLab.shadowSat) : 1,
    midSat: Number.isFinite(Number(colorLab.midSat)) ? Number(colorLab.midSat) : 1,
    highlightSat: Number.isFinite(Number(colorLab.highlightSat)) ? Number(colorLab.highlightSat) : 1,
    redSat: Number.isFinite(Number(colorLab.redSat)) ? Number(colorLab.redSat) : 1,
    greenSat: Number.isFinite(Number(colorLab.greenSat)) ? Number(colorLab.greenSat) : 1,
    blueSat: Number.isFinite(Number(colorLab.blueSat)) ? Number(colorLab.blueSat) : 1,
    rgbMixer: colorLab.rgbMixer || null,
    lutStrength: Number(colorLab.lutStrength) || 0,
    lutHash: colorLab.lutHash || null,
  };
}

function enabledStrength(stage) {
  return stage?.enabled === false || !stage ? 0 : Math.max(0, Math.min(1, Number(stage.strength) || 0));
}

function sanitizeSettings(settings) {
  return JSON.parse(JSON.stringify(settings));
}


export function createThrottledRenderPreview(previewCanvas, outputSize, { maxLongEdge = 960, maxFps = 10 } = {}) {
  if (!previewCanvas?.getContext) return null;
  const width = Math.max(1, Number(outputSize?.width) || 1);
  const height = Math.max(1, Number(outputSize?.height) || 1);
  const scale = Math.min(1, Math.max(1, maxLongEdge) / Math.max(width, height));
  const previewWidth = Math.max(2, Math.round(width * scale));
  const previewHeight = Math.max(2, Math.round(height * scale));
  previewCanvas.width = previewWidth;
  previewCanvas.height = previewHeight;
  const context = previewCanvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'medium';
  const minDeltaUs = 1_000_000 / Math.max(1, Number(maxFps) || 10);
  let lastTimestamp = -Infinity;
  return {
    width: previewWidth,
    height: previewHeight,
    maxFps,
    draw(source, timestamp = 0) {
      const ts = Number(timestamp) || 0;
      if (ts - lastTimestamp < minDeltaUs) return false;
      lastTimestamp = ts;
      context.drawImage(source, 0, 0, previewWidth, previewHeight);
      return true;
    },
  };
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled', 'AbortError');
}

function formatBytes(bytes) {
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function detectAudioTrack(video) {
  try {
    if (video.audioTracks) return video.audioTracks.length > 0;
    if (typeof video.mozHasAudio === 'boolean') return video.mozHasAudio;
    const stream = video.captureStream?.();
    if (stream) { const hasAudio = stream.getAudioTracks().length > 0; stream.getTracks().forEach((track) => track.stop()); return hasAudio; }
  } catch {}
  return true;
}

async function runFFmpegOnly({
  storage,
  ffmpeg,
  audio,
  media,
  jobId,
  file,
  settings,
  quality,
  outputSize,
  sourceFps,
  targetFps,
  duration,
  sourceHasAudio,
  resolvedEffects,
  signal,
  update,
}) {
  await storage.beginSession(jobId, {
    jobOptions: sanitizeSettings(settings),
    sourceName: file.name,
    duration,
    sourceFps,
    targetFps,
    outputSize,
    fallback: 'ffmpeg-wasm',
  });
  try {
    await storage.cacheSourceFile(jobId, file, ({ progress }) => {
      update({ progress: 0.02 + progress * 0.06, stage: 'caching-source' });
    });
    update({ progress: 0.1, stage: 'ffmpeg-fallback', detail: 'WebCodecs encoder unavailable' });
    await ffmpeg.load({
      multiThread: crossOriginIsolated,
      onProgress: ({ progress }) => update({ progress: 0.1 + progress * 0.86, stage: 'ffmpeg-fallback' }),
    });
    const videoFilter = buildFFmpegVideoFilter({ ...settings, effects: resolvedEffects }, outputSize, targetFps);
    const bytes = await ffmpeg.transcode(file, file.name || 'input.mp4', {
      format: settings.outputFormat || 'mp4',
      quality: settings.quality || 'BALANCED',
      codec: settings.outputFormat === 'webm' ? 'libvpx-vp9' : quality.codec,
      videoFilter,
      audioFilter: sourceHasAudio && settings.audioEnabled !== false && settings.audio?.enabled !== false ? audio.buildFFmpegFilter(settings.audio || {}) : null,
      audioCodec: settings.outputFormat === 'webm' ? 'libopus' : 'aac',
      audioBitrateK: quality.audioBitrateK,
      includeAudio: sourceHasAudio && settings.audioEnabled !== false,
      signal,
    });
    const format = settings.outputFormat || 'mp4';
    const blob = new Blob([bytes], { type: format === 'webm' ? 'video/webm' : 'video/mp4' });
    const exportValidation = format === 'mp4'
      ? await validateMP4Export(blob, { width: outputSize.width, height: outputSize.height, duration })
      : null;
    const trackValidation = format === 'mp4'
      ? validateMP4Tracks(await media.probe(blob), { width: outputSize.width, height: outputSize.height, expectAudio: sourceHasAudio && settings.audioEnabled !== false })
      : null;
    // FFmpeg already produced the final Blob in memory; avoid a redundant
    // second full-file OPFS write. Resume data is only needed before completion.
    await storage.finalizeSession(jobId);
    await storage.deleteSession(jobId).catch(() => {});
    update({ progress: 1, stage: 'completed', detail: formatBytes(blob.size) });
    return {
      blob,
      url: URL.createObjectURL(blob),
      fileName: `video-toolkit-pro-${jobId.slice(0, 8)}.${format}`,
      metadata: {
        width: outputSize.width,
        height: outputSize.height,
        sourceFps,
        targetFps,
        encodedFrames: Math.max(1, Math.round(duration * targetFps)),
        codec: format === 'webm' ? 'libvpx-vp9' : quality.codec,
        gpuEffects: false,
        aiUpscale: false,
        aiInterpolation: false,
        faceRestoration: false,
        fallback: 'ffmpeg-wasm',
        exportValidation,
        trackValidation,
      },
    };
  } catch (error) {
    await storage.abortSession(jobId, error.message).catch(() => {});
    throw error;
  }
}

export function buildFFmpegVideoFilter(settings, outputSize, targetFps) {
  const effects = settings.effects || {};
  const filters = [
    ...buildFFmpegGeometryFilters(outputSize),
    `fps=${targetFps}`,
    `eq=brightness=${Math.max(-1, Math.min(1, (effects.brightness || 0) + (effects.exposure || 0) * .11 + (effects.shadows || 0) * .04 + (effects.highlights || 0) * .03))}:contrast=${Math.max(.1,(effects.contrast ?? 1)+(effects.dehaze||0)*.24+(effects.blacks||0)*-.04+(effects.whites||0)*.04)}:saturation=${Math.max(0, (effects.saturation ?? 1) + (effects.vibrance || 0) * 0.35+(effects.dehaze||0)*.12)}:gamma=${effects.gamma ?? 1}`,
  ];
  if ((effects.denoiseAmount || 0) > 0 || (effects.temporalDenoise || 0) > 0 || (effects.artifactRemoval || 0) > 0 || (effects.chromaDenoise || 0) > 0) {
    const cleanup = (effects.artifactRemoval || 0) * .55;
    const spatial = 1 + ((effects.denoiseAmount || 0) + cleanup + (effects.chromaDenoise || 0) * .35) * 5;
    const temporal = 1.5 + ((effects.temporalDenoise || 0) + cleanup * .5) * 7;
    filters.push(`hqdn3d=${spatial.toFixed(2)}:${spatial.toFixed(2)}:${temporal.toFixed(2)}:${temporal.toFixed(2)}`);
  }
  if ((effects.deblockAmount || 0) > 0) {
    const value = Math.min(.35, .04 + effects.deblockAmount * .22).toFixed(3);
    filters.push(`deblock=filter=strong:block=8:alpha=${value}:beta=${value}:gamma=${value}:delta=${value}`);
  }
  if ((effects.debandAmount || 0) > 0) {
    const threshold = Math.min(.12, .008 + effects.debandAmount * .055).toFixed(3);
    filters.push(`deband=1thr=${threshold}:2thr=${threshold}:3thr=${threshold}:4thr=${threshold}:range=16:blur=1`);
  }
  if (['sharpenAmount', 'highPassAmount', 'detailAmount', 'fineDetailRecovery', 'textureRecovery', 'detailFusion', 'edgeRecovery', 'clarity', 'localContrast'].some((key) => (effects[key] || 0) > 0)) {
    const detail = (effects.detailAmount || 0) * .35 + (effects.fineDetailRecovery || 0) * .3 + (effects.textureRecovery || 0) * .18 + (effects.detailFusion || 0) * .28 + (effects.edgeRecovery || 0) * .22 + (effects.clarity || 0) * .18 + (effects.localContrast || 0) * .12;
    const amount = Math.min(2.5, (effects.sharpenAmount || 0) + (effects.highPassAmount || 0) * 0.5 + detail);
    filters.push(`unsharp=5:5:${amount.toFixed(2)}:3:3:0`);
  }
  if ((effects.dehalo || 0) > 0 || (effects.antiRinging || 0) > 0) {
    const suppression = -Math.min(1, (effects.dehalo || 0) * .45 + (effects.antiRinging || 0) * .35);
    filters.push(`unsharp=3:3:${suppression.toFixed(2)}:3:3:0`);
  }
  if (Math.abs(effects.temperature || 0) > .001 || Math.abs(effects.tint || 0) > .001) {
    const shift = Math.max(-.3, Math.min(.3, effects.temperature * .18));
    const tint = Math.max(-.3, Math.min(.3, (effects.tint || 0) * .16));
    filters.push(`colorbalance=rs=${shift.toFixed(3)}:gs=${tint.toFixed(3)}:bs=${(-shift).toFixed(3)}`);
  }
  if (Math.abs(effects.lift || 0) > .001 || Math.abs((effects.gain ?? 1) - 1) > .001) {
    const lift = Math.max(-1, Math.min(1, effects.lift || 0));
    const gain = Math.max(.1, Math.min(3, effects.gain ?? 1));
    const inputMin = Math.max(-1, Math.min(1, -lift));
    const inputMax = gain > 1 ? 1 / gain : 1;
    const outputMax = gain < 1 ? gain : 1;
    filters.push(`colorlevels=rimin=${inputMin.toFixed(3)}:gimin=${inputMin.toFixed(3)}:bimin=${inputMin.toFixed(3)}:rimax=${inputMax.toFixed(3)}:gimax=${inputMax.toFixed(3)}:bimax=${inputMax.toFixed(3)}:romax=${outputMax.toFixed(3)}:gomax=${outputMax.toFixed(3)}:bomax=${outputMax.toFixed(3)}`);
  }
  if ((effects.antiFlicker || 0) > .001) filters.push('deflicker=size=5:mode=am');
  if ((effects.temporalDetailStability || 0) > .001) filters.push('tmix=frames=3:weights=1 2 1');
  if ((effects.vignette || 0) > .001) filters.push(`vignette=PI/${Math.max(3,8-(effects.vignette||0)*4).toFixed(2)}`);
  if ((effects.grain || 0) > .001) filters.push(`noise=alls=${Math.round((effects.grain||0)*12)}:allf=t`);
  return filters.join(',');
}

function normalizeTemporalMaster(value={}) {
  const strength=Math.max(0,Math.min(1,Number(value?.strength ?? 0.55)||0));
  return {enabled:value?.enabled!==false && strength>0,strength};
}
