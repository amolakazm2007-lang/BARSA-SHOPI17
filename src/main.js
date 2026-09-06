import { APP_VERSION } from './version.js';
import { EngineManager } from './engine/EngineManager.js';
import { VideoPipeline } from './engine/VideoPipeline.js';
import { MODEL_REGISTRY } from './engine/UpscaleEngine.js';
import { RIFE_MODEL_REGISTRY } from './engine/RIFEEngine.js';
import { FACE_MODEL_REGISTRY } from './engine/FaceRestorationEngine.js';
import { FACE_DETECTOR_REGISTRY } from './engine/FaceDetectorEngine.js';
import { RealtimePreviewEngine } from './engine/RealtimePreviewEngine.js';
import { AutoFixEngine } from './engine/AutoFixEngine.js';
import { RenderEstimator, formatDuration } from './engine/RenderEstimator.js';
import { resolveOutputGeometry } from './engine/GeometryEngine.js';
import { EngineLabsUI } from './ui/EngineLabsUI.js';
import { ModelAutoProvisioner } from './engine/ModelAutoProvisioner.js';
import { AutoModelVault } from './engine/AutoModelVault.js';
import { AndroidBridge } from './platform/AndroidBridge.js';
import { SettingsStore } from './platform/SettingsStore.js';
import { CompactProUI } from './ui/CompactProUI.js';
import { ModelQuickUI } from './ui/ModelQuickUI.js';
import { ApplyStackEngine, buildStageSettings, buildFinalExportSettings } from './engine/ApplyStackEngine.js';
import { ThermalGuard } from './engine/ThermalGuard.js';

const manager=new EngineManager(),pipeline=new VideoPipeline(manager),byId=id=>document.getElementById(id),autoFix=new AutoFixEngine(),estimator=new RenderEstimator(),labs=new EngineLabsUI(manager),modelProvisioner=new ModelAutoProvisioner({onProgress:(event={})=>{const {role,modelId,stage,pct=0}=event;const status=byId('modelStatus');if(status)status.textContent=`${role}: ${modelId||''} · ${stage||'preparing'}${pct?` · ${Math.round(pct*100)}%`:''}`;quickModels?.updateProgress?.(role,event)}});
let preparedResult=null,preparedSignature=null,preparedAt=0;
let interactiveRefreshTimer=null,preparedStateTimer=null;
function scheduleInteractiveRefresh({preview=true,preflight=true,delay=90}={}){clearTimeout(interactiveRefreshTimer);interactiveRefreshTimer=setTimeout(()=>{if(preview)updatePreview();if(preflight)updatePreflightEstimate();},delay)}
function schedulePreparedStateRefresh(delay=140){clearTimeout(preparedStateTimer);preparedStateTimer=setTimeout(refreshPreparedState,delay)}

const modelVault=new AutoModelVault({manager,provisioner:modelProvisioner,registries:{upscale:MODEL_REGISTRY,rife:RIFE_MODEL_REGISTRY,face:FACE_MODEL_REGISTRY},onProgress:renderAutoModelProgress});
let sourceFile=null,sourceURL=null,resultURL=null,lastResultBlob=null,lastResultFileName=null,lastResultSessionId=null,lastResultSourceDateMs=0,lastResultMetadata=null,lastResultRelease=null,activeJobId=null,interruptedSession=null,previewEngine=null,sourceMetadata=null,sourceSelectionToken=0,workingPreviewToken=0,previewSeekTimer=null;
const androidBridge=new AndroidBridge();
const thermalGuard=new ThermalGuard(androidBridge);
const settingsStore=new SettingsStore();
const compactUI=new CompactProUI({labs,toast:message=>toast(message),onChange:()=>{scheduleInteractiveRefresh();schedulePreferenceSave()}});
const quickModels=new ModelQuickUI({toast:message=>toast(message),refresh:()=>schedulePreferenceSave()});
const applyStack=new ApplyStackEngine({storage:manager.engines.storage});
const modelSelection={upscale:'realesr-general-x4v3-turbo',rife:'rife-tensorstack',face:'gfpgan-1.4'};
const stages={analyzing:'تحليل الفيديو','caching-source':'حفظ نسخة الاستعادة','render-plan':'تهيئة خطة الرندر','resume-verified':'استئناف من نقطة الحفظ',processing:'معالجة وترميز الإطارات','ffmpeg-fallback':'معالجة محلية عبر FFmpeg','flushing-encoder':'إنهاء الترميز',remuxing:'دمج الفيديو والصوت','validating-output':'فحص ملف MP4 النهائي',completed:'اكتملت المعالجة',cancelled:'تم الإلغاء',failed:'فشلت المعالجة'};
boot().catch(showFatalError);

function wireMasterTabs(){const tabs=[...document.querySelectorAll('[data-master-target]')],panels=[...document.querySelectorAll('[data-master-panel]')],mount=byId('engineLabsMount');const activate=name=>{tabs.forEach(btn=>btn.classList.toggle('active',btn.dataset.masterTarget===name));panels.forEach(panel=>{const active=panel.dataset.masterPanel===name;panel.hidden=!active;panel.classList.toggle('active',active)});document.body.dataset.masterPanel=name;if(name==='enhance')labs.setActiveLab('quality');if(name==='blur'){const enhancePanel=document.querySelector('[data-master-panel="enhance"]');enhancePanel.hidden=false;enhancePanel.classList.add('active');panels.forEach(panel=>{if(panel!==enhancePanel&&panel.dataset.masterPanel!=='blur'){panel.hidden=true;panel.classList.remove('active')}});labs.setActiveLab('blur');setTimeout(()=>mount?.scrollIntoView({behavior:'smooth',block:'start'}),120)}if(name==='render'){setTimeout(()=>byId('startBtn')?.scrollIntoView({behavior:'smooth',block:'center'}),120)}};tabs.forEach(btn=>btn.addEventListener('click',()=>activate(btn.dataset.masterTarget)));activate('studio')}

async function boot(){document.documentElement.classList.toggle('native-android',androidBridge.available);wireInterface();installAutoModelRetryHooks();renderCustomSize();await ensureIsolatedRuntime();await requestPersistentStorage();const{resumable}=await manager.initialize();interruptedSession=resumable;const restoredPrefs=restoreSavedPreferences();const profile=manager.capabilities.deviceProfile;if(!restoredPrefs&&profile?.recommendedMode==='poco-f6'){byId('performanceMode').value='poco-f6';manager.engines.performance.setMode('poco-f6')}byId('backendBadge').textContent=manager.capabilities.webGPU?'WebGPU':manager.capabilities.webGL2?'WebGL2':'Canvas2D';byId('privacyBadge').textContent=manager.capabilities.opfs?'خاص · OPFS':'تخزين محدود';byId('capabilitiesText').textContent=manager.summary();renderHardwareReadiness();renderOutputReadiness();renderAiRuntimeStatus();await refreshModelStates();if(resumable)showRestoreBanner(resumable);scheduleAutomaticModelProvisioning()}

function wireInterface(){labs.mount({onChange:()=>{scheduleInteractiveRefresh();schedulePreferenceSave()},onToast:toast});compactUI.mount();quickModels.mount();wireApplyStackUI();wireMasterTabs();const exportMode=byId('exportVideoMode'),exportBitrate=byId('exportVideoBitrateMbps');const syncExportMode=()=>{exportBitrate.disabled=exportMode.value!=='custom';updatePreflightEstimate()};exportMode.addEventListener('change',syncExportMode);exportBitrate.addEventListener('change',updatePreflightEstimate);byId('exportAudioBitrateK').addEventListener('change',updatePreflightEstimate);byId('exportAcceleration').addEventListener('change',renderOutputReadiness);document.querySelectorAll('[data-export-preset]').forEach(button=>button.addEventListener('click',()=>{const preset=button.dataset.exportPreset;if(preset==='social'){exportMode.value='auto';byId('exportAudioBitrateK').value='192';byId('exportAcceleration').value='auto'}else if(preset==='master'){exportMode.value='max';byId('exportAudioBitrateK').value='320';byId('exportAcceleration').value='hardware'}else if(preset==='poco'){exportMode.value='auto';byId('exportAudioBitrateK').value='192';byId('exportAcceleration').value='hardware';byId('performanceMode').value='poco-f6';manager.engines.performance.setMode('poco-f6')}else if(preset==='custom40'){exportMode.value='custom';exportBitrate.value='40';byId('exportAudioBitrateK').value='256';byId('exportAcceleration').value='hardware'}syncExportMode();renderOutputReadiness();toast(`تم تطبيق إعداد التصدير: ${button.textContent.trim()}`)}));syncExportMode();document.querySelector('.controls-panel')?.addEventListener('change',()=>schedulePreparedStateRefresh(40),{passive:true});document.querySelector('.controls-panel')?.addEventListener('input',()=>schedulePreparedStateRefresh(160),{passive:true});const dropzone=byId('dropzone'),input=byId('videoInput');input.addEventListener('change',()=>{const f=input.files?.[0];if(f)selectSource(f);input.value=''});dropzone.addEventListener('dragover',e=>{e.preventDefault();dropzone.classList.add('dragging')});dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('dragging'));dropzone.addEventListener('drop',e=>{e.preventDefault();dropzone.classList.remove('dragging');const f=e.dataTransfer.files?.[0];if(f?.type.startsWith('video/'))selectSource(f);else toast('اختر ملف فيديو صالحًا')});byId('changeVideoBtn').addEventListener('click',()=>input.click());byId('newJobBtn').addEventListener('click',resetInterface);byId('startBtn').addEventListener('click',startProcessing);byId('prepareEffectsBtn')?.addEventListener('click',prepareEffects);byId('clearPreparedBtn')?.addEventListener('click',()=>clearPreparedRender(true));byId('nativeSaveBtn')?.addEventListener('click',saveResultToAndroid);byId('renderProofBtn')?.addEventListener('click',downloadRenderProof);byId('blur-render-only')?.addEventListener('click',startBlurOnlyProcessing);byId('pauseBtn').addEventListener('click',togglePause);byId('cancelBtn').addEventListener('click',()=>activeJobId&&manager.cancelJob(activeJobId));
document.querySelectorAll('.preset').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.preset').forEach(x=>x.classList.toggle('active',x===b));applyPreset(b.dataset.preset)}));document.querySelectorAll('[data-import]').forEach(b=>b.addEventListener('click',()=>byId(`${b.dataset.import}ModelInput`).click()));document.querySelectorAll('[data-install]').forEach(b=>b.addEventListener('click',()=>installCatalogModel(b.dataset.install)));byId('upscaleModelInput').addEventListener('change',e=>importModel('upscale',e.target.files?.[0]));byId('rifeModelInput').addEventListener('change',e=>importModel('rife',e.target.files?.[0]));byId('faceModelInput').addEventListener('change',e=>importModel('face',e.target.files?.[0]));
byId('faceDetectorImportBtn').addEventListener('click',()=>byId('faceDetectorModelInput').click());byId('faceDetectorInstallBtn').addEventListener('click',installFaceDetector);byId('faceDetectorModelInput').addEventListener('change',e=>importFaceDetector(e.target.files?.[0]));
for(const role of ['upscale','rife','face'])byId(`${role}ModelProfile`).addEventListener('change',async e=>{modelSelection[role]=e.target.value;await refreshModelStates()});byId('nihuiImportBtn').addEventListener('click',()=>byId('nihuiModelInput').click());byId('nihuiModelInput').addEventListener('change',e=>importNihuiPack(e.target.files));
for(const name of ['brightness','contrast','saturation','vibrance','sharpen','detail','highPass','denoise','temporalDenoise','antiFlicker','portraitSmooth','temperature','exposure','highlights','shadows','whites','blacks','dehaze','vignette','grain','faceStrength']){const el=byId(name),out=byId(`${name}Out`);el.addEventListener('input',()=>{out.value=Number(el.value).toFixed(2);scheduleInteractiveRefresh({delay:120})})}for(const id of ['resolution','aspectRatio','fitMode','targetFps','quality','outputFormat','audioEnabled','audioCleanEnabled','protectSceneCuts'])byId(id).addEventListener('change',()=>{renderCustomSize();scheduleInteractiveRefresh({delay:70});renderOutputReadiness()});
for(const role of ['upscale','rife','face'])byId(`${role}Enabled`).addEventListener('change',async e=>{
  if(e.target.checked){const available=(await manager.engines[role].isAvailable(modelSelection[role])).available;if(!available){e.target.checked=false;const installed=await installCatalogModel(role,{silent:false});if(installed)e.target.checked=true}}
  renderCustomSize();updatePreview();updatePreflightEstimate();renderOutputReadiness();
});for(const id of ['customWidth','customHeight'])byId(id).addEventListener('input',()=>scheduleInteractiveRefresh({delay:140}));byId('performanceMode').addEventListener('change',()=>{manager.engines.performance.setMode(byId('performanceMode').value);updatePreflightEstimate()});
    byId('previewPlayBtn').addEventListener('click',togglePreviewPlayback);byId('previewSeek').addEventListener('input',()=>{const v=byId('sourceVideo'),seek=byId('previewSeek');if(!Number.isFinite(v.duration))return;clearTimeout(previewSeekTimer);previewSeekTimer=setTimeout(()=>{v.currentTime=v.duration*Number(seek.value)/1000},45)});byId('compareBtn').addEventListener('click',()=>{const b=byId('compareBtn');b.classList.toggle('active');const enabled=b.classList.contains('active');previewEngine?.setCompare(enabled);byId('compareLine').hidden=!enabled;document.querySelectorAll('.compare-label').forEach(x=>{x.hidden=!enabled})});byId('autoFixBtn').addEventListener('click',runAutoFix);byId('modelsBtn').addEventListener('click',async()=>{byId('modelsDialog').showModal();await refreshModelHealth()});byId('closeModelsBtn').addEventListener('click',()=>byId('modelsDialog').close());byId('modelHealthRole').addEventListener('change',refreshModelHealth);byId('modelAuditAllBtn')?.addEventListener('click',auditAllInstalledModels);byId('modelRetestBtn').addEventListener('click',retestSelectedModel);byId('modelRepairBtn').addEventListener('click',repairSelectedModel);byId('modelReplaceBtn').addEventListener('click',()=>byId(`${byId('modelHealthRole').value}ModelInput`).click());byId('modelDeleteBtn').addEventListener('click',deleteSelectedModel);byId('modelSourceBtn').addEventListener('click',openSelectedModelSource);byId('modelURLBtn').addEventListener('click',importSelectedModelURL);byId('autoModelsBtn')?.addEventListener('click',()=>runAutoModelVault({includeFace:false,userInitiated:true}));byId('fullModelsBtn')?.addEventListener('click',()=>runAutoModelVault({includeFace:true,includeAllCatalog:true,userInitiated:true,forceExtended:true}));const autoFull=byId('autoFullModelsToggle');if(autoFull){autoFull.checked=localStorage.getItem('barsa.autoFullModels')!=='off';autoFull.addEventListener('change',()=>{localStorage.setItem('barsa.autoFullModels',autoFull.checked?'on':'off');if(autoFull.checked)scheduleAutomaticModelProvisioning()})}
