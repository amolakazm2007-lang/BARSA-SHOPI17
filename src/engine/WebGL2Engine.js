/** Mobile GPU fallback for the production effects pipeline. */
export class WebGL2Engine {
  constructor() {
    this.gl = null;
    this.program = null;
    this.texture = null;
    this.locations = new Map();
  }

  init(canvas, { performanceManager = null } = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      desynchronized: true, powerPreference: 'high-performance', preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.performanceManager = performanceManager;
    this.program = createProgram(gl, VERTEX, FRAGMENT);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, key, gl.LINEAR);
    for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
    gl.useProgram(this.program);
  }

  renderFrame(source, effects, { width, height }) {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) throw new Error('WebGL2 context lost');
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this._u('u_texture', 0, true);
    this._u2('u_texel', 1 / width, 1 / height);
    const uniforms = {
      u_brightness: effects.brightness || 0, u_contrast: effects.contrast ?? 1,
      u_saturation: effects.saturation ?? 1, u_vibrance: effects.vibrance || 0,
      u_gamma: effects.gamma ?? 1, u_temperature: effects.temperature || 0,
      u_sharpen: effects.sharpenAmount || 0, u_highpass: effects.highPassAmount || 0,
      u_denoise: effects.denoiseAmount || 0, u_detail: effects.detailAmount || 0,
      u_smooth: effects.portraitSmooth || 0, u_exposure: effects.exposure || 0,
      u_highlights: effects.highlights || 0, u_shadows: effects.shadows || 0,
      u_whites: effects.whites || 0, u_blacks: effects.blacks || 0,
      u_dehaze: effects.dehaze || 0, u_vignette: effects.vignette || 0,
      u_grain: effects.grain || 0, u_deblock: effects.deblockAmount || 0,
      u_deband: effects.debandAmount || 0, u_artifact: effects.artifactRemoval || 0,
      u_fine: effects.fineDetailRecovery || 0, u_texture_recovery: effects.textureRecovery || 0, u_detail_fusion: effects.detailFusion || 0,
      u_edge_recovery: effects.edgeRecovery || 0, u_clarity: effects.clarity || 0,
      u_local_contrast: effects.localContrast || 0, u_dehalo: effects.dehalo || 0,
      u_antiring: effects.antiRinging || 0, u_tint: effects.tint || 0,
      u_lift: effects.lift || 0, u_gain: effects.gain ?? 1,
    };
    for (const [name, value] of Object.entries(uniforms)) this._u(name, value);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.flush();
    this.performanceManager?.setGPUAllocation(width * height * 4);
  }

  _loc(name) {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    return this.locations.get(name);
  }
  _u(name, value, integer = false) { const location = this._loc(name); if (location != null) (integer ? this.gl.uniform1i(location, value) : this.gl.uniform1f(location, value)); }
  _u2(name, first, second) { const location = this._loc(name); if (location != null) this.gl.uniform2f(location, first, second); }

  destroy() {
    const gl = this.gl;
    if (gl) {
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.program) gl.deleteProgram(this.program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.performanceManager?.setGPUAllocation(0);
    this.gl = null; this.texture = null; this.vertexBuffer = null; this.vao = null; this.program = null;
    this.locations.clear();
  }
}

function createProgram(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader failed');
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource), fragment = compile(gl.FRAGMENT_SHADER, fragmentSource), program = gl.createProgram();
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Program failed');
  return program;
}

