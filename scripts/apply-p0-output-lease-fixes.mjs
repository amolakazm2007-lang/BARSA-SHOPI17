import fs from 'node:fs';

function patch(path, { from, to, already, label }) {
  let source = fs.readFileSync(path, 'utf8');
  if (already && source.includes(already)) {
    console.log(`${path}: ${label} already applied`);
    return;
  }
  if (!source.includes(from)) throw new Error(`${path}: missing marker for ${label}`);
  source = source.replace(from, to);
  fs.writeFileSync(path, source);
  console.log(`${path}: applied ${label}`);
}

patch('src/engine/StorageManager.js', {
  label: 'completed-output lease lifecycle',
  already: 'async completeSessionWithOutput(sessionId)',
  from: "  /** Cleans up an OPFS file + its checkpoint record — call after a successful download/export. */\n  async deleteSession(sessionId) {",
  to: `  /**\n   * Commits a validated native output without duplicating it into RAM. Resume-only\n   * artifacts are removed immediately, while the final OPFS MP4 remains leased to\n   * the UI until the result is replaced/cleared. The completed checkpoint lets\n   * startup pruning recover an orphaned lease after a renderer/process death.\n   */\n  async completeSessionWithOutput(sessionId) {\n    await this._drainSessionMutations(sessionId);\n    const checkpoint = await this.getCheckpoint(sessionId);\n    if (!checkpoint?.outputFileName) throw new Error(\`No validated output lease found for session "\${sessionId}"\`);\n    const root = await this._getRoot();\n    if (checkpoint.fileName) await root.removeEntry(checkpoint.fileName).catch(() => {});\n    if (checkpoint.sourceFileName) await root.removeEntry(checkpoint.sourceFileName).catch(() => {});\n    await this.deleteFrameCache(sessionId);\n    return this._mutateCheckpoint(sessionId, (current) => ({\n      ...current,\n      status: 'completed',\n      stage: 'completed',\n      progress: 1,\n      fileName: null,\n      sourceFileName: null,\n      completedAt: Date.now(),\n      updatedAt: Date.now(),\n    }));\n  }\n\n  /** Cleans up an OPFS file + its checkpoint record — call after a successful download/export. */\n  async deleteSession(sessionId) {`,
});

patch('src/engine/StorageManager.js', {
  label: 'null-safe session artifact deletion',
  already: "if (checkpoint.fileName) {\n        try {",
  from: "    if (checkpoint) {\n      try {\n        const root = await this._getRoot();\n        await root.removeEntry(checkpoint.fileName);\n      } catch { /* already gone — fine */ }\n      if (checkpoint.sourceFileName) {",
  to: "    if (checkpoint) {\n      if (checkpoint.fileName) {\n        try {\n          const root = await this._getRoot();\n          await root.removeEntry(checkpoint.fileName);\n        } catch { /* already gone — fine */ }\n      }\n      if (checkpoint.sourceFileName) {",
});

patch('src/engine/VideoPipeline.js', {
  label: 'lease native OPFS output until consumer release',
  already: 'const nativeOutputLeased = Boolean(nativeMp4?.opfsOutput);',
  from: `      // Native MP4 uses OPFS only as a bounded streaming scratch target. After\n      // the Blob has passed validation, remove the scratch entry so repeated\n      // renders do not silently consume storage. Blob/File snapshots remain\n      // readable after their OPFS directory entry is removed.\n      await nativeMp4?.releaseOutputFile?.();\n      // A successfully validated export no longer needs crash-resume artifacts.\n      // Remove the cached source, elementary stream, scratch output and\n      // checkpoint immediately; interrupted jobs remain untouched and resumable.\n      await storage.deleteSession(jobId).catch(() => {});\n      // Do not duplicate the completed export into the frame cache. The returned\n      // Blob/OPFS-backed native output is already the deliverable, while resume\n      // durability is provided by the elementary stream + checkpoints. A second\n      // full-size copy only burns storage bandwidth and quota at 4K/long renders.`,
  to: `      // OPFS-backed File/Blob objects are not portable snapshots in Chromium: deleting\n      // their directory entry can invalidate a blob: URL that has not finished opening.\n      // Keep exactly one durable final MP4 leased to the consumer, while removing\n      // resume/source/frame artifacts immediately. No second 4K copy is created.\n      const nativeOutputLeased = Boolean(nativeMp4?.opfsOutput);\n      if (nativeOutputLeased) await storage.completeSessionWithOutput(jobId);\n      else await storage.deleteSession(jobId).catch((cleanupError) => console.error('[BARSA][storage][completed-session-cleanup-failed]', { jobId, cleanupError }));\n      let outputLeaseReleased = false;\n      const releaseOutputLease = nativeOutputLeased ? async () => {\n        if (outputLeaseReleased) return;\n        outputLeaseReleased = true;\n        await storage.deleteSession(jobId);\n      } : null;\n      // The final file itself stays durable only while the result is owned by the UI.\n      // Crash/restart cleanup is covered by terminal-session pruning.`,
});