const temporalRange=byId('temporalMasterStrength'),temporalNumber=byId('temporalMasterStrengthNumber'),temporalOut=byId('temporalMasterStrengthOut');const syncTemporal=(value)=>{const v=Math.max(0,Math.min(1,Number(value)||0));temporalRange.value=v;temporalNumber.value=v.toFixed(2);temporalOut.value=v.toFixed(2);scheduleInteractiveRefresh({preview:false,preflight:true,delay:140})};temporalRange?.addEventListener('input',()=>syncTemporal(temporalRange.value));temporalNumber?.addEventListener('input',()=>syncTemporal(temporalNumber.value));byId('temporalMasterEnabled')?.addEventListener('change',updatePreflightEstimate);wireAllEngineBoost();byId('savePrefsBtn')?.addEventListener('click',()=>{savePreferences();toast('تم حفظ إعداداتك الاحترافية')});byId('resetPrefsBtn')?.addEventListener('click',()=>{settingsStore.clear();resetProfessionalDefaults();toast('تمت استعادة الإعدادات الافتراضية')});document.querySelector('.controls-panel')?.addEventListener('change',schedulePreferenceSave);document.querySelector('.controls-panel')?.addEventListener('input',schedulePreferenceSave);
manager.addEventListener('jobchange',({detail})=>{if(detail.id===activeJobId)renderJob(detail)});manager.engines.performance.addEventListener('telemetry',({detail})=>renderTelemetry(detail));manager.addEventListener('warning',({detail})=>{if(detail.code==='MEMORY_PRESSURE')toast('تم تقليل حجم البلاطات تلقائيًا لحماية الذاكرة')});byId('helpBtn')?.addEventListener('click',()=>byId('helpDialog')?.showModal());byId('closeHelpBtn')?.addEventListener('click',()=>byId('helpDialog')?.close());byId('doctorBtn')?.addEventListener('click',()=>{byId('capabilitiesDialog').showModal();setTimeout(()=>byId('doctorQuickBtn')?.scrollIntoView({behavior:'smooth',block:'center'}),80)});byId('capabilitiesBtn').addEventListener('click',()=>byId('capabilitiesDialog').showModal());byId('closeCapabilitiesBtn').addEventListener('click',()=>byId('capabilitiesDialog').close());byId('hardwareTestBtn').addEventListener('click',runHardwareTest);byId('doctorQuickBtn')?.addEventListener('click',()=>runBarsaDoctor('quick'));byId('doctorFullBtn')?.addEventListener('click',()=>runBarsaDoctor('full'));byId('doctorStressBtn')?.addEventListener('click',()=>runBarsaDoctor('stress'));byId('doctorRepairBtn')?.addEventListener('click',repairBarsaDoctor);byId('restoreBtn').addEventListener('click',restoreInterrupted);byId('dismissRestoreBtn').addEventListener('click',dismissInterrupted);window.addEventListener('unhandledrejection',e=>{e.preventDefault();showError(e.reason)});window.addEventListener('error',e=>showError(e.error||new Error(e.message)));window.addEventListener('barsa-memory-pressure',()=>{previewEngine?.pause();scheduleInteractiveRefresh({preview:false,preflight:true,delay:300});toast('تم تخفيف المعاينة تلقائياً لحماية الذاكرة')});window.addEventListener('beforeunload',e=>{if(!activeJobId)return;e.preventDefault();e.returnValue=''})}

async function selectSource(file){
  if(!file?.size||activeJobId)return;
  const selectionToken=++sourceSelectionToken;
  clearPreparedRender(false);
  previewEngine?.destroy();previewEngine=null;
  const previousURL=sourceURL;
  sourceFile=file;sourceMetadata=null;
  sourceURL=URL.createObjectURL(file);
  if(previousURL)URL.revokeObjectURL(previousURL);
  const video=byId('sourceVideo');
  video.src=sourceURL;
  try{
    await once(video,'loadedmetadata','error');
    if(selectionToken!==sourceSelectionToken)return;
    const probe=await manager.engines.media.probe(file).catch(()=>null);
    if(selectionToken!==sourceSelectionToken)return;
    sourceMetadata=probe||{width:video.videoWidth,height:video.videoHeight,duration:video.duration,fps:30,hasAudio:true};
    if(!sourceMetadata.width||!sourceMetadata.height||!Number.isFinite(sourceMetadata.duration))throw new Error('بيانات الفيديو غير صالحة');
    applyStack.reset(file,sourceMetadata);renderApplyStack();
    const flags=[sourceMetadata.variableFrameRate?'VFR':`${sourceMetadata.fps.toFixed(2)} FPS`,sourceMetadata.hdr?'HDR':null,sourceMetadata.codec].filter(Boolean).join(' · ');
    byId('sourceInfo').textContent=`${sourceMetadata.width}×${sourceMetadata.height} · ${formatClock(sourceMetadata.duration)} · ${formatBytes(file.size)} · ${flags}`;
    byId('dropzone').hidden=true;byId('previewShell').hidden=false;byId('progressPanel').hidden=true;byId('resultPanel').hidden=true;byId('startBtn').disabled=false;byId('prepareEffectsBtn')&&(byId('prepareEffectsBtn').disabled=false);byId('autoFixBtn').disabled=false;
    previewEngine=new RealtimePreviewEngine(video,byId('outputCanvas'));
    previewEngine.addEventListener('frame',({detail})=>{if(selectionToken!==sourceSelectionToken)return;byId('previewSeek').value=detail.duration?Math.round(detail.currentTime/detail.duration*1000):0;byId('previewTime').textContent=`${formatClock(detail.currentTime)} / ${formatClock(detail.duration)}`;const badge=byId('previewBackendBadge');badge.textContent=detail.backend==='webgl2'?'LIVE GPU':'LIVE CPU';badge.classList.toggle('cpu',detail.backend!=='webgl2')});
    video.onplay=()=>{byId('previewPlayBtn').textContent='❚❚';previewEngine?.requestRender()};video.onpause=()=>{byId('previewPlayBtn').textContent='▶';previewEngine?.requestRender()};video.onseeked=()=>previewEngine?.requestRender();
    await previewEngine.initialize();
    if(selectionToken!==sourceSelectionToken){previewEngine?.destroy();return;}
    updatePreview();updatePreflightEstimate();
    if(sourceMetadata.hdr)toast('تنبيه: إخراج H.264 الحالي SDR ‏8-bit؛ راجع الألوان قبل الرندر');
  }catch(error){
    if(selectionToken!==sourceSelectionToken)return;
    console.warn('Source selection failed',error);
    previewEngine?.destroy();previewEngine=null;sourceFile=null;sourceMetadata=null;
    if(sourceURL){URL.revokeObjectURL(sourceURL);sourceURL=null}
    video.removeAttribute('src');video.load?.();
    byId('dropzone').hidden=false;byId('previewShell').hidden=true;byId('startBtn').disabled=true;byId('prepareEffectsBtn')&&(byId('prepareEffectsBtn').disabled=true);byId('autoFixBtn').disabled=true;
    toast(`تعذر فتح هذا الفيديو${error?.message?` · ${error.message}`:''}`);
  }
}

function preparedSettingsSignature(settings=collectSettings()){
  const source={name:sourceFile?.name||'',size:Number(sourceFile?.size||0),lastModified:Number(sourceFile?.lastModified||0)};
  return JSON.stringify({source,settings});
}
function refreshPreparedState(){
  const card=byId('preparedRenderCard'),badge=byId('preparedRenderBadge'),state=byId('preparedRenderState'),clear=byId('clearPreparedBtn');
  if(!card||!badge||!state)return;
  const current=sourceFile?preparedSettingsSignature():null,ready=!!preparedResult&&preparedSignature===current,stale=!!preparedResult&&!ready;
  card.classList.toggle('ready',ready);card.classList.toggle('stale',stale);
  badge.textContent=ready?'جاهز ✓':stale?'تغيّرت الإعدادات':'غير مجهّز';
  clear&&(clear.hidden=!preparedResult);
  if(ready){const age=Math.max(0,Math.round((Date.now()-preparedAt)/1000));state.textContent=`كل التأثيرات مطبقة ومخزنة مؤقتاً · الرندر النهائي سيستخدم الكاش الجاهز · منذ ${age}ث`;}
  else if(stale)state.textContent='الكاش القديم لن يُستخدم لأن الإعدادات تغيّرت. اضغط «طبّق التأثيرات الآن» لتحديثه.';
  else state.textContent=sourceFile?'جهّز النماذج ثم اضغط «طبّق التأثيرات الآن».':'اختر فيديو ثم جهّز النماذج والتأثيرات.';
}
function clearPreparedRender(notify=false){
  if(preparedResult?.url&&preparedResult.url!==resultURL){try{URL.revokeObjectURL(preparedResult.url)}catch{}}
  if(preparedResult?.release&&preparedResult.release!==lastResultRelease)preparedResult.release().catch(error=>console.error('[BARSA][output-lease][prepared-release-failed]',error));
  preparedResult=null;preparedSignature=null;preparedAt=0;refreshPreparedState();if(notify)toast('تم مسح التجهيز المسبق');
}
async function prepareEffects(){
  if(!sourceFile||activeJobId)return;
  const settings=collectSettings(),signature=preparedSettingsSignature(settings),button=byId('prepareEffectsBtn'),card=byId('preparedRenderCard'),state=byId('preparedRenderState');
  button&&(button.disabled=true);card?.classList.add('processing');if(state)state.textContent='جارٍ تجهيز النماذج ثم تطبيق جميع التأثيرات على الفيديو…';
  try{
    clearPreparedRender(false);
    const result=await runProcessingWithSettings(settings,'prepare-effects',{deferShow:true});
    if(!result)return;
    preparedResult=result;preparedSignature=signature;preparedAt=Date.now();
    result.metadata={...(result.metadata||{}),preparedRender:true,preparedAt:new Date(preparedAt).toISOString()};
    refreshPreparedState();toast('تم تطبيق جميع التأثيرات وحفظ الناتج المؤقت · الرندر النهائي صار خفيفاً إذا ما غيّرت الإعدادات');
  }finally{button&&(button.disabled=false);card?.classList.remove('processing')}
}
async function startProcessing(){
  if(!sourceFile||activeJobId)return;
  const settings=collectSettings(),signature=preparedSettingsSignature(settings);
  if(applyStack.hasAppliedStages){
    const stale=applyStack.stages.find(stage=>{
      try{
        const saved=JSON.parse(stage.signature||'{}')?.settings;
        return saved&&JSON.stringify(saved)!==JSON.stringify(buildStageSettings(stage.id,settings));
      }catch{return true}
    });
    if(stale){toast(`تغيّرت إعدادات ${stale.label} · أعد تطبيقها قبل التصدير حتى لا نستخدم نتيجة قديمة`);return;}
    const finalSettings=buildFinalExportSettings(settings,applyStack.stages.map(stage=>stage.id));
    const current=applyStack.currentSource;
    const currentMeta=await manager.engines.media.probe(current).catch(()=>applyStack.currentMeta||sourceMetadata);
    toast(`الرندر النهائي سيستخدم ${applyStack.stages.length} مرحلة مطبقة بدون إعادة AI`);
    return runProcessingWithSettings(finalSettings,'final-export-from-apply-stack',{inputFile:current,inputMetadata:currentMeta});
  }
  if(preparedResult&&preparedSignature===signature){
    preparedResult.metadata={...(preparedResult.metadata||{}),preparedCacheHit:true,finalizedAt:new Date().toISOString()};
    estimator.start();showResult(preparedResult);toast('تم الرندر النهائي من التجهيز المسبق بدون إعادة تشغيل محركات AI');return preparedResult;
  }
  return runProcessingWithSettings(settings,'video-process');
}

async function startBlurOnlyProcessing(){
  if(!sourceFile||activeJobId)return;
  const settings=collectSettings();
  if(!settings.blur?.enabled){toast('فعّل محرك BLUR أولاً');return;}
  const b=settings.blur;
  settings.renderIntent='blur-only';
  settings.outputFormat='mp4';
  settings.upscaleModelId=null;
  settings.faceModelId=null;
  settings.faceLab={faceDetection:false,faceDetail:{enabled:false,strength:0},skinCleanup:{enabled:false,strength:0},skinSmoothing:{enabled:false,strength:0},microContrast:{enabled:false,strength:0},skinToneProtect:{enabled:false,strength:0},eyeDetail:{enabled:false,strength:0},hairDetail:{enabled:false,strength:0}};
  settings.qualityLab={mode:'natural',sceneAware:false,stages:{}};
  settings.temporalReconstruction={enabled:false,strength:0,historyFrames:1,motionProtection:1};
  settings.stabilization={enabled:false,strength:0,crop:0,maxShift:2,smoothing:.88};
  settings.temporalMaster={enabled:false,strength:0};
  settings.colorLab={...settings.colorLab,enabled:false,lutStrength:0};
  settings.effects={
    ...settings.effects,
    brightness:b.filtersEnabled?Math.max(-1,Math.min(1,Number(b.filterBrightness||1)-1)):0,
    contrast:b.filtersEnabled?Math.max(.1,Math.min(2.5,Number(b.filterContrast||1))):1,
    saturation:b.filtersEnabled?Math.max(0,Math.min(2.5,Number(b.filterSaturation||1))):1,
    vibrance:0,temperature:0,exposure:0,highlights:0,shadows:0,whites:0,blacks:0,dehaze:0,vignette:0,grain:0,
    sharpenAmount:0,highPassAmount:0,denoiseAmount:0,temporalDenoise:0,antiFlicker:0,detailAmount:0,portraitSmooth:0,
    deblockAmount:0,debandAmount:0,artifactRemoval:0,fineDetailRecovery:0,textureRecovery:0,edgeRecovery:0,clarity:0,localContrast:0,dehalo:0,antiRinging:0,temporalDetailStability:0,
  };
  settings.quality=blurCrfToQuality(b.renderQualityCrf,b.renderPreset);
  settings.export={...settings.export,acceleration:b.gpuEncoding===false?'software':(b.encoderSelection==='software'?'software':b.encoderSelection==='hardware'?'hardware':'auto')};
  return runProcessingWithSettings(settings,'blur-only');
}

function blurCrfToQuality(crf=16,preset='balanced'){
  const value=Math.max(0,Math.min(35,Number(crf)||16));
  if(value<=13)return'ULTRA';
  if(value<=18)return preset==='quality'?'ULTRA':'HIGH';
  if(value<=23)return preset==='quality'?'HIGH':'BALANCED';
  return preset==='fast'?'LOW':'BALANCED';
}

function buildBlurFileName(sourceName,blur){
  const stem=String(sourceName||'video').replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N}._ -]+/gu,'_').trim().slice(0,64)||'video';
  if(!blur?.detailedFilenames)return`${stem}_BARSA_BLUR.mp4`;
  const fps=blur.outputFps==='source'?'SRC':blur.outputFps==='custom'?`${Math.round(Number(blur.customOutputFps)||60)}FPS`:`${blur.outputFps}FPS`;
  const amount=Number(blur.amount||0).toFixed(2).replace('.','p');
  const weighting=String(blur.weighting||'equal').replace(/[^a-z0-9_-]/gi,'');
  return`${stem}_BARSA_BLUR_A${amount}_${fps}_${weighting}.mp4`;
}

