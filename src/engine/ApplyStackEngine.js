import { CacheGraphEngine } from './CacheGraphEngine.js';
const STAGE_LABELS = Object.freeze({
  restore: 'تنظيف الجودة',
  detail: 'استعادة التفاصيل',
  sharp: 'الحدة والوضوح',
  face: 'الوجوه',
  upscale: 'رفع الدقة',
  motion: 'الحركة الزمنية',
  rife: 'الحركة RIFE',
  stabilize: 'التثبيت',
  blur: 'البلور',
  color: 'الألوان',
});

function fileNameForStage(stageId, sourceName = 'video') {
  const stem = String(sourceName || 'video').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._ -]+/gu, '_').trim().slice(0, 56) || 'video';
  return `${stem}_BARSA_${stageId}.mp4`;
}

export class ApplyStackEngine extends EventTarget {
  constructor({ storage = null } = {}) {
    super();
    this.storage = storage;
    this.graph = new CacheGraphEngine();
    this.reset();
  }

  reset(file = null, metadata = null) {
    this.originalFile = file;
    this.currentFile = file;
    this.originalMetadata = metadata;
    this.currentMetadata = metadata;
    this.sessionId = file ? `apply-${Date.now()}-${Math.random().toString(16).slice(2)}` : null;
    this.stages = [];
    this.runningStage = null;
    this.graph.reset(file);
    this.dispatchEvent(new CustomEvent('change', { detail: this.snapshot() }));
  }

  get hasAppliedStages() { return this.stages.length > 0; }
  get currentSource() { return this.currentFile || this.originalFile; }
  get currentMeta() { return this.currentMetadata; }
  getStage(stageId) { return this.stages.findLast?.(s => s.id === stageId) || [...this.stages].reverse().find(s => s.id === stageId) || null; }

  async apply(stageId, { settings, signature, processor, onProgress } = {}) {
    if (!this.currentSource) throw new Error('اختر فيديو أولاً');
    if (!stageId || typeof processor !== 'function') throw new Error('مرحلة التطبيق غير صالحة');
    if (this.runningStage) throw new Error('يوجد تطبيق آخر قيد التنفيذ');

    const startedAt = Date.now();
    if (this.storage?.assertCapacity) {
      const sourceBytes = Number(this.currentSource?.size || 0);
      const multiplier = ['upscale','rife','motion','face','restore','detail','stabilize','blur'].includes(stageId) ? 1.65 : 1.25;
      await this.storage.assertCapacity(Math.max(96 * 1024 * 1024, Math.ceil(sourceBytes * multiplier)), { reserveBytes: 512 * 1024 * 1024 });
    }
    this.runningStage = stageId;
    this._emit('stage', { stageId, state: 'processing', label: STAGE_LABELS[stageId] || stageId });
    try {
      const parentKey = this.graph.currentKey() || await this.graph.sourceKey();
      const nodeKey = await this.graph.keyFor({
        parentKey,
        stageId,
        settings,
        modelSHA256: settings?.__modelSHA256 || null,
        metadata: { width:this.currentMeta?.width||0, height:this.currentMeta?.height||0, fps:this.currentMeta?.fps||0, colorSpace:this.currentMeta?.colorSpace||null },
      });
      const known = this.graph.get(nodeKey);
      if (known?.cacheKey && this.storage?.readStageCache) {
        const diskFile = await this.storage.readStageCache(known.cacheKey).catch(() => null);
        if (diskFile?.size) {
          const record = { ...known, cacheHit: true, elapsedMs: Date.now() - startedAt };
          this.stages.push(record); this.graph.activate(record);
          this.currentFile = diskFile; this.currentMetadata = record.metadata || this.currentMetadata;
          await this._syncPinnedCaches();
          this._emit('stage', { stageId, state: 'applied', record }); this._emit('change', this.snapshot());
          return { blob: diskFile, file: diskFile, metadata: record.metadata, record, cacheHit: true };
        }
      }
      const result = await processor({
        file: this.currentSource,
        metadata: this.currentMeta,
        settings,
        stageId,
        onProgress,
      });
      if (!result?.blob?.size) throw new Error('لم ينتج ملف صالح من المرحلة');

      const fileName = fileNameForStage(stageId, this.currentSource.name || this.originalFile?.name);
      let nextFile = typeof File === 'function'
        ? new File([result.blob], fileName, { type: result.blob.type || 'video/mp4', lastModified: Date.now() })
        : Object.assign(result.blob, { name: fileName, lastModified: Date.now() });

      let cacheKey = null;
      if (this.storage?.cacheStageBlob && this.sessionId) {
        const cached = await this.storage.cacheStageBlob(this.sessionId, `node-${nodeKey}`, result.blob, {
          stageId, signature, metadata: result.metadata || null, createdAt: Date.now(),
        }).catch(() => null);
        cacheKey = cached?.name || null;
        if (cacheKey && this.storage.readStageCache) {
          const diskFile = await this.storage.readStageCache(cacheKey).catch(() => null);
          if (diskFile?.size) nextFile = diskFile;
        }
      }

      const record = {
        id: stageId,
        label: STAGE_LABELS[stageId] || stageId,
        signature,
        nodeKey,
        parentKey,
        cacheKey,
        bytes: result.blob.size,
        elapsedMs: Date.now() - startedAt,
        metadata: result.metadata || null,
        createdAt: Date.now(),
      };
      this.stages.push(record);
      this.graph.activate(record);
      this.currentFile = nextFile;
      this.currentMetadata = result.metadata || this.currentMetadata;
      await this._syncPinnedCaches();
      this._emit('stage', { stageId, state: 'applied', record });
      this._emit('change', this.snapshot());
      return { ...result, record, file: nextFile };
    } finally {
      this.runningStage = null;
    }
  }

