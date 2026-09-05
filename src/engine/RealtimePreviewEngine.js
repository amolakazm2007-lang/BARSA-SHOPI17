import { WebGL2Engine } from './WebGL2Engine.js';
import { drawWithGeometry, resolveOutputGeometry } from './GeometryEngine.js';
import { TemporalConsistencyEngine } from './TemporalConsistencyEngine.js';

/** Real pixel preview for sharpen, denoise, detail and portrait controls. */
export class RealtimePreviewEngine extends EventTarget {
  constructor(video, canvas, { maxPixels = null } = {}) {
    super(); this.video=video; this.canvas=canvas; this.context=canvas.getContext('2d',{alpha:false,desynchronized:true});
    this.workCanvas=document.createElement('canvas'); this.workContext=this.workCanvas.getContext('2d',{alpha:false,willReadFrequently:true});
    this.originalCanvas=document.createElement('canvas'); this.originalContext=this.originalCanvas.getContext('2d',{alpha:false});
    this.gpuCanvas=document.createElement('canvas'); this.gpu=new WebGL2Engine(); this.backend='canvas2d';
    this.effects={}; this.geometrySettings={resolution:'original',aspectRatio:'original',fitMode:'contain',backgroundColor:'#000000'}; this.previewGeometry=null; this.compareEnabled=true; this.comparePosition=.5; this.pending=false; this.frameHandle=null; this.maxPixels=maxPixels||choosePreviewPixels(); this.destroyed=false; this.temporal=new TemporalConsistencyEngine({maxHistoryPixels:this.maxPixels}); this.lastTemporalTime=null; this.lastRenderAt=0; this.minFrameIntervalMs=choosePreviewInterval(this.maxPixels);
  }
  configure(effects={},geometrySettings=null){this.effects={...effects};if(geometrySettings){const changed=JSON.stringify(this.geometrySettings)!==JSON.stringify(geometrySettings);this.geometrySettings={...this.geometrySettings,...geometrySettings};if(changed&&this.video.videoWidth)this._resize()}this.requestRender()}
  setCompare(enabled,position=this.comparePosition){this.compareEnabled=Boolean(enabled);this.comparePosition=Math.max(0,Math.min(1,position));this.requestRender()}
  async initialize(){
    if(!this.video.videoWidth||!this.video.videoHeight)throw new Error('Preview source is not ready');
    this._resize();
    try{this.gpu.init(this.gpuCanvas);this.backend='webgl2'}catch{this.backend='canvas2d'}
    this.requestRender();
  }
  play(){return this.video.play()} pause(){this.video.pause();this.requestRender()}
  requestRender(){if(this.destroyed||this.pending||!this.video.videoWidth||this.video.readyState<2)return;this.pending=true;requestAnimationFrame(()=>{this.pending=false;this.renderFrame()})}
  renderFrame(){
    if(this.destroyed||this.video.readyState<2)return;
    const now=performance.now();
    if(!this.video.paused&&this.lastRenderAt&&now-this.lastRenderAt<this.minFrameIntervalMs){this._scheduleVideoFrame();return}
    this.lastRenderAt=now;
    const startedAt=now,{width,height}=this.canvas;
    drawWithGeometry(this.video,this.originalContext,this.previewGeometry,this.video.videoWidth,this.video.videoHeight);
    if(this.backend==='webgl2')try{this.gpu.renderFrame(this.originalCanvas,this.effects,{width,height});this.context.drawImage(this.gpuCanvas,0,0)}catch{this.gpu.destroy();this.backend='canvas2d'}
    if(this.backend==='canvas2d'){this.workContext.drawImage(this.originalCanvas,0,0,width,height);const image=this.workContext.getImageData(0,0,width,height);applyRealtimeEffects(image,this.effects);this.workContext.putImageData(image,0,0);this.context.drawImage(this.workCanvas,0,0)}
    const time=this.video.currentTime,delta=this.lastTemporalTime==null?null:time-this.lastTemporalTime;if(delta!=null&&delta>0&&delta<.5)this.temporal.process(this.canvas,this.context,{denoise:this.effects.temporalDenoise||0,antiFlicker:this.effects.antiFlicker||0});else this.temporal.reset();this.lastTemporalTime=time;
    if(this.compareEnabled){const split=Math.round(width*this.comparePosition);this.context.drawImage(this.originalCanvas,0,0,split,height,0,0,split,height)}
    const elapsed=performance.now()-startedAt;this.dispatchEvent(new CustomEvent('frame',{detail:{currentTime:this.video.currentTime,duration:this.video.duration,renderMs:elapsed,fps:elapsed?1000/elapsed:0,backend:this.backend}}));
    if(!this.video.paused&&!this.video.ended)this._scheduleVideoFrame();
  }
  captureFrame(){const{width,height}=this.originalCanvas;if(!width||!height)throw new Error('Preview is not initialized');return this.originalContext.getImageData(0,0,width,height)}
  _resize(){const resolved=resolveOutputGeometry(this.video.videoWidth,this.video.videoHeight,this.geometrySettings),scale=Math.min(1,Math.sqrt(this.maxPixels/(resolved.width*resolved.height))),width=Math.max(2,Math.round(resolved.width*scale/2)*2),height=Math.max(2,Math.round(resolved.height*scale/2)*2);for(const target of [this.canvas,this.workCanvas,this.originalCanvas,this.gpuCanvas]){target.width=width;target.height=height}this.previewGeometry={...resolved,width,height};this.temporal.reset();this.lastTemporalTime=null}
  _scheduleVideoFrame(){if(this.frameHandle!=null)return;if(this.video.requestVideoFrameCallback){this.frameHandle=this.video.requestVideoFrameCallback(()=>{this.frameHandle=null;this.renderFrame()})}else{this.frameHandle=requestAnimationFrame(()=>{this.frameHandle=null;this.renderFrame()})}}
  destroy(){this.destroyed=true;this.video.pause();if(this.frameHandle!=null){if(this.video.cancelVideoFrameCallback)this.video.cancelVideoFrameCallback(this.frameHandle);else cancelAnimationFrame(this.frameHandle)}this.frameHandle=null;this.gpu.destroy();this.temporal.destroy();for(const c of [this.canvas,this.workCanvas,this.originalCanvas,this.gpuCanvas]){c.width=1;c.height=1}}
}