const VERTEX = `#version 300 es
in vec2 a_position; out vec2 v_uv;
void main(){ gl_Position=vec4(a_position,0.,1.); v_uv=a_position*vec2(.5,-.5)+.5; }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_texture; uniform vec2 u_texel;
uniform float u_brightness,u_contrast,u_saturation,u_vibrance,u_gamma,u_temperature,u_sharpen,u_highpass,u_denoise,u_detail,u_smooth,u_exposure,u_highlights,u_shadows,u_whites,u_blacks,u_dehaze,u_vignette,u_grain;
uniform float u_deblock,u_deband,u_artifact,u_chroma_denoise,u_fine,u_texture_recovery,u_detail_fusion,u_edge_recovery,u_clarity,u_local_contrast,u_dehalo,u_antiring,u_tint,u_lift,u_gain;
in vec2 v_uv; out vec4 outColor;
float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
vec3 s(vec2 o){return texture(u_texture,v_uv+o*u_texel).rgb;}
float skin(vec3 c){vec3 p=c*255.;float mx=max(p.r,max(p.g,p.b)),mn=min(p.r,min(p.g,p.b));return float(p.r>95.&&p.g>40.&&p.b>20.&&mx-mn>15.&&abs(p.r-p.g)>15.&&p.r>p.g&&p.r>p.b);}
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
  vec3 original=s(vec2(0)),c=original,n=s(vec2(0,-1)),so=s(vec2(0,1)),e=s(vec2(1,0)),w=s(vec2(-1,0)),blur=(c*4.+n+so+e+w)/8.;
  c=mix(c,blur,clamp(u_denoise*.48,0.,.55));
  vec2 pixel=v_uv/u_texel;float boundary=1.-smoothstep(.02,.18,min(min(fract(pixel.x/8.),1.-fract(pixel.x/8.)),min(fract(pixel.y/8.),1.-fract(pixel.y/8.))));
  float rangeGate=1.-smoothstep(.035,.22,distance(c,(n+so+e+w)*.25));c=mix(c,(n+so+e+w)*.25,boundary*rangeGate*u_deblock*.48);
  if(u_chroma_denoise>0.){vec3 avg=(c*4.+n+so+e+w)/8.;float lc=lum(c),la=lum(avg);vec3 preserve=avg+vec3(lc-la);float chromaDelta=distance(c-vec3(lc),avg-vec3(la));float gate=1.-smoothstep(.16,.42,chromaDelta);c=mix(c,preserve,clamp(u_chroma_denoise*gate*.72,0.,.82));}
  float artifactGate=1.-smoothstep(.08,.28,distance(c,blur));c=mix(c,blur,u_artifact*artifactGate*.34);
  vec3 far=(s(vec2(-2,0))+s(vec2(2,0))+s(vec2(0,-2))+s(vec2(0,2)))*.25;float flat=1.-smoothstep(.012,.075,distance(c,far));c=mix(c,far,u_deband*flat*.3)+vec3((hash(pixel)-.5)*u_deband/1024.);
  float edge=abs(lum(e)-lum(w))+abs(lum(so)-lum(n));c=mix(c,blur,skin(c)*u_smooth*(1.-smoothstep(.05,.2,edge)));
  float detailLoad=u_detail*.35+u_fine*.42+u_texture_recovery*.2+u_detail_fusion*.38+u_edge_recovery*.3+u_clarity*.28+u_local_contrast*.2;
  c+=(c-blur)*(u_sharpen+detailLoad);
  float hp=lum(c)*4.-lum(n)-lum(so)-lum(e)-lum(w);c+=vec3(hp*u_highpass*.12);
  vec3 localMin=min(original,min(n,min(so,min(e,w)))),localMax=max(original,max(n,max(so,max(e,w))));c=mix(c,clamp(c,localMin-.025,localMax+.025),u_dehalo);c=mix(c,clamp(c,localMin,localMax),u_antiring);
  c+=vec3(u_temperature*.08+u_tint*.025+u_lift,-u_tint*.05+u_lift,-u_temperature*.08+u_tint*.025+u_lift);c*=exp2(u_exposure);
  float tl=lum(c),sm=pow(clamp(1.-tl,0.,1.),2.),hm=pow(clamp(tl,0.,1.),2.);c+=vec3(u_shadows*sm*.28+u_highlights*hm*.24+u_blacks*(1.-smoothstep(.08,.38,tl))*.16+u_whites*smoothstep(.62,.94,tl)*.14);
  if(u_dehaze>0.){float hl=lum(c);c=(c-.5)*(1.+u_dehaze*.34)+.5;c=mix(vec3(hl),c,1.+u_dehaze*.18);}
  c=pow(clamp(c,0.,1.),vec3(1./max(.05,u_gamma)))*max(.05,u_gain);c=(c-.5)*u_contrast+.5+u_brightness;
  float l=lum(c);c=mix(vec3(l),c,u_saturation);float ch=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));c=mix(vec3(l),c,1.+u_vibrance*(1.-clamp(ch,0.,1.)));
  vec2 q=v_uv*2.-1.;c*=1.-smoothstep(.28,1.35,dot(q,q))*u_vignette*.58;c+=vec3((hash(pixel)-.5)*u_grain*.055);outColor=vec4(clamp(c,0.,1.),1.);
}`;