  async adoptRecoveredStage(stageId, { blob, metadata = null, settings = null, signature = 'recovered' } = {}) {
    if (!stageId || !blob?.size || !this.currentSource) throw new Error('Recovered stage is invalid');
    const parentKey = this.graph.currentKey() || await this.graph.sourceKey();
    const nodeKey = await this.graph.keyFor({
      parentKey, stageId, settings: settings || {}, modelSHA256: settings?.__modelSHA256 || null,
      metadata: { width: metadata?.width || this.currentMeta?.width || 0, height: metadata?.height || this.currentMeta?.height || 0, fps: metadata?.targetFps || metadata?.fps || this.currentMeta?.fps || 0 },
    });
    let cacheKey = null;
    if (this.storage?.cacheStageBlob && this.sessionId) {
      const cached = await this.storage.cacheStageBlob(this.sessionId, `node-${nodeKey}`, blob, { stageId, signature, metadata, recovered: true, createdAt: Date.now() });
      cacheKey = cached?.name || null;
    }
    const fileName = fileNameForStage(stageId, this.currentSource.name || this.originalFile?.name);
    let nextFile = typeof File === 'function' ? new File([blob], fileName, { type: blob.type || 'video/mp4', lastModified: Date.now() }) : blob;
    if (cacheKey && this.storage?.readStageCache) nextFile = await this.storage.readStageCache(cacheKey).catch(() => nextFile);
    const record = { id: stageId, label: STAGE_LABELS[stageId] || stageId, signature, nodeKey, parentKey, cacheKey, bytes: blob.size, elapsedMs: null, metadata, createdAt: Date.now(), recovered: true };
    this.stages.push(record); this.graph.activate(record); this.currentFile = nextFile; this.currentMetadata = metadata || this.currentMetadata;
    await this._syncPinnedCaches();
    this._emit('stage', { stageId, state: 'applied', record }); this._emit('change', this.snapshot());
    return record;
  }

  async rewindFrom(stageId) {
    const index = this.stages.findIndex(stage => stage.id === stageId);
    if (index < 0) return false;
    const removed = this.stages.splice(index);
    this.graph.rewind(index);
    if (!this.stages.length) {
      this.currentFile = this.originalFile;
      this.currentMetadata = this.originalMetadata;
    } else {
      const previous = this.stages[this.stages.length - 1];
      if (this.storage?.readStageCache && previous.cacheKey) {
        const file = await this.storage.readStageCache(previous.cacheKey).catch(() => null);
        if (file?.size) this.currentFile = file;
      }
      this.currentMetadata = previous.metadata || this.originalMetadata;
    }
    await this._syncPinnedCaches();
    this._emit('change', this.snapshot());
    return true;
  }

  async undoLast() {
    if (!this.stages.length) return false;
    const removed = this.stages.pop();
    this.graph.undo();
    if (!this.stages.length) {
      this.currentFile = this.originalFile;
      this.currentMetadata = this.originalMetadata;
    } else if (this.storage?.readStageCache) {
      const previous = this.stages[this.stages.length - 1];
      const file = previous.cacheKey ? await this.storage.readStageCache(previous.cacheKey).catch(() => null) : null;
      if (file?.size) this.currentFile = file;
      this.currentMetadata = previous.metadata || this.currentMetadata;
    }
    await this._syncPinnedCaches();
    this._emit('change', this.snapshot());
    return true;
  }

  async clear() {
    if (this.storage?.deleteStageSession && this.sessionId) await this.storage.deleteStageSession(this.sessionId).catch(() => {});
    const file = this.originalFile;
    this.reset(file, this.originalMetadata);
  }