patch('src/engine/VideoPipeline.js', {
  label: 'return output lease releaser',
  already: 'release: releaseOutputLease,',
  from: "        fileName: `video-toolkit-pro-${jobId.slice(0, 8)}.${settings.outputFormat || 'mp4'}`,\n        metadata: {",
  to: "        fileName: `video-toolkit-pro-${jobId.slice(0, 8)}.${settings.outputFormat || 'mp4'}`,\n        release: releaseOutputLease,\n        metadata: {",
});

patch('src/main.js', {
  label: 'track active result lease',
  already: 'lastResultRelease=null',
  from: 'let sourceFile=null,sourceURL=null,resultURL=null,lastResultBlob=null,lastResultFileName=null,lastResultSessionId=null,lastResultSourceDateMs=0,lastResultMetadata=null,activeJobId=null,interruptedSession=null,previewEngine=null,sourceMetadata=null,sourceSelectionToken=0,workingPreviewToken=0,previewSeekTimer=null;',
  to: 'let sourceFile=null,sourceURL=null,resultURL=null,lastResultBlob=null,lastResultFileName=null,lastResultSessionId=null,lastResultSourceDateMs=0,lastResultMetadata=null,lastResultRelease=null,activeJobId=null,interruptedSession=null,previewEngine=null,sourceMetadata=null,sourceSelectionToken=0,workingPreviewToken=0,previewSeekTimer=null;',
});

patch('src/main.js', {
  label: 'release prepared output lease on clear',
  already: "preparedResult?.release?.().catch(error=>console.error('[BARSA][output-lease][prepared-release-failed]'",
  from: "function clearPreparedRender(notify=false){\n  if(preparedResult?.url&&preparedResult.url!==resultURL){try{URL.revokeObjectURL(preparedResult.url)}catch{}}\n  preparedResult=null;preparedSignature=null;preparedAt=0;refreshPreparedState();if(notify)toast('تم مسح التجهيز المسبق');\n}",
  to: "function clearPreparedRender(notify=false){\n  if(preparedResult?.url&&preparedResult.url!==resultURL){try{URL.revokeObjectURL(preparedResult.url)}catch{}}\n  if(preparedResult?.release&&preparedResult.release!==lastResultRelease)preparedResult.release().catch(error=>console.error('[BARSA][output-lease][prepared-release-failed]',error));\n  preparedResult=null;preparedSignature=null;preparedAt=0;refreshPreparedState();if(notify)toast('تم مسح التجهيز المسبق');\n}",
});

patch('src/main.js', {
  label: 'transfer result lease into UI ownership',
  already: 'lastResultRelease=r.release||null;',
  from: "function showResult(r){if(resultURL)URL.revokeObjectURL(resultURL);resultURL=r.url;lastResultBlob=r.blob;lastResultFileName=r.fileName;lastResultSessionId=r.metadata?.sessionId||null;lastResultSourceDateMs=Number(r.metadata?.sourceLastModified||0);lastResultMetadata=r.metadata||null;",
  to: "function showResult(r){if(resultURL&&resultURL!==r.url)URL.revokeObjectURL(resultURL);if(lastResultRelease&&lastResultRelease!==r.release)lastResultRelease().catch(error=>console.error('[BARSA][output-lease][result-release-failed]',error));resultURL=r.url;lastResultBlob=r.blob;lastResultFileName=r.fileName;lastResultSessionId=r.metadata?.sessionId||null;lastResultSourceDateMs=Number(r.metadata?.sourceLastModified||0);lastResultMetadata=r.metadata||null;lastResultRelease=r.release||null;",
});

patch('src/main.js', {
  label: 'release active result lease on reset',
  already: "lastResultRelease?.().catch(error=>console.error('[BARSA][output-lease][reset-release-failed]'",
  from: "if(sourceURL)URL.revokeObjectURL(sourceURL);if(resultURL)URL.revokeObjectURL(resultURL);sourceURL=null;resultURL=null;lastResultBlob=null;lastResultFileName=null;lastResultSessionId=null;lastResultSourceDateMs=0;lastResultMetadata=null;sourceFile=null;",
  to: "if(sourceURL)URL.revokeObjectURL(sourceURL);if(resultURL)URL.revokeObjectURL(resultURL);lastResultRelease?.().catch(error=>console.error('[BARSA][output-lease][reset-release-failed]',error));sourceURL=null;resultURL=null;lastResultBlob=null;lastResultFileName=null;lastResultSessionId=null;lastResultSourceDateMs=0;lastResultMetadata=null;lastResultRelease=null;sourceFile=null;",
});

patch('src/engine/ApplyStackEngine.js', {
  label: 'release transient native output after durable stage cache copy',
  already: 'await result.release?.();\n          result.release = null;',
  from: "        if (cacheKey && this.storage.readStageCache) {\n          const diskFile = await this.storage.readStageCache(cacheKey).catch(() => null);\n          if (diskFile?.size) nextFile = diskFile;\n        }\n      }\n\n      const record = {",
  to: "        if (cacheKey && this.storage.readStageCache) {\n          const diskFile = await this.storage.readStageCache(cacheKey).catch(() => null);\n          if (diskFile?.size) {\n            nextFile = diskFile;\n            await result.release?.();\n            result.release = null;\n          }\n        }\n      }\n\n      const record = {",
});