async function runProcessingWithSettings(settings,jobType='video-process',{deferShow=false,inputFile=sourceFile,inputMetadata=sourceMetadata,resumeCheckpoint=null}={}){if(!inputFile||activeJobId)return;const effectiveSettings=resumeCheckpoint?{...settings,__resumeSession:true}:settings;try{resolveOutputGeometry(inputMetadata.width,inputMetadata.height,effectiveSettings);await validateEnabledModels(effectiveSettings,inputMetadata);const thermal=thermalGuard.preflight();if(!thermal.ok)throw new Error('الجهاز تحت ضغط حراري شديد. انتظر قليلاً ثم أعد المحاولة حتى نحافظ على الجودة والاستقرار.')}catch(error){toast(error.message);return}manager.engines.performance.setMode(effectiveSettings.performanceMode);await manager.engines.deviceGuard.acquire();androidBridge.setKeepScreenOn(true);const job=resumeCheckpoint?manager.createResumeJob(resumeCheckpoint,jobType):manager.createJob(jobType,effectiveSettings);activeJobId=job.id;thermalGuard.start({pause:()=>{const j=manager.publicJob(job.id);if(j?.state!=='running')return false;const paused=manager.pauseJob(job.id);if(paused)toast('تم إيقاف المعالجة مؤقتاً بسبب الحرارة العالية');return paused},resume:()=>{const j=manager.publicJob(job.id);if(j?.state!=='paused')return false;const resumed=manager.resumeJob(job.id);if(resumed)toast('عادت الحرارة لمستوى آمن وتمت متابعة المعالجة');return resumed},onState:info=>{job.thermalStatus=info.status;job.thermalHeadroom=info.headroom;manager.engines.performance.setThermalInfo?.(info)}});estimator.start();byId('previewShell').hidden=true;byId('resultPanel').hidden=true;byId('progressPanel').hidden=false;setControlsDisabled(true);try{const result=await manager.runJob(job.id,context=>pipeline.run({jobId:job.id,file:inputFile,previewCanvas:byId('outputCanvas'),settings:effectiveSettings},context));if(jobType==='blur-only'){result.fileName=buildBlurFileName(sourceFile?.name,effectiveSettings.blur);result.metadata={...(result.metadata||{}),sourceLastModified:effectiveSettings.blur?.copyDates?Number(sourceFile?.lastModified||0):0}}if(!deferShow)showResult(result);else{byId('progressPanel').hidden=true;byId('previewShell').hidden=false}return result}catch(error){if(error?.name!=='AbortError')showError(error);byId('progressPanel').hidden=true;byId('previewShell').hidden=false}finally{thermalGuard.stop();manager.engines.performance.setThermalInfo?.(null);androidBridge.setKeepScreenOn(false);await manager.engines.deviceGuard.release();androidBridge.releaseNativeAiMemory();activeJobId=null;setControlsDisabled(false)}}


function wireApplyStackUI(){
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-apply-stage]');
    if(!button)return;
    const stageId=button.dataset.applyStage;
    if(stageId)applyStageFromUI(stageId,button);
  });
  byId('undoApplyStageBtn')?.addEventListener('click',async()=>{
    if(activeJobId)return;
    const ok=await applyStack.undoLast();
    if(ok){await loadWorkingPreview();renderApplyStack();toast('تم الرجوع للمرحلة السابقة');}
  });
  byId('clearApplyStackBtn')?.addEventListener('click',async()=>{
    if(activeJobId)return;
    await applyStack.clear();
    applyStack.reset(sourceFile,sourceMetadata);
    await loadWorkingPreview(true);renderApplyStack();toast('تم الرجوع للفيديو الأصلي');
  });
  applyStack.addEventListener('change',renderApplyStack);
  wireBatchStageControls();
  wireProjectSettingsIO();
}

async function applyStageFromUI(stageId,button){
  if(!sourceFile||activeJobId||applyStack.runningStage)return false;
  const heavyStages=new Set(['restore','detail','face','upscale','motion','rife','stabilize','blur']);
  if(!heavyStages.has(stageId)){toast('هذا تأثير خفيف؛ يبقى مباشر وينطبق بالرندر النهائي بدون مرحلة مسبقة');return false;}
  const toggleMap={restore:'cp-restore-on',detail:'cp-detail-on',face:'cp-face-on',motion:'cp-motion-on',stabilize:'cp-stabilize-on'};
  const modelMap={upscale:'upscaleEnabled',rife:'rifeEnabled',face:'faceEnabled'};
  const toggleId=toggleMap[stageId]; if(toggleId&&!byId(toggleId)?.checked){byId(toggleId).checked=true;byId(toggleId).dispatchEvent(new Event('change',{bubbles:true}));}
  const modelToggle=modelMap[stageId]; if(modelToggle&&!byId(modelToggle)?.checked){byId(modelToggle).checked=true;byId(modelToggle).dispatchEvent(new Event('change',{bubbles:true}));}
  if(stageId==='rife'&&byId('targetFps').value==='original'){toast('اختَر 60 أو 120 FPS أولاً حتى RIFE يغيّر الحركة');return false;}
  if(stageId==='upscale'&&byId('resolution').value==='original'){toast('اختَر دقة أعلى أولاً مثل 1080p أو 4K ثم طبّق الدقة');return false;}
  if(stageId==='blur'&&!labs.collect().blur?.enabled){toast('فعّل BLUR أولاً ثم اضغط تطبيق');return false;}
  const all=collectSettings();
  if(applyStack.getStage(stageId)){
    await applyStack.rewindFrom(stageId);
    await loadWorkingPreview();
    toast('تم الرجوع تلقائياً لما قبل هذه المرحلة حتى لا تتكرر المعالجة فوق نفسها');
  }
  const stageSettings=buildStageSettings(stageId,all);
  const signature=JSON.stringify({stageId,settings:stageSettings,sourceSize:Number(applyStack.currentSource?.size||0)});
  const state=document.querySelector(`[data-apply-state="${stageId}"]`);
  button.disabled=true; button.dataset.prevText=button.textContent; button.textContent='جارٍ التطبيق…'; state?.classList.add('processing'); if(state)state.textContent='معالجة وحفظ نسخة العمل…';
  byId('applyStackCard')?.classList.add('processing');
  try{
    const result=await applyStack.apply(stageId,{settings:stageSettings,signature,processor:async({file,metadata,settings})=>{
      const meta=metadata||await manager.engines.media.probe(file).catch(()=>sourceMetadata);
      const rendered=await runProcessingWithSettings(settings,`apply-${stageId}`,{deferShow:true,inputFile:file,inputMetadata:meta});
      if(!rendered)throw new Error('توقف تطبيق المرحلة');
      return rendered;
    }});
    const probed=await manager.engines.media.probe(result.file).catch(()=>result.metadata||applyStack.currentMeta||sourceMetadata);
    applyStack.currentMetadata=probed;
    await loadWorkingPreview();
    if(state){state.classList.remove('processing');state.classList.add('applied');state.textContent=`مطبق ✓ · ${formatBytes(result.blob.size)} · ${formatDuration(result.record.elapsedMs/1000)}`;}
    toast(`تم تطبيق ${result.record.label} على نسخة العمل · لن يعاد في الرندر النهائي`);
    return true;
  }catch(error){if(state){state.classList.remove('processing');state.textContent='تعذر التطبيق';}if(error?.name!=='AbortError')showError(error);return false}
  finally{button.disabled=false;button.textContent=button.dataset.prevText||'تطبيق على الفيديو';byId('applyStackCard')?.classList.remove('processing');renderApplyStack()}
}

const BATCH_STAGE_ORDER=['restore','detail','face','upscale','motion','rife','stabilize','blur'];
const BATCH_STAGE_LABELS={restore:'تنظيف',detail:'تفاصيل',face:'وجوه',upscale:'دقة',motion:'حركة',rife:'RIFE',stabilize:'تثبيت',blur:'Blur'};
function getBatchStageReadiness(stageId){
  if(!sourceFile)return {ready:false,reason:'اختر فيديو أولاً'};
  if(stageId==='upscale'&&byId('resolution')?.value==='original')return {ready:false,reason:'اختر دقة أعلى'};
  if(stageId==='rife'&&byId('targetFps')?.value==='original')return {ready:false,reason:'اختر 60 أو 120 FPS'};
  if(stageId==='blur'&&!labs.collect().blur?.enabled)return {ready:false,reason:'فعّل Blur أولاً'};
  const modelRole=stageId==='upscale'?'upscale':stageId==='rife'?'rife':stageId==='face'?'face':null;
  if(modelRole&&byId(`${modelRole}Enabled`)?.disabled)return {ready:false,reason:`نموذج ${BATCH_STAGE_LABELS[stageId]} غير جاهز`};
  return {ready:true,reason:''};
}
function wireBatchStageControls(){
  const boxes=[...document.querySelectorAll('[data-batch-stage]')],applyBtn=byId('applySelectedStagesBtn'),count=byId('batchSelectedCount'),status=byId('batchStageStatus');
  const sync=()=>{
    let n=0,blocked=[];
    for(const box of boxes){
      const state=getBatchStageReadiness(box.dataset.batchStage);
      box.dataset.ready=state.ready?'1':'0';
      box.closest('label')?.classList.toggle('not-ready',!state.ready);
      box.title=state.reason||'';
      if(box.checked){n++;if(!state.ready)blocked.push(`${BATCH_STAGE_LABELS[box.dataset.batchStage]}: ${state.reason}`)}
    }
    if(count)count.textContent=`${n} محدد`;
    if(applyBtn)applyBtn.disabled=n===0||!!activeJobId||!!applyStack.runningStage||blocked.length>0;
    if(status&&blocked.length)status.textContent=`جهّز المحدد أولاً · ${blocked.join(' · ')}`;
    else if(status&&!applyStack.runningStage)status.textContent='الترتيب: تنظيف ← تفاصيل ← وجوه ← دقة ← حركة/RIFE ← تثبيت ← Blur';
  };
  boxes.forEach(box=>box.addEventListener('change',sync));
  for(const id of ['resolution','targetFps','upscaleEnabled','rifeEnabled','faceEnabled'])byId(id)?.addEventListener('change',sync);
  byId('selectAllBatchStagesBtn')?.addEventListener('click',()=>{boxes.forEach(x=>x.checked=getBatchStageReadiness(x.dataset.batchStage).ready);sync();toast('تم تحديد المراحل الجاهزة فقط')});
  byId('clearBatchStagesBtn')?.addEventListener('click',()=>{boxes.forEach(x=>x.checked=false);sync()});
  applyBtn?.addEventListener('click',async()=>{
    if(activeJobId||applyStack.runningStage)return;
    const selected=BATCH_STAGE_ORDER.filter(id=>boxes.some(x=>x.dataset.batchStage===id&&x.checked));
    if(!selected.length)return;
    const blocked=selected.map(id=>[id,getBatchStageReadiness(id)]).filter(([,state])=>!state.ready);
    if(blocked.length){if(status)status.textContent=blocked.map(([id,state])=>`${BATCH_STAGE_LABELS[id]}: ${state.reason}`).join(' · ');sync();return}
    applyBtn.disabled=true;
    let completed=0;
    for(const id of selected){
      if(status)status.textContent=`تطبيق ${completed+1}/${selected.length}: ${BATCH_STAGE_LABELS[id]}…`;
      const button=document.querySelector(`[data-apply-stage="${id}"]`);
      if(!button){if(status)status.textContent=`تعذر العثور على زر ${BATCH_STAGE_LABELS[id]}`;break}
      const ok=await applyStageFromUI(id,button);
      if(!ok){if(status)status.textContent=`توقف عند ${BATCH_STAGE_LABELS[id]}. لم تُنفذ المراحل التالية.`;break}
      completed++;
      const box=boxes.find(x=>x.dataset.batchStage===id);if(box)box.checked=false;
    }
    if(completed===selected.length){if(status)status.textContent=`اكتمل تطبيق ${completed} مراحل بالتسلسل ✓`;toast(`اكتمل تطبيق ${completed} مراحل مختارة`)}
    sync();
  });
  sync();
}

