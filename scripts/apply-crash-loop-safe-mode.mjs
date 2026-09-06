import { readFile, writeFile } from 'node:fs/promises';

async function patch(relativePath, transforms) {
  const path = new URL(`../${relativePath}`, import.meta.url);
  let source = await readFile(path, 'utf8');
  for (const { before, after, already, label } of transforms) {
    if (source.includes(already)) continue;
    if (!source.includes(before)) throw new Error(`Crash-loop safe-mode anchor missing in ${relativePath}: ${label}`);
    source = source.replace(before, after);
  }
  await writeFile(path, source);
}

await patch('src/main.js', [
  {
    before: "import { ThermalGuard } from './engine/ThermalGuard.js';\n",
    after: "import { ThermalGuard } from './engine/ThermalGuard.js';\nimport { CrashLoopSafeMode } from './engine/CrashLoopSafeMode.js';\n",
    already: "import { CrashLoopSafeMode } from './engine/CrashLoopSafeMode.js';",
    label: 'import',
  },
  {
    before: "const stages={analyzing:'تحليل الفيديو','caching-source':'حفظ نسخة الاستعادة','render-plan':'تهيئة خطة الرندر','resume-verified':'استئناف من نقطة الحفظ',processing:'معالجة وترميز الإطارات','ffmpeg-fallback':'معالجة محلية عبر FFmpeg','flushing-encoder':'إنهاء الترميز',remuxing:'دمج الفيديو والصوت','validating-output':'فحص ملف MP4 النهائي',completed:'اكتملت المعالجة',cancelled:'تم الإلغاء',failed:'فشلت المعالجة'};\nboot().catch(showFatalError);",
    after: `const stages={analyzing:'تحليل الفيديو','caching-source':'حفظ نسخة الاستعادة','render-plan':'تهيئة خطة الرندر','resume-verified':'استئناف من نقطة الحفظ',processing:'معالجة وترميز الإطارات','ffmpeg-fallback':'معالجة محلية عبر FFmpeg','flushing-encoder':'إنهاء الترميز',remuxing:'دمج الفيديو والصوت','validating-output':'فحص ملف MP4 النهائي',completed:'اكتملت المعالجة',cancelled:'تم الإلغاء',failed:'فشلت المعالجة'};\nconst crashLoopGuard=new CrashLoopSafeMode();\nconst startupSafety=crashLoopGuard.beginBoot();\nmanager.crashLoopGuard=crashLoopGuard;\nmanager.startupSafety=startupSafety;\nboot().then(()=>crashLoopGuard.markBootHealthy()).catch(error=>{\n  crashLoopGuard.markBootFailure(error,'boot');\n  manager.faultLedger?.record?.({code:error?.code||'STARTUP_FAILURE',subsystem:'startup',severity:'error',recoverable:false,message:error?.message||String(error),source:'main.boot'});\n  showFatalError(error);\n});`,
    already: 'const crashLoopGuard=new CrashLoopSafeMode();',
    label: 'startup guard',
  },
  {
    before: "async function boot(){document.documentElement.classList.toggle('native-android',androidBridge.available);wireInterface();installAutoModelRetryHooks();renderCustomSize();await ensureIsolatedRuntime();await requestPersistentStorage();const{resumable}=await manager.initialize();interruptedSession=resumable;const restoredPrefs=restoreSavedPreferences();const profile=manager.capabilities.deviceProfile;if(!restoredPrefs&&profile?.recommendedMode==='poco-f6'){byId('performanceMode').value='poco-f6';manager.engines.performance.setMode('poco-f6')}byId('backendBadge').textContent=manager.capabilities.webGPU?'WebGPU':manager.capabilities.webGL2?'WebGL2':'Canvas2D';byId('privacyBadge').textContent=manager.capabilities.opfs?'خاص · OPFS':'تخزين محدود';byId('capabilitiesText').textContent=manager.summary();renderHardwareReadiness();renderOutputReadiness();renderAiRuntimeStatus();await refreshModelStates();if(resumable)showRestoreBanner(resumable);scheduleAutomaticModelProvisioning()}",
    after: "async function boot(){document.documentElement.classList.toggle('native-android',androidBridge.available);document.documentElement.classList.toggle('barsa-safe-mode',startupSafety.safeMode);wireInterface();installAutoModelRetryHooks();renderCustomSize();await ensureIsolatedRuntime();await requestPersistentStorage();const{resumable}=await manager.initialize();interruptedSession=resumable;const restoredPrefs=restoreSavedPreferences();const profile=manager.capabilities.deviceProfile;if(!restoredPrefs&&profile?.recommendedMode==='poco-f6'){byId('performanceMode').value='poco-f6';manager.engines.performance.setMode('poco-f6')}byId('backendBadge').textContent=manager.capabilities.webGPU?'WebGPU':manager.capabilities.webGL2?'WebGL2':'Canvas2D';byId('privacyBadge').textContent=manager.capabilities.opfs?'خاص · OPFS':'تخزين محدود';byId('capabilitiesText').textContent=manager.summary();renderHardwareReadiness();renderOutputReadiness();renderAiRuntimeStatus();await refreshModelStates();if(resumable)showRestoreBanner(resumable);if(startupSafety.safeMode){manager.faultLedger?.record?.({code:'CRASH_LOOP_SAFE_MODE',subsystem:'startup',severity:'warning',recoverable:true,message:'Automatic heavy background model provisioning is suspended for this recovery boot.',source:'main.boot'});toast('BARSA Safe Mode: تم إيقاف التحميل الثقيل التلقائي لهذه الجلسة حتى يثبت الإقلاع السليم')}else scheduleAutomaticModelProvisioning()}",
    already: "code:'CRASH_LOOP_SAFE_MODE'",
    label: 'safe boot behavior',
  },
]);

await patch('src/engine/BarsaDoctor.js', [
  {
    before: "      await capture('runtime-fault-ledger', async () => {\n",
    after: `      await capture('startup-safety', async () => {\n        const startup = this.manager.startupSafety || { safeMode: false, failures: 0, reason: null };\n        const state = this.manager.crashLoopGuard?.snapshot?.() || null;\n        if (startup.safeMode) issues.push(issue('startup-safe-mode', 'medium', 'Crash-loop Safe Mode is active; automatic heavy background model provisioning is suspended for this recovery boot.'));\n        return { ...startup, state };\n      });\n\n      await capture('runtime-fault-ledger', async () => {\n`,
    already: "capture('startup-safety'",
    label: 'doctor startup safety',
  },
]);

console.log('Crash-loop Safe Mode integrated with startup and BARSA Doctor.');