export function applyRealtimeEffects(imageData, effects = {}) {
  const { width, height, data } = imageData;
  const brightness = effects.brightness || 0, contrast = effects.contrast ?? 1, saturation = effects.saturation ?? 1;
  const vibrance = effects.vibrance || 0, gamma = Math.max(.05, effects.gamma ?? 1), temperature = effects.temperature || 0;
  const tint = effects.tint || 0, lift = effects.lift || 0, gain = effects.gain ?? 1;
  const exposure = effects.exposure || 0, highlights = effects.highlights || 0, shadows = effects.shadows || 0;
  const whites = effects.whites || 0, blacks = effects.blacks || 0, dehaze = Math.max(0, effects.dehaze || 0);
  const vignette = Math.max(0, effects.vignette || 0), grain = Math.max(0, effects.grain || 0);
  const denoise = clamp01(effects.denoiseAmount || 0), smooth = clamp01(effects.portraitSmooth || 0);
  const deblock = clamp01(effects.deblockAmount || 0), deband = clamp01(effects.debandAmount || 0), artifact = clamp01(effects.artifactRemoval || 0), chromaDenoise = clamp01(effects.chromaDenoise || 0), mosquito = clamp01(effects.mosquitoNoise || 0), compressionRecovery = clamp01(effects.compressionRecovery || 0);
  const sharpen = Math.max(0, effects.sharpenAmount || 0), highPass = Math.max(0, effects.highPassAmount || 0), detail = Math.max(0, effects.detailAmount || 0);
  const recovery = (effects.fineDetailRecovery || 0) * .42 + (effects.textureRecovery || 0) * .2 + (effects.microTexture || 0) * .24 + (effects.structureRecovery || 0) * .32 + (effects.detailFusion || 0) * .38 + (effects.edgeRecovery || 0) * .3 + (effects.clarity || 0) * .28 + (effects.localContrast || 0) * .2;
  const source = new Uint8ClampedArray(data);

  if (denoise > .001 || smooth > .001 || deblock > .001 || deband > .001 || artifact > .001 || chromaDenoise > .001 || mosquito > .001 || compressionRecovery > .001) {
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const index = (y * width + x) * 4, r = source[index], g = source[index + 1], b = source[index + 2];
      const boundary = (x % 8 <= 1 || y % 8 <= 1) ? deblock * .45 : 0;
      const flat = edgeGate(source, index, width);
      const edgeResidue = 1 - flat;
      const local = Math.max(denoise * .46, boundary * flat, artifact * flat * .34, deband * flat * .22, mosquito * edgeResidue * .18, compressionRecovery * (boundary * .55 + flat * .16), isSkin(r, g, b) ? smooth * flat : 0);
      if (local <= .001) continue;
      const averages = [0,1,2].map((channel) => (source[index + channel] * 4 + source[index - 4 + channel] + source[index + 4 + channel] + source[index - width * 4 + channel] + source[index + width * 4 + channel]) / 8);
      const srcLuma = r*.2126+g*.7152+b*.0722, avgLuma=averages[0]*.2126+averages[1]*.7152+averages[2]*.0722;
      for (let channel = 0; channel < 3; channel++) {
        let target = averages[channel];
        if (chromaDenoise > .001) target += srcLuma - avgLuma;
        const mixAmount = Math.max(local, chromaDenoise * flat * .62);
        data[index + channel] = source[index + channel] * (1 - mixAmount) + target * mixAmount;
      }
    }
  }

  if (sharpen > .001 || highPass > .001 || detail > .001 || recovery > .001) {
    const base = new Uint8ClampedArray(data), amount = Math.min(2.8, sharpen + highPass * .55 + detail * .38 + recovery);
    const threshold = Math.max(0, (effects.sharpenThreshold ?? .02) * 255), clampStrength = clamp01(Math.max(effects.dehalo || 0, effects.antiRinging || 0));
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const center = base[index + channel], neighbours = [base[index - 4 + channel], base[index + 4 + channel], base[index - width * 4 + channel], base[index + width * 4 + channel]];
        const blur = (center * 4 + neighbours.reduce((sum, value) => sum + value, 0)) / 8, difference = center - blur;
        if (Math.abs(difference) >= threshold) {
          let value = center + difference * amount;
          if (clampStrength > 0) value += (Math.max(Math.min(value, Math.max(center, ...neighbours)), Math.min(center, ...neighbours)) - value) * clampStrength;
          data[index + channel] = clamp255(value);
        }
      }
    }
  }

  const inverseGamma = 1 / gamma, exposureScale = 2 ** exposure;
  for (let index = 0; index < data.length; index += 4) {
    let r = data[index] / 255, g = data[index + 1] / 255, b = data[index + 2] / 255;
    r += temperature * .08 + tint * .025 + lift; g += -tint * .05 + lift; b += -temperature * .08 + tint * .025 + lift;
    r *= exposureScale; g *= exposureScale; b *= exposureScale;
    let luma = r * .2126 + g * .7152 + b * .0722, shadowMask = (1 - clamp01(luma)) ** 2, highlightMask = clamp01(luma) ** 2;
    const zone = shadows * shadowMask * .28 + highlights * highlightMask * .24 + blacks * (1 - smoothstep(.08, .38, luma)) * .16 + whites * smoothstep(.62, .94, luma) * .14;
    r += zone; g += zone; b += zone;
    if (dehaze) { r = (r - .5) * (1 + dehaze * .34) + .5; g = (g - .5) * (1 + dehaze * .34) + .5; b = (b - .5) * (1 + dehaze * .34) + .5; luma = r * .2126 + g * .7152 + b * .0722; const hazeSat = 1 + dehaze * .18; r = luma + (r - luma) * hazeSat; g = luma + (g - luma) * hazeSat; b = luma + (b - luma) * hazeSat; }
    r = Math.pow(clamp01(r), inverseGamma) * gain; g = Math.pow(clamp01(g), inverseGamma) * gain; b = Math.pow(clamp01(b), inverseGamma) * gain;
    r = (r - .5) * contrast + .5 + brightness; g = (g - .5) * contrast + .5 + brightness; b = (b - .5) * contrast + .5 + brightness; luma = r * .2126 + g * .7152 + b * .0722;
    r = luma + (r - luma) * saturation; g = luma + (g - luma) * saturation; b = luma + (b - luma) * saturation;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b), adaptiveVibrance = 1 + vibrance * (1 - clamp01(chroma));
    r = luma + (r - luma) * adaptiveVibrance; g = luma + (g - luma) * adaptiveVibrance; b = luma + (b - luma) * adaptiveVibrance;
    const pixel = index / 4, x = pixel % width, y = Math.floor(pixel / width), nx = x / width * 2 - 1, ny = y / height * 2 - 1;
    const vignetteGain = 1 - smoothstep(.28, 1.35, nx * nx + ny * ny) * vignette * .58, noise = (hashNoise(x, y) - .5) * grain * .055;
    data[index] = clamp255((r * vignetteGain + noise) * 255); data[index + 1] = clamp255((g * vignetteGain + noise) * 255); data[index + 2] = clamp255((b * vignetteGain + noise) * 255);
  }
  return imageData;
}
function edgeGate(s,i,w){const stride=w*4,edge=Math.abs(lumaAt(s,i+4)-lumaAt(s,i-4))+Math.abs(lumaAt(s,i+stride)-lumaAt(s,i-stride));return 1-Math.min(1,edge/82)}
function lumaAt(d,i){return d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722}function isSkin(r,g,b){return r>95&&g>40&&b>20&&Math.max(r,g,b)-Math.min(r,g,b)>15&&Math.abs(r-g)>15&&r>g&&r>b}
function choosePreviewPixels(){const m=navigator.deviceMemory||4;return m<=2?360*640:m<=4?540*960:720*1280}function clamp01(v){return Math.max(0,Math.min(1,v))}function clamp255(v){return Math.max(0,Math.min(255,Math.round(v)))}
function smoothstep(a,b,v){const t=clamp01((v-a)/(b-a));return t*t*(3-2*t)}
function hashNoise(x,y){const v=Math.sin(x*12.9898+y*78.233)*43758.5453;return v-Math.floor(v)}

export function choosePreviewInterval(maxPixels){if(maxPixels>=1500000)return 1000/18;if(maxPixels>=900000)return 1000/24;return 1000/30}