  async _syncPinnedCaches() {
    if (!this.storage?.pinStageCache) return;
    await this.storage.pinStageCache(this.stages.map(stage => stage.cacheKey).filter(Boolean)).catch(() => {});
    await this.storage.enforceStageCacheBudget?.({ protectNames: this.stages.map(stage => stage.cacheKey).filter(Boolean) }).catch(() => {});
  }

  snapshot() {
    return {
      sessionId: this.sessionId,
      runningStage: this.runningStage,
      count: this.stages.length,
      stages: this.stages.map(({ id, label, signature, nodeKey, parentKey, cacheHit, bytes, elapsedMs, createdAt }) => ({ id, label, signature, nodeKey, parentKey, cacheHit:Boolean(cacheHit), bytes, elapsedMs, createdAt })),
      currentBytes: Number(this.currentFile?.size || 0),
    };
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}

export function buildStageSettings(stageId, input) {
  const s = structuredCloneSafe(input);
  const off = () => ({ enabled: false, strength: 0 });
  const neutralEffects = {
    brightness:0, contrast:1, saturation:1, vibrance:0, gamma:1, temperature:0, exposure:0,
    highlights:0, shadows:0, whites:0, blacks:0, dehaze:0, vignette:0, grain:0,
    sharpenAmount:0, sharpenThreshold:.02, highPassAmount:0, denoiseAmount:0, temporalDenoise:0,
    antiFlicker:0, detailAmount:0, portraitSmooth:0,
  };
  const allStages = s.qualityLab?.stages || {};
  const groups = {
    restore: new Set(['denoise','temporalDenoise','deblock','deband','artifactRemoval','chromaDenoise','mosquitoNoise','compressionRecovery']),
    detail: new Set(['detailRecovery','fineDetailRecovery','textureRecovery','microTexture','structureRecovery','detailFusion','edgeRecovery']),
    sharp: new Set(['clarity','localContrast','smartSharpen','dehalo','antiRinging']),
    motion: new Set(['antiFlicker','temporalDetailStability']),
    rife: new Set(['antiFlicker','temporalDetailStability']),
  };

  s.quality = 'ULTRA';
  s.outputFormat = 'mp4';
  s.audioEnabled = true;
  s.audio = { ...(s.audio || {}), enabled: false };
  s.renderIntent = `apply-${stageId}`;
  s.blur = { ...(s.blur || {}), enabled: false, interpolation: false, preInterpolation: false };
  s.colorLab = { ...(s.colorLab || {}), enabled: false, lutStrength: 0 };
  s.faceModelId = null;
  s.upscaleModelId = null;
  s.rifeModelId = null;
  s.temporalReconstruction = { ...(s.temporalReconstruction || {}), enabled: false, strength: 0 };
  s.stabilization = { ...(s.stabilization || {}), enabled: false, strength: 0 };
  s.temporalMaster = { ...(s.temporalMaster || {}), enabled: false, strength: 0 };
  s.effects = { ...neutralEffects };
  s.qualityLab = { ...(s.qualityLab || {}), stages: Object.fromEntries(Object.entries(allStages).map(([id, value]) => [id, { ...value, enabled: false, strength: 0 }])) };
  s.faceLab = {
    ...(s.faceLab || {}), faceDetection: false,
    faceDetail: off(), skinCleanup: off(), skinSmoothing: off(), microContrast: off(), skinToneProtect: off(), eyeDetail: off(), hairDetail: off(),
  };

  // Intermediate passes preserve the current master geometry/fps unless the stage itself changes them.
  s.resolution = 'original';
  s.customWidth = 0; s.customHeight = 0;
  s.targetFps = null;

  if (['restore','detail','sharp'].includes(stageId)) {
    for (const id of groups[stageId]) if (allStages[id]) s.qualityLab.stages[id] = { ...allStages[id] };
    if (stageId === 'restore') {
      s.effects.denoiseAmount = Number(input.effects?.denoiseAmount || 0);
      s.effects.temporalDenoise = Number(input.effects?.temporalDenoise || 0);
    }
    if (stageId === 'detail') s.effects.detailAmount = Number(input.effects?.detailAmount || 0);
    if (stageId === 'sharp') {
      s.effects.sharpenAmount = Number(input.effects?.sharpenAmount || 0);
      s.effects.highPassAmount = Number(input.effects?.highPassAmount || 0);
    }
  } else if (stageId === 'face') {
    s.faceModelId = input.faceModelId;
    s.faceStrength = input.faceStrength;
    s.faceLab = structuredCloneSafe(input.faceLab || s.faceLab);
  } else if (stageId === 'upscale') {
    s.upscaleModelId = input.upscaleModelId;
    s.resolution = input.resolution;
    s.customWidth = input.customWidth; s.customHeight = input.customHeight;
    s.aspectRatio = input.aspectRatio; s.fitMode = input.fitMode;
  } else if (stageId === 'motion') {
    s.temporalMaster = structuredCloneSafe(input.temporalMaster || s.temporalMaster);
    s.temporalReconstruction = structuredCloneSafe(input.temporalReconstruction || s.temporalReconstruction);
    for (const id of groups.motion) if (allStages[id]) s.qualityLab.stages[id] = { ...allStages[id] };
  } else if (stageId === 'rife') {
    s.rifeModelId = input.rifeModelId;
    s.targetFps = input.targetFps;
    s.protectSceneCuts = input.protectSceneCuts;
    s.temporalMaster = structuredCloneSafe(input.temporalMaster || s.temporalMaster);
    s.temporalReconstruction = structuredCloneSafe(input.temporalReconstruction || s.temporalReconstruction);
    for (const id of groups.rife) if (allStages[id]) s.qualityLab.stages[id] = { ...allStages[id] };
  } else if (stageId === 'stabilize') {
    s.stabilization = structuredCloneSafe(input.stabilization || s.stabilization);
  } else if (stageId === 'blur') {
    s.blur = structuredCloneSafe(input.blur || s.blur);
    s.rifeModelId = s.blur?.interpolation ? input.rifeModelId : null;
  } else if (stageId === 'color') {
    s.colorLab = structuredCloneSafe(input.colorLab || s.colorLab);
    Object.assign(s.effects, {
      brightness:Number(input.effects?.brightness || 0), contrast:Number(input.effects?.contrast ?? 1), saturation:Number(input.effects?.saturation ?? 1), vibrance:Number(input.effects?.vibrance || 0),
      temperature:Number(input.effects?.temperature || 0), exposure:Number(input.effects?.exposure || 0), highlights:Number(input.effects?.highlights || 0), shadows:Number(input.effects?.shadows || 0), whites:Number(input.effects?.whites || 0), blacks:Number(input.effects?.blacks || 0), dehaze:Number(input.effects?.dehaze || 0), vignette:Number(input.effects?.vignette || 0), grain:Number(input.effects?.grain || 0),
    });
  }
  return s;
}

export function buildFinalExportSettings(input, appliedStageIds = []) {
  const s = structuredCloneSafe(input);
  const applied = new Set(appliedStageIds || []);
  s.renderIntent = 'final-export-from-apply-stack';
  s.outputFormat = 'mp4';
  s.quality = input.quality;
  s.export = structuredCloneSafe(input.export || {});
  s.audioEnabled = input.audioEnabled !== false;
  s.audio = structuredCloneSafe(input.audio || {});
  // Preserve requested final geometry/FPS unless that exact transform was already baked into the working master.
  // This prevents a face/denoise-only prepass from silently cancelling a later 4K or FPS export request.
  if (applied.has('upscale')) {
    s.resolution = 'original';
    s.customWidth = 0; s.customHeight = 0;
  }
  if (applied.has('rife') || applied.has('blur')) s.targetFps = null;
  const stages = s.qualityLab?.stages || {};
  const disableGroup = ids => { for (const id of ids) if (stages[id]) stages[id] = { ...stages[id], enabled:false, strength:0 }; };
  if (applied.has('restore')) {
    disableGroup(['denoise','temporalDenoise','deblock','deband','artifactRemoval','chromaDenoise','mosquitoNoise','compressionRecovery']);
    if (s.effects) { s.effects.denoiseAmount=0; s.effects.temporalDenoise=0; }
  }
  if (applied.has('detail')) {
    disableGroup(['detailRecovery','fineDetailRecovery','textureRecovery','microTexture','structureRecovery','detailFusion','edgeRecovery']);
    if (s.effects) s.effects.detailAmount=0;
  }
  if (applied.has('face')) {
    s.faceModelId=null; s.faceStrength=0;
    if (s.faceLab) {
      s.faceLab.faceDetection=false;
      for (const key of ['faceDetail','skinCleanup','skinSmoothing','microContrast','skinToneProtect','eyeDetail','hairDetail']) s.faceLab[key]={enabled:false,strength:0};
    }
  }
  if (applied.has('upscale')) s.upscaleModelId=null;
  if (applied.has('motion') || applied.has('rife')) {
    if (applied.has('rife')) s.rifeModelId=null;
    s.temporalMaster={...(s.temporalMaster||{}),enabled:false,strength:0};
    s.temporalReconstruction={...(s.temporalReconstruction||{}),enabled:false,strength:0};
    disableGroup(['antiFlicker','temporalDetailStability']);
  }
  if (applied.has('stabilize')) s.stabilization={...(s.stabilization||{}),enabled:false,strength:0};
  if (applied.has('blur')) s.blur={...(s.blur||{}),enabled:false,interpolation:false,preInterpolation:false};
  return s;
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