function wireProjectSettingsIO(){
  byId('exportProjectBtn')?.addEventListener('click',exportProjectSettings);
  byId('importProjectBtn')?.addEventListener('click',()=>byId('projectSettingsInput')?.click());
  byId('projectSettingsInput')?.addEventListener('change',async event=>{const file=event.target.files?.[0];event.target.value='';if(file)await importProjectSettings(file)});
}
function exportProjectSettings(){
  const payload={format:'BARSA-SHOPI-PROJECT',version:1,appVersion:'10.0-manual-control',savedAt:new Date().toISOString(),settings:collectSettings(),modelSelection:{...modelSelection}};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`BARSA_PROJECT_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('تم تصدير إعدادات المشروع');
}
async function importProjectSettings(file){
  try{const payload=JSON.parse(await file.text());if(payload?.format!=='BARSA-SHOPI-PROJECT'||!payload.settings)throw new Error('ملف المشروع غير صالح');
    if(payload.modelSelection){for(const role of ['upscale','rife','face']){const value=payload.modelSelection[role];if(value)modelSelection[role]=value}}
    applyRestoredSettings(payload.settings);
    await refreshModelStates();
    renderOutputReadiness();
    renderCustomSize();
    scheduleInteractiveRefresh({delay:20});
    savePreferences();
    toast('تم استيراد إعدادات المشروع ومزامنة النماذج ✓');
  }catch(error){toast(`تعذر استيراد المشروع: ${error.message}`)}
}

function renderApplyStack(){
  const list=byId('applyStackList'),count=byId('applyStackCount'),undo=byId('undoApplyStageBtn'),clear=byId('clearApplyStackBtn'),hint=byId('applyStackHint');
  if(!list)return;
  const snap=applyStack.snapshot();
  count&&(count.textContent=`${snap.count} مرحلة`);undo&&(undo.disabled=snap.count===0||!!activeJobId);clear&&(clear.disabled=snap.count===0||!!activeJobId);
  list.innerHTML=snap.count?snap.stages.map((stage,i)=>`<span class="apply-stage-chip"><b>${i+1}</b>${stage.label}<small>${formatBytes(stage.bytes)}</small></span>`).join(''):'<span>بعدك ما طبقت أي مرحلة.</span>';
  if(hint)hint.textContent=snap.count?'المراحل الثقيلة المطبقة لن تُعاد. التأثيرات الخفيفة مثل الحدة والألوان تبقى مباشرة للرندر النهائي.':'طبّق فقط المحركات الثقيلة مسبقاً؛ الخفيفة تبقى فورية وتدخل بالرندر النهائي.';
}

async function loadWorkingPreview(forceOriginal=false){
  const file=forceOriginal?sourceFile:applyStack.currentSource;
  if(!file?.size)return;
  const token=++workingPreviewToken;
  const previousURL=sourceURL;
  const nextURL=URL.createObjectURL(file);
  sourceURL=nextURL;
  if(previousURL)URL.revokeObjectURL(previousURL);
  const video=byId('sourceVideo');
  previewEngine?.destroy();previewEngine=null;
  video.pause?.();video.onplay=null;video.onpause=null;video.onseeked=null;
  video.src=nextURL;
  try{
    await once(video,'loadedmetadata','error');
    if(token!==workingPreviewToken||sourceURL!==nextURL)return;
    const engine=new RealtimePreviewEngine(video,byId('outputCanvas'));
    engine.addEventListener('frame',({detail})=>{if(token!==workingPreviewToken)return;byId('previewSeek').value=detail.duration?Math.round(detail.currentTime/detail.duration*1000):0;byId('previewTime').textContent=`${formatClock(detail.currentTime)} / ${formatClock(detail.duration)}`;});
    previewEngine=engine;
    video.onplay=()=>{if(token!==workingPreviewToken)return;byId('previewPlayBtn').textContent='❚❚';previewEngine?.requestRender()};
    video.onpause=()=>{if(token!==workingPreviewToken)return;byId('previewPlayBtn').textContent='▶';previewEngine?.requestRender()};
    video.onseeked=()=>{if(token===workingPreviewToken)previewEngine?.requestRender()};
    await engine.initialize();
    if(token!==workingPreviewToken){engine.destroy();return;}
    byId('previewShell').hidden=false;byId('progressPanel').hidden=true;updatePreview();
  }catch(error){
    if(token!==workingPreviewToken)return;
    previewEngine?.destroy();previewEngine=null;
    if(sourceURL===nextURL){URL.revokeObjectURL(nextURL);sourceURL=null;}
    video.removeAttribute('src');video.load?.();
    toast(`تعذر تحديث المعاينة: ${error.message}`);
  }
}

function collectSettings(){
  const target=byId('targetFps').value,labSettings=labs.collect();
  const faceLab=labSettings.faceLab;
  return{resolution:byId('resolution').value,aspectRatio:byId('aspectRatio').value,fitMode:byId('fitMode').value,customWidth:Number(byId('customWidth').value),customHeight:Number(byId('customHeight').value),backgroundColor:'#000000',targetFps:target==='original'?null:Number(target),quality:byId('quality').value,outputFormat:'mp4',performanceMode:byId('performanceMode').value,protectSceneCuts:byId('protectSceneCuts').checked,temporalMaster:{enabled:byId('temporalMasterEnabled')?.checked!==false,strength:Number(byId('temporalMasterStrength')?.value||0.55)},upscaleModelId:byId('upscaleEnabled').checked?modelSelection.upscale:null,rifeModelId:byId('rifeEnabled').checked?modelSelection.rife:null,faceModelId:byId('faceEnabled').checked&&faceLab.faceDetection?modelSelection.face:null,faceStrength:Number(byId('faceStrength').value),faceLab,audioEnabled:byId('audioEnabled').checked,export:{videoMode:byId('exportVideoMode').value,videoBitrateMbps:Number(byId('exportVideoBitrateMbps').value),audioBitrateK:Number(byId('exportAudioBitrateK').value),acceleration:byId('exportAcceleration').value},audio:{enabled:byId('audioCleanEnabled').checked,highpassHz:70,lowpassHz:16000,noiseReduction:.18,normalizeLufs:-16,truePeakDb:-1.5},temporalReconstruction:labSettings.temporalReconstruction,stabilization:labSettings.stabilization,qualityLab:labSettings.qualityLab,frameIntegrity:{strict:true},blur:labSettings.blur,colorLab:labSettings.colorLab,effects:{brightness:Number(byId('brightness').value),contrast:Number(byId('contrast').value),saturation:Number(byId('saturation').value),vibrance:Number(byId('vibrance').value),gamma:1,temperature:Number(byId('temperature').value),exposure:Number(byId('exposure').value),highlights:Number(byId('highlights').value),shadows:Number(byId('shadows').value),whites:Number(byId('whites').value),blacks:Number(byId('blacks').value),dehaze:Number(byId('dehaze').value),vignette:Number(byId('vignette').value),grain:Number(byId('grain').value),sharpenAmount:Number(byId('sharpen').value),sharpenThreshold:.02,highPassAmount:Number(byId('highPass').value),denoiseAmount:Number(byId('denoise').value),temporalDenoise:Number(byId('temporalDenoise').value),antiFlicker:Number(byId('antiFlicker').value),detailAmount:Number(byId('detail').value),portraitSmooth:Number(byId('portraitSmooth').value)}}
}
function wireAllEngineBoost(){
  const range=byId('allEngineBoostStrength'),number=byId('allEngineBoostStrengthNumber'),out=byId('allEngineBoostStrengthOut'),toggle=byId('allEngineBoostEnabled'),button=byId('applyAllEngineBoostBtn');
  if(!range||!number||!out||!button)return;
  const sync=value=>{const v=Math.max(0,Math.min(1,Number(value)||0));range.value=v;number.value=v.toFixed(2);out.value=v.toFixed(2)};
  range.addEventListener('input',()=>sync(range.value));number.addEventListener('input',()=>sync(number.value));
  button.addEventListener('click',()=>applyAllEngineBoost(Number(range.value),toggle?.checked!==false));
}

function applyAllEngineBoost(strength=.82,enabled=true){
  const status=byId('allEngineBoostStatus');
  if(!enabled){if(status)status.textContent='All Engine Boost مطفأ. الإعدادات اليدوية فقط.';return;}
  const s=Math.max(0,Math.min(1,Number(strength)||0));
  const qualityTargets={
    denoise:.72,temporalDenoise:.58,deblock:.62,deband:.48,artifactRemoval:.68,chromaDenoise:.62,mosquitoNoise:.58,compressionRecovery:.82,detailRecovery:.92,fineDetailRecovery:.78,textureRecovery:.80,microTexture:.72,structureRecovery:.78,detailFusion:.82,edgeRecovery:.68,clarity:.58,localContrast:.48,smartSharpen:.70,dehalo:.34,antiRinging:.40,antiFlicker:.52,temporalDetailStability:.68
  };
  for(const [id,target] of Object.entries(qualityTargets)){
    const check=document.getElementById(`ql-${id}-on`),range=document.getElementById(`ql-${id}`),num=document.querySelector(`[data-sync-range=\"ql-${id}\"]`),out=document.getElementById(`ql-${id}-out`);
    if(check)check.checked=true;
    if(range){const max=Number(range.max)||1;const value=Math.min(max,target*(.55+.65*s));range.value=String(value);if(num)num.value=Number(value).toFixed(2);if(out)out.value=Number(value).toFixed(2);}
  }
  const colorTargets={contrast:1.04+.12*s,vibrance:.05+.16*s,clarity:.05+.18*s,dehaze:.02+.10*s,saturation:1.0+.05*s};
  for(const [id,value] of Object.entries(colorTargets)){
    const range=document.getElementById(`cl-${id}`),num=document.querySelector(`[data-sync-range=\"cl-${id}\"]`),out=document.getElementById(`cl-${id}-out`);
    if(range){range.value=String(value);if(num)num.value=Number(value).toFixed(2);if(out)out.value=Number(value).toFixed(2);}
  }
  const colorOn=document.getElementById('cl-enabled');if(colorOn)colorOn.checked=true;
  // Face V2 is part of the global quality chain too. Boost the local face
  // detail stages without changing the user's manually selected face model.
  const faceTargets={'fl-detail':.52,'fl-cleanup':.32,'fl-microcontrast':.38,'fl-toneprotect':.72,'fl-eyedetail':.34,'fl-hairdetail':.30};
  for(const[id,target]of Object.entries(faceTargets)){const check=document.getElementById(`${id}-on`),range=document.getElementById(id),num=document.querySelector(`[data-sync-range="${id}"]`),out=document.getElementById(`${id}-out`);if(check)check.checked=true;if(range){const value=Math.min(Number(range.max)||1,target*(.72+.38*s));range.value=String(value);if(num)num.value=Number(value).toFixed(2);if(out)out.value=Number(value).toFixed(2);}}
  const trOn=document.getElementById('tr-enabled');if(trOn)trOn.checked=true;
  const trStrength=document.getElementById('tr-strength');if(trStrength)trStrength.value=String(.48+.30*s);
  const temporalOn=byId('temporalMasterEnabled');if(temporalOn)temporalOn.checked=true;
  const temporal=byId('temporalMasterStrength'),temporalNum=byId('temporalMasterStrengthNumber'),temporalOut=byId('temporalMasterStrengthOut');
  const tv=.48+.32*s;if(temporal){temporal.value=String(tv);if(temporalNum)temporalNum.value=tv.toFixed(2);if(temporalOut)temporalOut.value=tv.toFixed(2);}
  labs._updateVisibility?.();updatePreview();updatePreflightEstimate();
  if(status)status.textContent=`تم تطبيق تقوية شاملة ${Math.round(s*100)}% على Restore + Detail + Sharpness + Stability + Color. النماذج تبقى باختيارك.`;
  toast('تم تطبيق All Engine Boost على كل مراحل التحسين');
}

async function validateEnabledModels(s,meta=sourceMetadata){
  const outputFps=s.blur?.enabled?(s.blur.outputFps==='source'?meta.fps:s.blur.outputFps==='custom'?Number(s.blur.customOutputFps):Number(s.blur.outputFps)):(s.targetFps||meta.fps);
  const needsRife=outputFps>meta.fps+.01||(s.blur?.enabled&&s.blur.interpolation);
  if(needsRife&&!s.rifeModelId){
    throw new Error('هذا الرندر يحتاج RIFE. فعّل RIFE واختر النموذج يدوياً؛ BARSA لا يغيّر اختيار النموذج تلقائياً.');
  }
  const plans=[
    ['upscale',s.upscaleModelId,manager.engines.upscale,MODEL_REGISTRY],
    ['rife',s.rifeModelId,manager.engines.rife,RIFE_MODEL_REGISTRY],
    ['face',s.faceModelId,manager.engines.face,FACE_MODEL_REGISTRY],
  ];
  for(const[role,id,engine,registry]of plans){
    if(!id)continue;
    const result=await modelProvisioner.ensure({role,modelId:id,engine,registry,allowFallback:false});
    if(result.modelId!==id)throw new Error(`تم منع تبديل النموذج تلقائياً: المطلوب ${id} والجاهز ${result.modelId}. ثبّت النموذج المختار أو اختر غيره يدوياً.`);
  }
  if(s.faceModelId){
    const detector=await manager.engines.faceDetector.isAvailable('yunet-2026may').catch(()=>({available:false}));
    if(!detector.available){await manager.engines.faceDetector.resolveWorkingModel({install:true}).catch(()=>{});}
  }
  await refreshModelStates();
}


async function requestPersistentStorage(){
  if(!navigator.storage?.persist)return false;
  try{return await navigator.storage.persist()}catch{return false}
}

let autoModelRetryTimer=null;
function installAutoModelRetryHooks(){
  const retry=()=>{clearTimeout(autoModelRetryTimer);autoModelRetryTimer=setTimeout(()=>{if(!activeJobId&&navigator.onLine!==false)scheduleAutomaticModelProvisioning()},1200)};
  window.addEventListener('online',retry,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')retry()});
  const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  connection?.addEventListener?.('change',retry);
}

function scheduleAutomaticModelProvisioning(){
  if(localStorage.getItem('barsa.autoModels')==='off')return;
  // Background model downloads must never compete with a selected video or an
  // active render for RAM/CPU/storage bandwidth. Once the user starts working,
  // model installation is explicit from Model Center.
  const idleForModels=()=>!activeJobId&&!sourceFile;
  const runCore=()=>{if(!idleForModels())return;runAutoModelVault({includeFace:false,userInitiated:false}).catch(()=>{})};
  const runExtended=()=>{
    const enabled=localStorage.getItem('barsa.autoFullModels')!=='off';
    if(!enabled||!idleForModels())return;
    runAutoModelVault({includeFace:true,includeAllCatalog:true,userInitiated:false,forceExtended:false}).catch(()=>{});
  };
  if('requestIdleCallback' in window){
    requestIdleCallback(runCore,{timeout:2200});
    requestIdleCallback(runExtended,{timeout:12000});
  }else{
    setTimeout(runCore,700);
    setTimeout(runExtended,7000);
  }
}

async function runAutoModelVault({includeFace=false,includeAllCatalog=false,userInitiated=false,forceExtended=false}={}){
  if(activeJobId){if(userInitiated)toast('إدارة النماذج متوقفة أثناء الرندر لحماية الذاكرة والاستقرار');return null;}
  const button=byId(includeFace?'fullModelsBtn':'autoModelsBtn');
  const status=byId('autoModelStatus')||byId('modelStatus');
  if(button)button.disabled=true;
  try{
    const result=await modelVault.ensureCore({includeFace,includeAllCatalog,forceExtended});
    await refreshModelStates();
    if(status)status.textContent=result.ok?`الحزمة جاهزة · ${result.ready}/${result.total} نماذج اجتازت الفحص والتشغيل الفعلي`:`الحزمة جاهزة جزئياً · ${result.ready}/${result.total} · أي نموذج غير مختبر يبقى غير قابل للتفعيل`;
    if(userInitiated)toast(result.ok?'تم تجهيز حزمة AI بنجاح':'اكتمل تجهيز النماذج مع وجود مصدر تعذر الوصول إليه');
    return result;
  }finally{if(button)button.disabled=false}
}

function renderAutoModelProgress(event={}){
  const status=byId('autoModelStatus');
  const label=event.label||event.modelId||'AI Model';
  quickModels?.updateProgress?.(event.role,event);
  updateSuiteModelProgress(event.modelId,event);
  const pct=Number.isFinite(event.pct)?` · ${Math.round(event.pct*100)}%`:'';
  if(!status)return;
  if(event.stage==='model-ready')status.textContent=`✓ ${label} جاهز ومختبر فعلياً`;
  else if(event.stage==='model-deferred')status.textContent=`${label} مؤجل تلقائياً · ${translateModelDeferReason(event.reason)}`;
  else if(event.stage==='model-error')status.textContent=`تعذر ${label}: ${event.error?.message||'مصدر غير متاح'}`;
  else status.textContent=`${label} · ${event.stage||'تجهيز'}${pct}`;
}

function modelCatalogConfig(modelId){
  return MODEL_REGISTRY[modelId]||RIFE_MODEL_REGISTRY[modelId]||FACE_MODEL_REGISTRY[modelId]||FACE_DETECTOR_REGISTRY[modelId]||null;
}
const modelTransferStats=new Map();
function modelTransferDetails(modelId,received,total,stage){if(!received||!['download','downloading'].includes(stage)){if(['model-ready','model-error','complete'].includes(stage))modelTransferStats.delete(modelId);return ''}const now=performance.now(),previous=modelTransferStats.get(modelId);let rate=0;if(previous&&received>=previous.received&&now>previous.time)rate=(received-previous.received)/((now-previous.time)/1000);modelTransferStats.set(modelId,{received,time:now,rate:rate||previous?.rate||0});const stable=rate||previous?.rate||0;if(stable<1024)return '';const speed=`${formatBytes(stable)}/s`;const eta=total>received?Math.ceil((total-received)/stable):0;return ` · ${speed}${eta>0?` · متبقي ${formatEta(eta)}`:''}`}
function formatEta(seconds){const s=Math.max(0,Math.round(seconds));if(s<60)return `${s}ث`;const m=Math.floor(s/60),r=s%60;return `${m}د ${r}ث`}
function updateSuiteModelProgress(modelId,event={}){
  if(!modelId)return;
  const card=document.querySelector(`[data-suite-model="${modelId}"]`);
  if(!card)return;
  const out=card.querySelector('b'),fill=card.querySelector('.suite-progress>i'),config=modelCatalogConfig(modelId)||{};
  const received=Math.max(0,Number(event.received||0)),total=Math.max(0,Number(event.total||config.expectedSizeBytes||0));
  const pctRaw=Number(event.pct),pct=Number.isFinite(pctRaw)?Math.max(0,Math.min(100,Math.round(pctRaw*100))):(event.stage==='model-ready'?100:0);
  if(fill)fill.style.width=`${pct}%`;
  card.style.setProperty('--model-pct',`${pct}%`);
  card.classList.toggle('downloading',pct>0&&pct<100&&!['model-error','model-deferred'].includes(event.stage));
  if(event.stage==='model-ready'){card.classList.add('ready');card.classList.remove('warning','downloading');if(out)out.textContent=`100% · شغال ✓ · ${formatCatalogSize(config)}`;return}
  if(event.stage==='model-error'){card.classList.add('warning');card.classList.remove('ready','downloading');if(out)out.textContent=`${pct}% · خطأ`;return}
  if(event.stage==='model-deferred'){if(out)out.textContent=`${pct}% · مؤجل`;return}
  if(out){const amount=received?(total?`${formatBytes(received)}/${formatBytes(total)}`:formatBytes(received)):(total?formatBytes(total):'');const transfer=modelTransferDetails(modelId,received,total,event.stage);out.textContent=`${pct}%${amount?` · ${amount}`:''}${transfer} · ${translateModelStage(event.stage)}`;}
}
function translateModelStage(stage){return ({source:'اتصال',download:'تحميل',downloading:'تحميل',installing:'تثبيت',verify:'تحقق',testing:'اختبار فعلي',trying:'فحص',importing:'استيراد','model-start':'بدء'})[stage]||'تجهيز'}

function translateModelDeferReason(reason){return reason==='low-storage'?'المساحة غير كافية حالياً':reason==='data-saver'?'توفير البيانات مفعّل':reason==='slow-network'?'الاتصال بطيء حالياً':'سيُحاول لاحقاً'}

async function importModel(role,file){if(!file)return;const status=byId('modelStatus'),buttons=[...document.querySelectorAll(`[data-import="${role}"]`)],id=modelSelection[role];buttons.forEach(x=>{x.disabled=true});try{const progress=(event={})=>{const pct=Number(event.pct||0);status.textContent=`جارٍ استيراد ${file.name} · ${Math.round(pct*100)}%`;quickModels?.updateProgress?.(role,event);updateSuiteModelProgress(id,{stage:event.stage||'importing',...event})};if(role==='upscale'){await manager.engines.upscale.ensureModel(id,progress,file);status.textContent='جارٍ اختبار نموذج رفع الدقة…';updateSuiteModelProgress(id,{stage:'testing',pct:1});try{await manager.engines.upscale.runSelfTest(id)}catch(error){await manager.engines.models.markTestFailed(id,error).catch(()=>{});throw error}}else if(role==='rife'){await manager.engines.rife.ensureModel(id,progress,file);status.textContent='جارٍ اختبار نموذج RIFE…';updateSuiteModelProgress(id,{stage:'testing',pct:1});try{await manager.engines.rife.runSelfTest(id)}catch(error){await manager.engines.models.markTestFailed(id,error).catch(()=>{});throw error}}else await manager.engines.face.importModel(id,file,progress);status.textContent=`تم التحقق من ${file.name} وحفظه محليًا`;updateSuiteModelProgress(id,{stage:'model-ready',pct:1,received:file.size,total:file.size});buttons.forEach(x=>{x.classList.add('ready');x.textContent='جاهز'});byId(`${role}Enabled`).disabled=false;byId(`${role}Enabled`).checked=true}catch(error){status.textContent=`فشل النموذج: ${error.message}`;updateSuiteModelProgress(id,{stage:'model-error'});toast('لم يجتز ملف ONNX اختبار التوافق')}finally{buttons.forEach(x=>{x.disabled=false});byId(`${role}ModelInput`).value='';await refreshModelStates()}}
async function importFaceDetector(file){if(!file)return;const button=byId('faceDetectorImportBtn'),state=byId('faceDetectorModelState'),id='yunet-2026may';button.disabled=true;try{await manager.engines.faceDetector.importModel(id,file,(event={})=>{const pct=Number(event.pct||0);state.textContent=`حفظ وفحص YuNet · ${Math.round(pct*100)}%`;updateSuiteModelProgress(id,{stage:event.stage||'importing',...event})});state.textContent='100% · YuNet شغال ✓ · يعمل تلقائياً مع ترميم الوجه';updateSuiteModelProgress(id,{stage:'model-ready',pct:1,received:file.size,total:file.size});toast('تم تفعيل كشف الوجه ONNX')}catch(error){state.textContent=`فشل YuNet: ${error.message}`;updateSuiteModelProgress(id,{stage:'model-error'});toast('ملف كاشف الوجه غير متوافق')}finally{button.disabled=false;byId('faceDetectorModelInput').value='';await refreshFaceDetectorState();await renderModelSuiteStatus()}}
async function installFaceDetector(){const button=byId('faceDetectorInstallBtn'),state=byId('faceDetectorModelState');button.disabled=true;try{const working=await manager.engines.faceDetector.resolveWorkingModel({install:true,onProgress:(event={})=>{const id=event.modelId||'yunet-2026may',stage=event.stage,pct=Number(event.pct||0);state.textContent=`${id==='yunet-2026may'?'YuNet 2026':'YuNet 2023 fallback'} · ${stage==='verify'?'التحقق':'تحميل'} · ${Math.round(pct*100)}%`;updateSuiteModelProgress(id,event)}});if(!working)throw new Error('لم يجتز أي إصدار YuNet الفحص والتشغيل الفعلي');const status=await manager.engines.models.getStatus(working);state.textContent=`100% · ${working==='yunet-2026may'?'YuNet 2026':'YuNet 2023 fallback'} شغال ✓ · ${formatBytes(status.sizeBytes||0)}`;updateSuiteModelProgress(working,{stage:'model-ready',pct:1,received:status.sizeBytes,total:status.sizeBytes});toast('تم تثبيت YuNet وفحص inference فعلياً')}catch(error){state.textContent=`تعذر التثبيت: ${error.message} · استخدم الاستيراد اليدوي`;updateSuiteModelProgress('yunet-2026may',{stage:'model-error'});toast('تعذر تنزيل YuNet؛ الاستيراد اليدوي متاح')}finally{button.disabled=false;await refreshFaceDetectorState();await renderModelSuiteStatus()}}
async function installCatalogModel(role,{silent=false}={}){
  const button=document.querySelector(`[data-install="${role}"]`),status=byId('modelStatus'),id=modelSelection[role],registry=role==='upscale'?MODEL_REGISTRY:role==='rife'?RIFE_MODEL_REGISTRY:FACE_MODEL_REGISTRY,config=registry[id],engine=manager.engines[role];
  if(!config?.bundledURL&&!config?.remoteURL&&!config?.downloadCandidates?.length){if(!silent)toast('هذا النموذج يحتاج استيراد ملف ONNX يدوياً');return false}
  if(button)button.disabled=true;
  try{
    status.textContent=`بدء تثبيت ${config.label||id} تلقائياً من مصدر موثوق…`;
    await engine.installCatalogModel(id,(progress={})=>{
      const {stage,pct=0,received=0,total=0,candidate=1,candidateCount=1}=progress;
      quickModels?.updateProgress?.(role,progress);
      updateSuiteModelProgress(id,progress);
      const amount=received?(total?`${formatBytes(received)} / ${formatBytes(total)}`:formatBytes(received)):'';
      const source=candidateCount>1?` · مصدر ${candidate}/${candidateCount}`:'';
      status.textContent=stage==='source'?`الاتصال بمصدر النموذج${source}`:stage==='verify'?`التحقق من البصمة وحفظ النموذج · ${Math.round(pct*100)}%${source}`:`تنزيل النموذج · ${Math.round(pct*100)}%${amount?` · ${amount}`:''}${source}`;
    });
    status.textContent=`${config.label||id}: تم التنزيل والتحقق وتشغيل inference بنجاح`;
    quickModels?.updateProgress?.(role,{stage:'model-ready',pct:1});
    updateSuiteModelProgress(id,{stage:'model-ready',pct:1,total:config.expectedSizeBytes||0,received:config.expectedSizeBytes||0});
    byId(`${role}Enabled`).disabled=false;
    byId(`${role}Enabled`).checked=true;
    if(!silent)toast('النموذج جاهز ويعمل محلياً');
    return true;
  }catch(error){
    status.textContent=`تعذر التثبيت أو الاختبار: ${error.message} — الاستيراد اليدوي ما زال متاحاً`;
    quickModels?.updateProgress?.(role,{stage:'model-error'});
    updateSuiteModelProgress(id,{stage:'model-error'});
    if(!silent)toast('فشل التثبيت التلقائي؛ جرّب الاستيراد اليدوي');
    return false;
  }finally{if(button)button.disabled=false;await refreshModelStates()}
}

function renderAiRuntimeStatus(){
  const out=byId('aiRuntimeStatus');if(!out)return;
  const nativeReady=Boolean(manager.engines.upscale?.nativeAi?.available||manager.engines.rife?.nativeAi?.available||manager.engines.face?.nativeAi?.available);
  const routes=[{label:'Native',ready:nativeReady},{label:'WebGPU',ready:Boolean(manager.capabilities?.webGPU)},{label:'WASM',ready:true}];
  const ready=routes.filter(route=>route.ready);
  const chain=ready.map(route=>`${route.label} ✓`).join(' → ');
  out.textContent=`${ready.length}/3 مسارات AI جاهزة · ${chain} · fallback تلقائي`;
}

async function refreshModelStates(){for(const role of ['upscale','rife','face']){const id=modelSelection[role];byId(`${role}ModelProfile`).value=id;const registry=role==='upscale'?MODEL_REGISTRY:role==='rife'?RIFE_MODEL_REGISTRY:FACE_MODEL_REGISTRY,config=registry[id]||{},selectedStatus=await manager.engines.models.getDetailedStatus(id,config).catch(()=>null),available=Boolean(selectedStatus?.ready);byId(`${role}Enabled`).disabled=!available;document.querySelectorAll(`[data-import="${role}"]`).forEach(b=>{b.classList.toggle('ready',available);b.textContent=available?'استبدال الملف':'استيراد ONNX'});const install=document.querySelector(`[data-install="${role}"]`),installable=Boolean(config?.bundledURL||config?.remoteURL||config?.downloadCandidates?.length);if(install){install.hidden=!installable;install.classList.toggle('ready',available);install.textContent=available?'مثبت ومختبر':`تثبيت تلقائي · ${formatCatalogSize(config)}`};const state=byId(`${role}ModelState`);if(state){if(available)state.textContent=`100% · شغال ✓ · SHA ✓ · ${formatBytes(selectedStatus?.actualBytes||config?.expectedSizeBytes||0)}${selectedStatus?.executionProvider?` · ${String(selectedStatus.executionProvider).replace('android-native:','Native ')}`:''}`;else if(selectedStatus?.state==='downloading'){const t=selectedStatus.transfer||{};state.textContent=`${selectedStatus.progressPercent}% · يحمل ${formatBytes(t.received||0)}/${formatBytes(t.total||selectedStatus.expectedBytes||0)}`;}else if(selectedStatus?.state==='error')state.textContent=`${selectedStatus.progressPercent}% · خطأ · ${String(selectedStatus.lastError||'اضغط فحص / إصلاح').slice(0,90)}`;else state.textContent=installable?`0% · 0B/${formatCatalogSize(config)} · جاهز للتحميل`:'0% · غير مثبت · استيراد ONNX يدوي';}}await refreshFaceDetectorState();await renderModelSuiteStatus();const packs=await manager.engines.nihui.listPacks().catch(()=>[]);if(packs.length)byId('nihuiModelState').textContent=`${packs.length} حزمة NCNN محفوظة محلياً · تحتاج ONNX للتنفيذ الحالي`;quickModels.refreshState?.()}
async function renderModelSuiteStatus(){const ids=['realesr-general-x4v3-turbo','onnx-model-zoo-sr-x3','real-esrgan-x4plus','rife-tensorstack','rife47-emmajohnson311','yunet-2026may','yunet-2023mar','gfpgan-1.4','codeformer'];let readyCount=0,downloadingCount=0;for(const id of ids){const card=document.querySelector(`[data-suite-model="${id}"]`);if(!card)continue;const out=card.querySelector('b'),fill=card.querySelector('.suite-progress>i'),config=modelCatalogConfig(id)||{};try{const status=await manager.engines.models.getDetailedStatus(id,config);const expected=Number(status.expectedBytes||config.expectedSizeBytes||0),actual=Number(status.actualBytes||status.sizeBytes||0),pct=Number(status.progressPercent||0),transfer=status.transfer||null;if(fill)fill.style.width=`${pct}%`;card.style.setProperty('--model-pct',`${pct}%`);card.dataset.modelState=status.state||'unknown';if(status.ready){readyCount++;out.textContent=`100% · شغال ✓ · SHA ✓ · ${formatBytes(actual||expected)}${status.executionProvider?` · ${String(status.executionProvider).replace('android-native:','Native ')}`:''}`;card.classList.add('ready');card.classList.remove('warning','downloading')}else if(status.state==='downloading'){downloadingCount++;const received=Number(transfer?.received||0),total=Number(transfer?.total||expected||0);out.textContent=`${pct}% · ${formatBytes(received)}/${formatBytes(total)} · ${translateModelStage(transfer?.stage)}`;card.classList.add('downloading');card.classList.remove('ready','warning')}else if(status.state==='error'){out.textContent=`${pct}% · خطأ · ${String(status.lastError||'يحتاج إصلاح').slice(0,80)}`;card.classList.remove('ready','downloading');card.classList.add('warning')}else if(status.installed){out.textContent=`${pct}% · ${status.verified?'SHA ✓ · بانتظار inference':'بحاجة تحقق SHA'} · ${formatBytes(actual||expected)}`;card.classList.remove('ready','downloading');card.classList.add('warning')}else{out.textContent=`0% · 0B/${formatBytes(expected)} · غير مثبت`;card.classList.remove('ready','warning','downloading')}}catch{out.textContent='0% · غير معروف';card.classList.add('warning')}}const summary=byId('modelSuiteSummary');if(summary)summary.textContent=`${readyCount}/${ids.length} شغال · ${downloadingCount} يحمل`}

async function refreshFaceDetectorState(){const preferred=await manager.engines.faceDetector.isAvailable('yunet-2026may').catch(()=>({available:false})),fallback=preferred.available?{available:false}:await manager.engines.faceDetector.isAvailable('yunet-2023mar').catch(()=>({available:false})),working=preferred.available?'yunet-2026may':fallback.available?'yunet-2023mar':null,state=byId('faceDetectorModelState'),install=byId('faceDetectorInstallBtn'),importButton=byId('faceDetectorImportBtn');const status=working?await manager.engines.models.getStatus(working).catch(()=>null):null;state.textContent=working?`100% · ${working==='yunet-2026may'?'YuNet 2026':'YuNet 2023 fallback'} شغال ✓ · ${formatBytes(status?.sizeBytes||FACE_DETECTOR_REGISTRY[working]?.expectedSizeBytes||0)}`:`0% · YuNet غير مثبت · تنزيل 2026 مع fallback 2023 أو استيراد ONNX`;install.classList.toggle('ready',Boolean(working));install.textContent=working?'مثبت ومختبر':'تثبيت موثوق · 230KB';importButton.textContent=working?'استبدال ONNX':'استيراد ONNX'}

function selectedModelContext(){const role=byId('modelHealthRole').value,id=modelSelection[role],engine=manager.engines[role],registry=role==='upscale'?MODEL_REGISTRY:role==='rife'?RIFE_MODEL_REGISTRY:FACE_MODEL_REGISTRY;return{role,id,engine,config:registry[id]||{}}}
async function refreshModelHealth(){const{role,id,config}=selectedModelContext(),status=await manager.engines.models.getStatus(id),details={id,version:status.version||config.version||'not declared',purpose:status.purpose||status.role||role,size:status.sizeBytes?formatBytes(status.sizeBytes):'not installed',source:status.sourceURL||config.sourcePage||config.bundledURL||'manual file',installed:status.installed||false,verified:status.verified||false,testPassed:status.testPassed||false,readiness:status.readinessLabel||'NOT READY',executionProvider:status.executionProvider||'not tested',lastTest:status.testedAt?new Date(status.testedAt).toISOString():'never',sha256:status.sha256||config.sha256||'runtime verification required',signature:status.signature||status.testDetails||null,lastError:status.lastTestError||status.lastVerificationError||null};byId('modelHealthDetails').textContent=JSON.stringify(details,null,2)}
async function auditAllInstalledModels(){const button=byId('modelAuditAllBtn'),statusOut=byId('autoModelStatus');const catalog=[...Object.keys(MODEL_REGISTRY).map(id=>({role:'upscale',id,engine:manager.engines.upscale,config:MODEL_REGISTRY[id]})),...Object.keys(RIFE_MODEL_REGISTRY).map(id=>({role:'rife',id,engine:manager.engines.rife,config:RIFE_MODEL_REGISTRY[id]})),...Object.keys(FACE_MODEL_REGISTRY).map(id=>({role:'face',id,engine:manager.engines.face,config:FACE_MODEL_REGISTRY[id]})),...Object.keys(FACE_DETECTOR_REGISTRY).map(id=>({role:'faceDetector',id,engine:manager.engines.faceDetector,config:FACE_DETECTOR_REGISTRY[id]}))];button.disabled=true;try{const installed=[];for(const item of catalog){const existing=await manager.engines.models.getStatus(item.id).catch(()=>null);if(existing?.installed)installed.push({...item,existing})}let passed=0,failed=0;for(let index=0;index<installed.length;index++){const item=installed[index];if(statusOut)statusOut.textContent=`فحص ${item.config.label||item.id} · ${index+1}/${installed.length}`;try{await manager.engines.models.verifyStoredModel(item.id,item.config,(event={})=>updateSuiteModelProgress(item.id,{stage:'verify',...event}));updateSuiteModelProgress(item.id,{stage:'testing',pct:1,received:item.existing.sizeBytes,total:item.existing.sizeBytes});await item.engine.runSelfTest(item.id);passed++;const fresh=await manager.engines.models.getStatus(item.id);updateSuiteModelProgress(item.id,{stage:'model-ready',pct:1,received:fresh.sizeBytes,total:fresh.sizeBytes})}catch(error){failed++;await manager.engines.models.markTestFailed(item.id,error).catch(()=>{});updateSuiteModelProgress(item.id,{stage:'model-error'});console.warn(`Model audit failed for ${item.id}:`,error)}}if(statusOut)statusOut.textContent=installed.length?`${passed}/${installed.length} نموذج مثبت شغال فعلياً${failed?` · ${failed} يحتاج إصلاح`:''}`:'لا توجد نماذج مثبتة لفحصها';toast(installed.length?`فحص النماذج: ${passed}/${installed.length} شغال`:'لا توجد نماذج مثبتة')}finally{button.disabled=false;await refreshModelStates();await refreshModelHealth()}}
async function retestSelectedModel(){const{role,id,engine,config}=selectedModelContext();setModelActionBusy(true);try{await manager.engines.models.verifyStoredModel(id,config);await engine.runSelfTest(id);toast('Model passed hash, load, signature and real inference checks')}catch(error){await manager.engines.models.markTestFailed(id,error).catch(()=>{});toast(`Model retest failed: ${error.message}`)}finally{setModelActionBusy(false);await refreshModelStates();await refreshModelHealth()}}
async function repairSelectedModel(){const{role,id,engine,config}=selectedModelContext();setModelActionBusy(true);try{try{await manager.engines.models.verifyStoredModel(id,config);await engine.runSelfTest(id);toast('Model repaired by re-verification');return}catch{}
if(typeof engine.resolveWorkingModel==='function'){const working=await engine.resolveWorkingModel();if(working){modelSelection[role]=working;byId(`${role}ModelProfile`).value=working;toast(`Repair selected verified fallback: ${working}`);return}}
if(typeof engine.installCatalogModel==='function'&&(config?.remoteURL||config?.downloadCandidates?.length||config?.bundledURL)){await engine.installCatalogModel(id);toast(`Model atomically re-downloaded and runtime-verified: ${id}`);return}
byId(`${role}ModelInput`).click();toast('Automatic repair source unavailable; choose a compatible ONNX file')}catch(error){await manager.engines.models.markTestFailed(id,error).catch(()=>{});toast(`Repair failed: ${error.message}`)}finally{setModelActionBusy(false);await refreshModelStates();await refreshModelHealth()}}
async function deleteSelectedModel(){const{role,id}=selectedModelContext();if(!confirm(`Delete model ${id} from this device?`))return;setModelActionBusy(true);try{await manager.engines.models.deleteModel(id);byId(`${role}Enabled`).checked=false;toast('Model deleted from local storage')}finally{setModelActionBusy(false);await refreshModelStates();await refreshModelHealth()}}
function openSelectedModelSource(){const{config,id}=selectedModelContext();manager.engines.models.getMetadata(id).then(metadata=>{const url=metadata?.sourcePage||metadata?.sourceURL||config.sourcePage||config.remoteURL;if(url)window.open(url,'_blank','noopener');else toast('This custom model has no recorded source page')})}
async function importSelectedModelURL(){const{role,id,engine,config}=selectedModelContext(),url=byId('modelURL').value.trim();if(!url){toast('Enter an HTTPS ONNX URL');return}setModelActionBusy(true);let imported=false;try{await manager.engines.models.importFromUserURL(id,url,{...config,sha256:null,source:'manual-url',role});imported=true;try{await engine.runSelfTest(id)}catch(error){await manager.engines.models.markTestFailed(id,error).catch(()=>{});throw error}byId(`${role}Enabled`).checked=true;toast('Custom URL model is runtime verified')}catch(error){if(imported)await manager.engines.models.markTestFailed(id,error).catch(()=>{});toast(error.message)}finally{setModelActionBusy(false);await refreshModelStates();await refreshModelHealth()}}
function setModelActionBusy(value){for(const id of ['modelAuditAllBtn','modelRetestBtn','modelRepairBtn','modelReplaceBtn','modelDeleteBtn','modelSourceBtn','modelURLBtn']){const el=byId(id);if(el)el.disabled=value}}

function renderJob(job){const p=Math.round((job.progress||0)*100);byId('progressPercent').textContent=`${p}%`;byId('progressBar').style.width=`${p}%`;byId('progressStage').textContent=stages[job.stage]||job.stage||'جارٍ المعالجة';byId('progressDetail').textContent=job.detail||'';byId('pauseBtn').textContent=job.state==='paused'?'متابعة':'إيقاف مؤقت';const live=estimator.live(job.progress||0);if(live){byId('etaValue').textContent=formatDuration(live.remaining);byId('renderSpeed').textContent=`${(live.speed*100).toFixed(2)}% / ثانية`}if(job.detail?.includes('/'))byId('renderFrames').textContent=job.detail}
function togglePause(){if(!activeJobId)return;const job=manager.publicJob(activeJobId);if(job.state==='paused')manager.resumeJob(activeJobId);else manager.pauseJob(activeJobId)}
function showResult(r){if(resultURL&&resultURL!==r.url)URL.revokeObjectURL(resultURL);if(lastResultRelease&&lastResultRelease!==r.release)lastResultRelease().catch(error=>console.error('[BARSA][output-lease][result-release-failed]',error));resultURL=r.url;lastResultBlob=r.blob;lastResultFileName=r.fileName;lastResultSessionId=r.metadata?.sessionId||null;lastResultSourceDateMs=Number(r.metadata?.sourceLastModified||0);lastResultMetadata=r.metadata||null;lastResultRelease=r.release||null;byId('resultVideo').src=resultURL;byId('downloadBtn').href=resultURL;byId('downloadBtn').download=r.fileName;const nativeSave=byId('nativeSaveBtn');if(nativeSave)nativeSave.hidden=!androidBridge.available;const m=r.metadata,elapsed=estimator.live(1)?.elapsed,guard=m.sceneCutsProtected?` · حُميت ${m.sceneCutsProtected} انتقالات`:'',decode=m.directDemux?' · Direct Decode':'',verified=m.trackValidation?.valid?` · H.264${m.trackValidation.hasAudio?'/AAC':''} مُتحقق`:m.exportValidation?.playable?' · MP4 مُتحقق':'',audio=m.audioPath?` · ${m.audioPath}`:'',quality=m.qualityAudit?.score!=null?` · سلامة ${m.qualityAudit.score}/100`:'',aiProvider=m.aiUpscaleProvider?` · Upscale ${m.aiUpscaleProvider}`:'',faceProvider=m.faceProvider?` · Face ${m.faceProvider}`:'',frames=m.frameIntegrity?.valid?` · Frame Perfect ${m.frameIntegrity.encodedFrames} ✓`:'';byId('resultInfo').textContent=`${m.width}×${m.height} · ${m.targetFps.toFixed(2)} FPS · ${formatBytes(r.blob.size)} · ${m.codec} · ${elapsed?formatDuration(elapsed):'—'}${decode}${audio}${aiProvider}${faceProvider}${quality}${frames}${guard}${verified}`;byId('progressPanel').hidden=true;byId('previewShell').hidden=true;byId('resultPanel').hidden=false}
function downloadRenderProof(){if(!lastResultMetadata)return toast('لا يوجد تقرير رندر بعد');const proof={product:'BARSA SHOPI',version:APP_VERSION,generatedAt:new Date().toISOString(),outputFile:lastResultFileName,sourceName:sourceFile?.name||null,sourceSize:sourceFile?.size||null,metadata:lastResultMetadata};const blob=new Blob([JSON.stringify(proof,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`BARSA-render-proof-${lastResultSessionId?.slice(0,8)||'result'}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('تم إنشاء تقرير سلامة الرندر')}
function renderTelemetry(d){byId('metricFps').textContent=(d.fps||0).toFixed(1);byId('metricGpu').textContent=`${(d.gpuAllocatedMB||0).toFixed(0)} MB`;byId('metricRam').textContent=d.jsHeapUsedMB==null?'—':`${d.jsHeapUsedMB.toFixed(0)} MB`;byId('metricTile').textContent=String(d.tileSize||128)}
function renderOutputReadiness(){if(!manager.capabilities)return;const format=byId('outputFormat').value,audioOn=byId('audioEnabled').checked,codecs=manager.capabilities.webCodecsCodecs||[],h264=codecs.find(item=>item.name==='H.264'&&item.encode),vp9=codecs.find(item=>item.name==='VP9'&&item.encode),nativeAAC=manager.capabilities.nativeAAC,badge=byId('codecBadge'),detail=byId('codecDetail');if(format==='mp4'){if(h264&&(!audioOn||nativeAAC)){badge.textContent=audioOn?'MP4 سريع · H.264 + AAC Native':'MP4 سريع · H.264 Native';detail.textContent=audioOn?'ترميز فيديو وصوت متدفق عبر WebCodecs + Mediabunny Fast Start':'WebCodecs + Mediabunny Fast Start، بدون تحميل FFmpeg'}else{badge.textContent='MP4 متوافق · H.264/AAC عبر FFmpeg';detail.textContent=audioOn?'المتصفح لا يوفّر AAC Native؛ سيُستخدم FFmpeg WASM المحلي تلقائياً':'سيُحوّل الترميز إلى H.264/YUV420P لضمان التوافق'}}else{badge.textContent=vp9?'WebM جاهز · VP9 مباشر':'WebM جاهز · FFmpeg';detail.textContent=vp9&&!audioOn?'مسار WebCodecs سريع بدون تحميل FFmpeg':'Opus وتنظيف الصوت يستخدمان FFmpeg المحلي عند الحاجة'}}

function renderHardwareReadiness(){const c=manager.capabilities;if(!c)return;const card=byId('hardwareReadiness'),profile=c.deviceProfile,matrix=c.h264Matrix||[],supported=matrix.filter(item=>item.supported),fourK60=matrix.find(item=>item.id==='4k60'),nativeAi=androidBridge.getNativeAiInfo();byId('hardwareProfile').textContent=profile?.id==='poco-f6'?'POCO F6 Turbo جاهز':profile?.label||'ملف جهاز تلقائي';const nativeLabel=nativeAi?.binaryTileApi?` · Native ONNX Tiles${nativeAi?.nativeFaceApi?' + Face':''} جاهز`:androidBridge.available?' · Native AI محدود':'';byId('hardwareDetail').textContent=`${c.webGPU?'WebGPU جاهز':'WebGPU غير متاح'} · H.264 ${supported.length}/${matrix.length}${fourK60?.supported?' · 4K60 مقبول':''} · ${c.nativeAAC?'AAC مباشر':'AAC احتياطي'}${nativeLabel}`;card.classList.toggle('warning',!c.webGPU||supported.length===0)}

let lastDoctorReport=null;
async function runBarsaDoctor(mode='quick'){
  const buttons=['doctorQuickBtn','doctorFullBtn','doctorStressBtn','doctorRepairBtn'].map(byId).filter(Boolean),result=byId('doctorResult'),summary=byId('doctorSummary'),verdict=byId('doctorVerdict');
  buttons.forEach(b=>b.disabled=true);result.textContent='BARSA Doctor يبدأ التشخيص…';summary.textContent=`الوضع: ${mode==='quick'?'فحص سريع':mode==='full'?'تشخيص كامل':'Stress Doctor'}`;verdict.textContent='يفحص…';verdict.className='';
  try{
    const report=await manager.doctor.run(mode,{onProgress:(stage)=>{result.textContent=`جارٍ فحص: ${translateDoctorStage(stage)}…`}});lastDoctorReport=report;
    const high=report.issues.filter(x=>x.severity==='high').length,medium=report.issues.filter(x=>x.severity==='medium').length,failed=Object.values(report.checks).filter(x=>x.status==='FAIL').length;
    verdict.textContent=report.verdict==='HEALTHY'?'سليم ✓':report.verdict==='GOOD_WITH_NOTES'?'جيد مع ملاحظات':'يحتاج انتباه';verdict.className=report.verdict==='HEALTHY'?'healthy':'attention';
    summary.textContent=`${Object.keys(report.checks).length} فحص · ${report.issues.length} ملاحظة · ${high} عالية · ${medium} متوسطة · ${report.safeRepairCount} قابلة للإصلاح الآمن`;
    const lines=[`BARSA Doctor · ${mode.toUpperCase()} · ${report.verdict}`,`المدة: ${(report.elapsedMs/1000).toFixed(2)}s`,''];
    for(const [id,entry] of Object.entries(report.checks))lines.push(`${entry.status==='PASS'?'✓':'✗'} ${id}${entry.elapsedMs!=null?` · ${Math.round(entry.elapsedMs)}ms`:''}${entry.error?` · ${entry.error}`:''}`);
    if(report.issues.length){lines.push('','المشاكل/الملاحظات:');for(const item of report.issues)lines.push(`${item.severity==='high'?'❗':'•'} ${item.message}${item.repair?' · إصلاح آمن متاح':''}`)}else lines.push('','✓ لم يعثر الدكتور على مشكلة قابلة للرصد.');
    result.textContent=lines.join('\n');
  }catch(error){lastDoctorReport=null;verdict.textContent='تعذر الفحص';verdict.className='attention';result.textContent=`❌ ${error.message}`;summary.textContent='لم يكتمل التشخيص';toast(`BARSA Doctor: ${error.message}`)}
  finally{['doctorQuickBtn','doctorFullBtn','doctorStressBtn'].map(byId).filter(Boolean).forEach(b=>b.disabled=false);const repair=byId('doctorRepairBtn');if(repair)repair.disabled=!lastDoctorReport?.safeRepairCount}
}
async function repairBarsaDoctor(){
  if(!lastDoctorReport)return;const button=byId('doctorRepairBtn'),result=byId('doctorResult'),summary=byId('doctorSummary');button.disabled=true;const before=result.textContent;
  try{const repaired=await manager.doctor.repairSafe(lastDoctorReport,{onProgress:(action)=>{summary.textContent=`جارٍ الإصلاح الآمن: ${action}`}});result.textContent=`${before}\n\nالإصلاح:\n✓ تم: ${repaired.fixed}\n✗ فشل: ${repaired.failed}\n${repaired.repairs.map(x=>`${x.status==='FIXED'?'✓':x.status==='FAILED'?'✗':'•'} ${x.action}${x.error?` · ${x.error}`:''}`).join('\n')}`;summary.textContent=`اكتمل الإصلاح الآمن · ${repaired.fixed} تم · ${repaired.failed} فشل`;toast(repaired.failed?'اكتمل الإصلاح مع بعض المشاكل':'BARSA Doctor أصلح المشاكل الآمنة ✓');await runBarsaDoctor('quick')}catch(error){result.textContent=`${before}\n\n❌ تعذر الإصلاح: ${error.message}`;summary.textContent='فشل الإصلاح الآمن'}finally{button.disabled=!lastDoctorReport?.safeRepairCount}}
function translateDoctorStage(stage){const raw=String(stage||'');if(raw.startsWith('model:'))return`النموذج ${raw.slice(6)}`;if(raw.startsWith('stress:'))return`ضغط · ${raw.slice(7)}`;return({capabilities:'قدرات الجهاز',storage:'التخزين والاستكمال',performance:'الذاكرة والأداء',models:'النماذج ومحركات AI','resume-integrity':'سلامة Resume',hardware:'الترميز والعتاد','cancel-restart':'الإلغاء وإعادة البدء','stress-device-suite':'اختبار الضغط الشامل'})[raw]||raw}

async function runHardwareTest(){
  const button=byId('hardwareTestBtn'),result=byId('hardwareTestResult');
  const autoInstallModels=byId('hardwareTestAutoModels')?.checked!==false;
  button.disabled=true;button.textContent='جارٍ الاختبار الفعلي…';
  result.textContent='بدء Verification Center: كل أداة ستأخذ PASS / FAIL / SKIPPED حسب التنفيذ الحقيقي على هذا الجهاز…';
  try{
    const report=await manager.deviceTest.run({autoInstallModels,onProgress:(stage)=>{result.textContent=`جارٍ اختبار: ${stage}…`}});
    if(androidBridge.available){const nativeTest=androidBridge.runNativeAiSelfTest();report.results['Native ONNX Android']={status:nativeTest?.passed?'PASS':'LIMITED',result:nativeTest,error:nativeTest?.passed?null:(nativeTest?.error||'Native self-test unavailable')}}
    const rows=Object.entries(report.results).map(([name,item])=>{
      const icon=item.status==='PASS'?'✅':item.status==='FAIL'?'❌':item.status==='LIMITED'?'⚠️':'⏭';
      const extra=item.result?.encodeFps?` · ${item.result.encodeFps.toFixed(1)} fps`:item.result?.tileSize?` · Tile ${item.result.tileSize}`:item.error?` · ${item.error}`:'';
      return `${icon} ${name}: ${item.status}${extra}`;
    });
    result.textContent=`BARSA SHOPI v9.2 COMPACT STACK VERIFICATION · ${report.verdict}

${rows.join('\n')}

${report.note}`;
    toast(report.verdict==='PASS'?'كل الاختبارات المتاحة نجحت فعلياً':report.verdict==='LIMITED'?'نجحت الاختبارات المتاحة وبعض العناصر غير مدعومة/غير مثبتة':'يوجد اختبار فاشل؛ راجع النتيجة الحمراء');
  }catch(error){result.textContent=`❌ تعذر إكمال الاختبار: ${error.message}`;toast('فشل الاختبار الفعلي')}
  finally{button.disabled=false;button.textContent='إعادة الاختبار الفعلي الشامل'}
}

async function ensureIsolatedRuntime(){if(!('serviceWorker'in navigator)||new URLSearchParams(location.search).has('no-sw'))return;try{await navigator.serviceWorker.register('./sw.js',{scope:'./'});await navigator.serviceWorker.ready;if(!crossOriginIsolated&&!navigator.serviceWorker.controller)await Promise.race([new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true})),new Promise(resolve=>setTimeout(resolve,1500))]);if(!crossOriginIsolated&&navigator.serviceWorker.controller&&!sessionStorage.getItem('vtp-isolation-reload')){sessionStorage.setItem('vtp-isolation-reload','1');location.reload();await new Promise(()=>{})}if(crossOriginIsolated)sessionStorage.removeItem('vtp-isolation-reload')}catch{}}

function applyPreset(name){const v=ENGINE_PRESETS[name];if(!v)return;byId('resolution').value=v.resolution;byId('targetFps').value=v.fps;byId('quality').value=v.quality;if(v.ai){byId('upscaleEnabled').checked=Boolean(v.ai.upscale);byId('rifeEnabled').checked=Boolean(v.ai.rife);byId('faceEnabled').checked=Boolean(v.ai.face)}applyEffectsToUI(v.effects);labs.applySettings({qualityLab:{sceneAware:v.sceneAware!==false,mode:v.mode,stages:buildPresetStages(v.stages)},faceLab:v.faceLab||{faceDetection:true,faceDetail:offStage(),skinCleanup:offStage(),skinSmoothing:offStage()},blur:{...defaultPresetBlur(),...v.blur},colorLab:{...neutralPresetColor(),...v.color}});renderCustomSize();renderOutputReadiness();updatePreview();updatePreflightEstimate();toast(v.message||`تم تطبيق ${name}`)}
const PRESET_STAGE_IDS=['denoise','temporalDenoise','deblock','deband','artifactRemoval','detailRecovery','fineDetailRecovery','textureRecovery','edgeRecovery','clarity','localContrast','smartSharpen','dehalo','antiRinging','antiFlicker','temporalDetailStability'];
const PRESET_BASE_EFFECTS={brightness:0,contrast:1,saturation:1,vibrance:0,sharpen:0,detail:0,highPass:0,denoise:0,temporalDenoise:0,antiFlicker:0,portraitSmooth:0,temperature:0,exposure:0,highlights:0,shadows:0,whites:0,blacks:0,dehaze:0,vignette:0,grain:0};
const ENGINE_PRESETS={
  'natural-restore':{resolution:'original',fps:'original',quality:'HIGH',mode:'natural',ai:{upscale:false,rife:false,face:false},effects:{...PRESET_BASE_EFFECTS,contrast:1.03,vibrance:.05,denoise:.1,temporalDenoise:.08,detail:.18,sharpen:.16,antiFlicker:.08},stages:{denoise:.1,temporalDenoise:.08,artifactRemoval:.1,detailRecovery:.18,fineDetailRecovery:.1,textureRecovery:.08,smartSharpen:.16,dehalo:.06,antiRinging:.06,antiFlicker:.08,temporalDetailStability:.1},color:{contrast:1.03,vibrance:.05},message:'Natural Restore: تنظيف هادئ مع تفاصيل طبيعية'},
  'tiktok-rescue':{resolution:'1080',fps:'original',quality:'HIGH',mode:'strong',ai:{upscale:false,rife:false,face:false},effects:{...PRESET_BASE_EFFECTS,contrast:1.04,vibrance:.09,denoise:.24,temporalDenoise:.18,detail:.3,sharpen:.22,antiFlicker:.16,dehaze:.03},stages:{denoise:.24,temporalDenoise:.18,deblock:.52,deband:.26,artifactRemoval:.56,detailRecovery:.3,fineDetailRecovery:.2,textureRecovery:.16,edgeRecovery:.14,clarity:.1,localContrast:.1,smartSharpen:.22,dehalo:.12,antiRinging:.18,antiFlicker:.16,temporalDetailStability:.22},color:{contrast:1.04,highlights:-.05,shadows:.05,vibrance:.09,dehaze:.03},message:'TikTok Rescue: إنقاذ الضغط والبلوكات بدون حدة زائدة'},
  'low-light':{resolution:'original',fps:'original',quality:'HIGH',mode:'strong',ai:{upscale:false,rife:false,face:false},effects:{...PRESET_BASE_EFFECTS,exposure:.16,contrast:1.02,shadows:.14,blacks:-.02,vibrance:.04,denoise:.4,temporalDenoise:.34,detail:.2,sharpen:.12,antiFlicker:.2},stages:{denoise:.42,temporalDenoise:.36,deblock:.18,deband:.22,artifactRemoval:.18,detailRecovery:.2,fineDetailRecovery:.12,textureRecovery:.08,edgeRecovery:.08,clarity:.05,localContrast:.06,smartSharpen:.12,dehalo:.06,antiRinging:.08,antiFlicker:.2,temporalDetailStability:.3},color:{exposure:.16,contrast:1.02,highlights:-.18,shadows:.18,blacks:-.02,temperature:-.02,saturation:.98,vibrance:.05,dehaze:.06},message:'Low Light: إزالة ضوضاء أقوى مع رفع الظلال والمحافظة على الوجه'},
  'anime-clean':{resolution:'original',fps:'original',quality:'HIGH',mode:'strong',ai:{upscale:false,rife:false,face:false},effects:{...PRESET_BASE_EFFECTS,contrast:1.06,saturation:1.05,vibrance:.08,denoise:.08,temporalDenoise:.06,detail:.28,sharpen:.26,antiFlicker:.08},stages:{denoise:.08,temporalDenoise:.06,deblock:.1,deband:.12,artifactRemoval:.08,detailRecovery:.28,fineDetailRecovery:.18,textureRecovery:.08,edgeRecovery:.34,clarity:.12,localContrast:.08,smartSharpen:.28,dehalo:.16,antiRinging:.22,antiFlicker:.08,temporalDetailStability:.14},color:{contrast:1.06,saturation:1.05,vibrance:.08,clarity:.06},message:'Anime Clean: حواف أوضح مع Anti-Ringing وDehalo لحماية الرسوم'},
  'face-focus':{resolution:'original',fps:'original',quality:'HIGH',mode:'natural',ai:{upscale:false,rife:false,face:true},effects:{...PRESET_BASE_EFFECTS,contrast:1.02,vibrance:.04,denoise:.16,temporalDenoise:.12,detail:.14,sharpen:.12,portraitSmooth:.08},stages:{denoise:.16,temporalDenoise:.12,artifactRemoval:.1,detailRecovery:.14,fineDetailRecovery:.08,textureRecovery:.06,smartSharpen:.12,dehalo:.06,antiRinging:.06,antiFlicker:.1,temporalDetailStability:.14},faceLab:{faceDetection:true,faceDetail:{enabled:true,strength:.42},skinCleanup:{enabled:true,strength:.22},skinSmoothing:{enabled:true,strength:.1}},color:{contrast:1.02,highlights:-.04,shadows:.04,vibrance:.04},message:'Face Focus: فعّل ترميم الوجه مع تفاصيل متوازنة وبشرة طبيعية'},
  'old-video':{resolution:'original',fps:'original',quality:'HIGH',mode:'strong',ai:{upscale:false,rife:false,face:false},effects:{...PRESET_BASE_EFFECTS,contrast:1.03,vibrance:.05,denoise:.32,temporalDenoise:.28,detail:.24,sharpen:.14,antiFlicker:.32},stages:{denoise:.32,temporalDenoise:.3,deblock:.44,deband:.4,artifactRemoval:.36,detailRecovery:.24,fineDetailRecovery:.14,textureRecovery:.1,edgeRecovery:.08,clarity:.06,localContrast:.06,smartSharpen:.14,dehalo:.08,antiRinging:.14,antiFlicker:.34,temporalDetailStability:.38},color:{contrast:1.03,highlights:-.08,shadows:.08,saturation:.98,vibrance:.04},message:'Old Video: معالجة قوية للوميض والـ banding والضغط القديم'},
  'gaming-60':{resolution:'1080',fps:'60',quality:'HIGH',mode:'strong',ai:{upscale:false,rife:true,face:false},effects:{...PRESET_BASE_EFFECTS,contrast:1.07,saturation:1.03,vibrance:.12,dehaze:.05,denoise:.08,temporalDenoise:.06,detail:.4,sharpen:.3,antiFlicker:.08},stages:{denoise:.08,temporalDenoise:.06,deblock:.08,artifactRemoval:.1,detailRecovery:.4,fineDetailRecovery:.34,textureRecovery:.3,edgeRecovery:.28,clarity:.18,localContrast:.16,smartSharpen:.3,dehalo:.12,antiRinging:.12,antiFlicker:.08,temporalDetailStability:.24},color:{contrast:1.07,saturation:1.03,vibrance:.12,clarity:.1,dehaze:.05},message:'Gaming 60: RIFE 60FPS مع تفاصيل حركة مرتفعة'},
  'clean-4k':{resolution:'2160',fps:'original',quality:'ULTRA',mode:'strong',ai:{upscale:true,rife:false,face:false},effects:{...PRESET_BASE_EFFECTS,contrast:1.05,vibrance:.08,denoise:.18,temporalDenoise:.14,detail:.34,sharpen:.28,antiFlicker:.12},stages:{denoise:.18,temporalDenoise:.14,deblock:.22,deband:.12,artifactRemoval:.22,detailRecovery:.34,fineDetailRecovery:.26,textureRecovery:.2,edgeRecovery:.16,clarity:.12,localContrast:.1,smartSharpen:.28,dehalo:.12,antiRinging:.12,antiFlicker:.12,temporalDetailStability:.18},color:{exposure:.03,contrast:1.05,highlights:-.05,shadows:.04,whites:.03,blacks:-.02,vibrance:.08,clarity:.06,dehaze:.03},message:'Clean 4K: AI Upscale مع تنظيف وتفاصيل متوازنة'},
  'sports-detail':{resolution:'2160',fps:'original',quality:'ULTRA',mode:'strong',ai:{upscale:true,rife:false,face:false},effects:{...PRESET_BASE_EFFECTS,contrast:1.08,saturation:1.03,vibrance:.13,dehaze:.07,denoise:.12,temporalDenoise:.1,detail:.44,sharpen:.34,antiFlicker:.12},stages:{denoise:.12,temporalDenoise:.1,deblock:.12,artifactRemoval:.15,detailRecovery:.44,fineDetailRecovery:.38,textureRecovery:.34,edgeRecovery:.24,clarity:.2,localContrast:.16,smartSharpen:.34,dehalo:.15,antiRinging:.14,antiFlicker:.12,temporalDetailStability:.24},color:{exposure:.03,contrast:1.08,highlights:-.08,shadows:.05,whites:.06,blacks:-.04,saturation:1.03,vibrance:.13,clarity:.12,dehaze:.07}},
  'maximum-detail':{resolution:'2160',fps:'original',quality:'ULTRA',mode:'ultra',ai:{upscale:true,rife:false,face:false},effects:{...PRESET_BASE_EFFECTS,contrast:1.07,vibrance:.1,denoise:.14,temporalDenoise:.12,detail:.58,sharpen:.42,antiFlicker:.15},stages:{denoise:.14,temporalDenoise:.12,deblock:.16,deband:.08,artifactRemoval:.18,detailRecovery:.58,fineDetailRecovery:.5,textureRecovery:.42,edgeRecovery:.34,clarity:.24,localContrast:.2,smartSharpen:.42,dehalo:.2,antiRinging:.2,antiFlicker:.15,temporalDetailStability:.3},color:{contrast:1.07,highlights:-.07,shadows:.04,whites:.05,blacks:-.04,vibrance:.1,clarity:.1,dehaze:.05},message:'Master Detail: أقصى استعادة تفاصيل مع AI Upscale'},
  'compressed-rescue':{resolution:'original',fps:'original',quality:'HIGH',mode:'strong',ai:{upscale:false,rife:false,face:false},effects:{...PRESET_BASE_EFFECTS,contrast:1.03,vibrance:.06,denoise:.28,temporalDenoise:.22,detail:.28,sharpen:.2,antiFlicker:.18},stages:{denoise:.28,temporalDenoise:.22,deblock:.48,deband:.28,artifactRemoval:.5,detailRecovery:.28,fineDetailRecovery:.18,textureRecovery:.14,edgeRecovery:.12,clarity:.08,localContrast:.08,smartSharpen:.2,dehalo:.14,antiRinging:.2,antiFlicker:.18,temporalDetailStability:.22},color:{contrast:1.03,highlights:-.05,shadows:.04,vibrance:.06,dehaze:.03}},
  'blur-pro':{resolution:'original',fps:'original',quality:'HIGH',mode:'natural',ai:{upscale:false,rife:false,face:false},effects:{...PRESET_BASE_EFFECTS,contrast:1.02,denoise:.08,temporalDenoise:.08,detail:.12,antiFlicker:.08},stages:{denoise:.08,temporalDenoise:.08,detailRecovery:.12,textureRecovery:.08,antiFlicker:.08,temporalDetailStability:.16},blur:{enabled:true,amount:2,outputFps:'source',weighting:'gaussian_sym',gamma:1,interpolation:false,preInterpolation:false,interpolationFps:'source',interpolationMultiplier:2,deduplicate:true,deduplicateRange:2,deduplicateThreshold:.006,deduplicateMethod:'skip'},color:{contrast:1.02,vibrance:.04},message:'Blur Pro: يجهز Temporal Blur ويبقي كل القيم مفتوحة للتعديل'},
};
function buildPresetStages(values={}){return Object.fromEntries(PRESET_STAGE_IDS.map(id=>[id,{enabled:Number(values[id])>0,strength:Number(values[id])||0}]))}
function offStage(){return{enabled:false,strength:0}}
function defaultPresetBlur(){return{enabled:false,amount:1,outputFps:'source',weighting:'gaussian_sym',gamma:1,interpolation:false,preInterpolation:false,interpolationFps:'source',interpolationMultiplier:2,deduplicate:false,deduplicateRange:2,deduplicateThreshold:.006,deduplicateMethod:'skip',gaussian:{stdDev:1,mean:0,bound:[-2,2]}}}
function neutralPresetColor(){return{enabled:true,exposure:0,contrast:1,highlights:0,shadows:0,whites:0,blacks:0,temperature:0,tint:0,saturation:1,vibrance:0,lift:0,gamma:1,gain:1,clarity:0,dehaze:0,curves:{luma:'0:0,1:1',red:'0:0,1:1',green:'0:0,1:1',blue:'0:0,1:1'},lutStrength:0}}
function updatePreview(){const s=collectSettings(),previewEffects=labs.previewEffects(s.effects);previewEngine?.configure(previewEffects,{resolution:s.resolution,aspectRatio:s.aspectRatio,fitMode:s.fitMode,customWidth:s.customWidth,customHeight:s.customHeight,backgroundColor:s.backgroundColor})}function togglePreviewPlayback(){const v=byId('sourceVideo');if(!sourceFile)return;if(v.paused)previewEngine?.play().catch(()=>toast('تعذر تشغيل المعاينة'));else previewEngine?.pause()}
function runAutoFix(){if(!previewEngine)return;const button=byId('autoFixBtn'),label=button.querySelector(':scope > span:last-child');button.disabled=true;label.textContent='يفحص…';requestAnimationFrame(()=>{try{const frame=previewEngine.captureFrame(),r=autoFix.analyze(frame),qualityMetrics=manager.engines.quality.analyze(frame),mode=byId('ql-mode')?.value||'natural',plan=manager.engines.quality.smartPlan(qualityMetrics,mode);labs.applySmartPlan(plan);labs.applySettings({colorLab:{enabled:true,exposure:r.effects.exposure||0,contrast:r.effects.contrast,saturation:r.effects.saturation,vibrance:r.effects.vibrance,temperature:r.effects.temperature||0}});applyEffectsToUI({brightness:r.effects.brightness,highPass:r.effects.highPassAmount});byId('analysisExposure').textContent=qualityMetrics.exposure<.36?'منخفضة':qualityMetrics.exposure>.7?'مرتفعة':'متوازنة';byId('analysisNoise').textContent=qualityMetrics.noise>.55?'عالية':qualityMetrics.noise>.26?'متوسطة':'قليلة';byId('analysisDetail').textContent=qualityMetrics.detail<.3?'ناعمة':qualityMetrics.detail>.62?'حادة':'جيدة';byId('analysisSummary').textContent=`${r.summary} · ${plan.summary}`;byId('analysisCard').hidden=false;updatePreview();updatePreflightEstimate();toast('تم تحليل الإطار وتفعيل المراحل المفيدة فقط')}catch(e){showError(e)}finally{button.disabled=false;label.textContent='إعادة'}})}
function applyEffectsToUI(values={}){for(const[id,value]of Object.entries(values)){const input=byId(id),output=byId(`${id}Out`);if(!input||value==null)continue;input.value=value;if(output)output.value=Number(value).toFixed(2)}}
let preflightToken=0;async function updatePreflightEstimate(){if(!sourceMetadata||!manager.capabilities)return;const token=++preflightToken,s=collectSettings();let o;try{o=resolveOutputGeometry(sourceMetadata.width,sourceMetadata.height,s)}catch(error){byId('preflightEta').textContent='راجع المقاس';byId('preflightDetail').textContent=error.message;return}const fps=s.targetFps||sourceMetadata.fps,e=estimator.estimate({duration:sourceMetadata.duration,sourceWidth:sourceMetadata.width,sourceHeight:sourceMetadata.height,targetWidth:o.width,targetHeight:o.height,sourceFps:sourceMetadata.fps,targetFps:fps,effects:s.effects,ai:{upscale:Boolean(s.upscaleModelId),rife:Boolean(s.rifeModelId),face:Boolean(s.faceModelId)},tier:manager.engines.performance.tier});if(!e)return;byId('preflightEta').textContent=`حوالي ${formatDuration(e.seconds)}`;byId('preflightDetail').textContent=`${o.width}×${o.height} · ${e.frames.toLocaleString('ar-IQ')} إطار · ${e.confidence}`;const bpp={LOW:.065,BALANCED:.11,HIGH:.18,ULTRA:.28}[s.quality]||.11,outputBytes=o.width*o.height*fps*sourceMetadata.duration*bpp/8+(s.audioEnabled?sourceMetadata.duration*20000:0),workspaceBytes=sourceFile.size+outputBytes*(s.audioEnabled?2.4:1.65),usage=await manager.engines.storage.getStorageUsage().catch(()=>({}));if(token!==preflightToken)return;const available=usage.quotaBytes==null?'غير معلومة':formatBytes(Math.max(0,usage.quotaBytes-(usage.usageBytes||0)));byId('preflightStorage').textContent=`إخراج MP4 متوقع ${formatBytes(outputBytes)} · مساحة عمل ${formatBytes(workspaceBytes)} · متوفر ${available}`;byId('preflightStorage').classList.toggle('warning',usage.quotaBytes!=null&&usage.quotaBytes-(usage.usageBytes||0)<workspaceBytes+67108864)}

function showRestoreBanner(s){byId('restoreBanner').hidden=false;byId('restoreDetails').textContent=`${s.metadata?.sourceName||'فيديو'} · ${Math.round((s.progress||0)*100)}%`}
async function restoreInterrupted(){if(!interruptedSession)return;try{const checkpoint=interruptedSession;if(checkpoint.status!=='remux_pending'&&(checkpoint.durableResume!==true||!Number.isFinite(Number(checkpoint.resumeSourceFrameIndex??checkpoint.sourceFrameIndex)))){throw new Error('هذه الجلسة قديمة ولا تحتوي نقطة Resume آمنة؛ يمكن استعادة المصدر فقط وإعادة الرندر')}const file=await manager.engines.storage.getCachedSourceFile(checkpoint.sessionId);if(!file)throw new Error('الملف المؤقت لم يعد موجودًا');const restored=new File([file],checkpoint.sourceOriginalName||checkpoint.metadata?.sourceName||'restored-video.mp4',{type:checkpoint.sourceType||file.type||'video/mp4'}),options=checkpoint.jobOptions||checkpoint.metadata?.jobOptions;if(!options)throw new Error('إعدادات الرندر المحفوظة غير موجودة');applyRestoredSettings(options);await selectSource(restored);byId('restoreBanner').hidden=true;toast(checkpoint.status==='remux_pending'?'الرندر مكتمل؛ جاري استعادة MP4 بدون إعادة معالجة الإطارات':`متابعة الرندر من الإطار ${checkpoint.resumeSourceFrameIndex??checkpoint.sourceFrameIndex}`);const renderIntent=String(options.renderIntent||'');const recoveredStage=renderIntent.startsWith('apply-')?renderIntent.slice(6):null;const result=await runProcessingWithSettings(options,recoveredStage?'apply-stage-resume':'video-process-resume',{deferShow:Boolean(recoveredStage),inputFile:restored,inputMetadata:sourceMetadata,resumeCheckpoint:checkpoint});if(result){if(recoveredStage){await applyStack.adoptRecoveredStage(recoveredStage,{blob:result.blob,metadata:result.metadata,settings:options,signature:`resume-${checkpoint.sessionId}`});renderApplyStack();await setWorkingPreviewFromApplyStack();toast(`اكتملت متابعة ${recoveredStage} من نقطة الحفظ ✓`)}else{toast('اكتملت متابعة الرندر من نقطة الحفظ ✓')}interruptedSession=null}}catch(e){toast(`تعذرت المتابعة: ${e.message}`)}}
async function dismissInterrupted(){byId('restoreBanner').hidden=true;if(interruptedSession)await manager.engines.storage.deleteSession(interruptedSession.sessionId).catch(()=>{});interruptedSession=null}
function applyRestoredSettings(s){byId('resolution').value=s.resolution||'original';byId('aspectRatio').value=s.aspectRatio||'original';byId('fitMode').value=s.fitMode||'contain';byId('customWidth').value=s.customWidth||1080;byId('customHeight').value=s.customHeight||1920;byId('targetFps').value=s.targetFps?String(s.targetFps):'original';byId('quality').value=s.quality||'BALANCED';byId('outputFormat').value='mp4';byId('performanceMode').value=s.performanceMode||'auto';byId('protectSceneCuts').checked=s.protectSceneCuts!==false;byId('audioEnabled').checked=s.audioEnabled!==false;byId('audioCleanEnabled').checked=s.audio?.enabled!==false;manager.engines.performance.setMode(byId('performanceMode').value);renderCustomSize();labs.applySettings(s);applyEffectsToUI({brightness:s.effects?.brightness,contrast:s.effects?.contrast,saturation:s.effects?.saturation,vibrance:s.effects?.vibrance,sharpen:s.effects?.sharpenAmount,detail:s.effects?.detailAmount,highPass:s.effects?.highPassAmount,denoise:s.effects?.denoiseAmount,temporalDenoise:s.effects?.temporalDenoise,antiFlicker:s.effects?.antiFlicker,portraitSmooth:s.effects?.portraitSmooth,temperature:s.effects?.temperature,exposure:s.effects?.exposure,highlights:s.effects?.highlights,shadows:s.effects?.shadows,whites:s.effects?.whites,blacks:s.effects?.blacks,dehaze:s.effects?.dehaze,vignette:s.effects?.vignette,grain:s.effects?.grain,faceStrength:s.faceStrength})}
async function saveResultToAndroid(){
  if(!androidBridge.available||!lastResultBlob)return;
  const button=byId('nativeSaveBtn');
  const original=button.textContent;
  button.disabled=true;androidBridge.setKeepScreenOn(true);
  try{
    const saved=await androidBridge.saveBlob(lastResultBlob,lastResultFileName,{sourceDateMs:lastResultSourceDateMs,onProgress:p=>{button.textContent=`حفظ في المعرض · ${Math.round(p*100)}%`}});
    button.textContent='تم الحفظ ✓';androidBridge.vibrate(45);toast(`تم حفظ ${saved.fileName} في Movies/BARSA SHOPI`);if(lastResultSessionId){manager.engines.storage.deleteSession(lastResultSessionId).catch(()=>{});lastResultSessionId=null}
  }catch(error){button.textContent=original;showError(error)}finally{androidBridge.setKeepScreenOn(false);button.disabled=false;setTimeout(()=>{if(button.textContent==='تم الحفظ ✓')button.textContent=original},2200)}
}


function schedulePreferenceSave(){settingsStore.schedule(()=>({settings:collectSettings(),modelSelection:{...modelSelection}}),500)}
function savePreferences(){settingsStore.save({settings:collectSettings(),modelSelection:{...modelSelection}})}
function restoreSavedPreferences(){const saved=settingsStore.load();if(!saved)return false;try{if(saved.modelSelection){for(const role of ['upscale','rife','face']){const value=saved.modelSelection[role];if(value){modelSelection[role]=value;const select=byId(`${role}ModelProfile`);if(select&&[...select.options].some(o=>o.value===value))select.value=value}}}if(saved.settings)applyRestoredSettings(saved.settings);byId('prefsStatus')&&(byId('prefsStatus').textContent='تمت استعادة إعداداتك المحفوظة');return true}catch(error){console.warn('Preference restore skipped',error);return false}}
function resetProfessionalDefaults(){document.querySelectorAll('.preset').forEach(x=>x.classList.toggle('active',x.dataset.preset==='natural-restore'));applyPreset('natural-restore');byId('resolution').value='1080';byId('aspectRatio').value='original';byId('fitMode').value='contain';byId('targetFps').value='original';byId('quality').value='BALANCED';byId('performanceMode').value=manager.capabilities?.deviceProfile?.recommendedMode==='poco-f6'?'poco-f6':'auto';byId('exportVideoMode').value='auto';byId('exportAudioBitrateK').value='192';byId('exportAcceleration').value='auto';manager.engines.performance.setMode(byId('performanceMode').value);renderCustomSize();updatePreview();updatePreflightEstimate();renderOutputReadiness()}

function resetInterface(){sourceSelectionToken++;workingPreviewToken++;preflightToken++;clearTimeout(interactiveRefreshTimer);interactiveRefreshTimer=null;clearTimeout(preparedStateTimer);preparedStateTimer=null;clearTimeout(previewSeekTimer);previewSeekTimer=null;clearPreparedRender(false);applyStack.reset();renderApplyStack();previewEngine?.destroy();previewEngine=null;if(sourceURL)URL.revokeObjectURL(sourceURL);if(resultURL)URL.revokeObjectURL(resultURL);lastResultRelease?.().catch(error=>console.error('[BARSA][output-lease][reset-release-failed]',error));sourceURL=null;resultURL=null;lastResultBlob=null;lastResultFileName=null;lastResultSessionId=null;lastResultSourceDateMs=0;lastResultMetadata=null;lastResultRelease=null;sourceFile=null;sourceMetadata=null;const sourceVideo=byId('sourceVideo'),resultVideo=byId('resultVideo');sourceVideo.pause?.();resultVideo.pause?.();sourceVideo.onplay=null;sourceVideo.onpause=null;sourceVideo.onseeked=null;sourceVideo.removeAttribute('src');resultVideo.removeAttribute('src');sourceVideo.load?.();resultVideo.load?.();byId('dropzone').hidden=false;byId('previewShell').hidden=true;byId('progressPanel').hidden=true;byId('resultPanel').hidden=true;byId('startBtn').disabled=true;byId('prepareEffectsBtn')&&(byId('prepareEffectsBtn').disabled=true);byId('autoFixBtn').disabled=true;byId('analysisCard').hidden=true;byId('preflightEta').textContent='اختر فيديو للقياس';byId('preflightDetail').textContent='';byId('preflightStorage').textContent='المساحة تُفحص قبل بدء الرندر';byId('preflightStorage').classList.remove('warning')}
function setControlsDisabled(disabled){document.querySelectorAll('.controls-panel input,.controls-panel select,.controls-panel button').forEach(e=>{e.disabled=disabled});if(!disabled)refreshModelStates().catch(()=>{})}
function showError(e){console.error(e);toast(e?.message||'حدث خطأ غير متوقع')}function showFatalError(e){showError(e);byId('backendBadge').textContent='تعذر البدء';byId('startBtn').disabled=true}
let toastTimer;function toast(message){const el=byId('toast');el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true},4500)}
function once(target,success,failure){return new Promise((resolve,reject)=>{const ok=e=>{cleanup();resolve(e)},bad=()=>{cleanup();reject(new Error(failure))},cleanup=()=>{target.removeEventListener(success,ok);target.removeEventListener(failure,bad)};target.addEventListener(success,ok,{once:true});target.addEventListener(failure,bad,{once:true})})}
function formatBytes(bytes){if(bytes<1048576)return`${(bytes/1024).toFixed(1)} KB`;if(bytes<1073741824)return`${(bytes/1048576).toFixed(1)} MB`;return`${(bytes/1073741824).toFixed(2)} GB`}
function renderCustomSize(){byId('customSize').hidden=byId('resolution').value!=='custom'}function formatClock(seconds){if(!Number.isFinite(seconds))return'00:00';const v=Math.max(0,Math.floor(seconds));return`${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`}
function formatCatalogSize(config){if(!config)return'';if(config.expectedSizeBytes)return formatBytes(config.expectedSizeBytes);return'ONNX'}
