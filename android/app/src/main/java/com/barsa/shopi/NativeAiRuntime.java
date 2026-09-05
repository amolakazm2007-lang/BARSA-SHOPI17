package com.barsa.shopi;

import android.content.Context;
import android.os.Build;
import ai.onnxruntime.*;
import java.io.*;
import java.nio.*;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONObject;

/** Native ONNX Runtime backend. The ORT environment is deliberately lazy so
 * loading native inference libraries can never block Activity.onCreate(). */
public final class NativeAiRuntime implements AutoCloseable {
    public static final class InferenceResult {
        public final float[] data; public final int width; public final int height; public final int channels; public final String provider;
        InferenceResult(float[] data,int width,int height,int channels,String provider){this.data=data;this.width=width;this.height=height;this.channels=channels;this.provider=provider;}
    }
    private static final class InputSpec { final String name; final long[] shape; InputSpec(String name,long[] shape){this.name=name;this.shape=shape;} }
    private static final class SessionHolder implements AutoCloseable {
        final OrtSession session; final OrtSession.SessionOptions options; final String provider; final String imageInputName; final long[] imageInputShape; final List<InputSpec> auxiliaryInputs; private float[] concatScratch;
        SessionHolder(OrtSession session,OrtSession.SessionOptions options,String provider)throws OrtException{
            this.session=session;this.options=options;this.provider=provider;String selectedName=null;long[] selectedShape=null;List<InputSpec> auxiliary=new ArrayList<>();
            for(Map.Entry<String,NodeInfo> entry:session.getInputInfo().entrySet()){
                if(!(entry.getValue().getInfo() instanceof TensorInfo))continue;
                long[] shape=((TensorInfo)entry.getValue().getInfo()).getShape().clone();boolean imageLike=shape.length==4&&(shape[1]==3||shape[1]<=0);
                if(selectedName==null&&imageLike){selectedName=entry.getKey();selectedShape=shape;}else auxiliary.add(new InputSpec(entry.getKey(),shape));
            }
            if(selectedName==null)throw new IllegalStateException("Expected an NCHW image input tensor");
            imageInputName=selectedName;imageInputShape=selectedShape;auxiliaryInputs=Collections.unmodifiableList(auxiliary);
        }
        float[] concatScratch(int length){if(concatScratch==null||concatScratch.length<length)concatScratch=new float[length];return concatScratch;}
        @Override public void close(){concatScratch=null;try{session.close();}catch(Exception ignored){}try{options.close();}catch(Exception ignored){}}
    }

    private final Context context;
    private volatile OrtEnvironment environment;
    private final File modelDir;
    private final Map<String,SessionHolder> sessions=new ConcurrentHashMap<>();

    NativeAiRuntime(Context context){
        this.context=context.getApplicationContext();
        this.modelDir=new File(this.context.getCacheDir(),"barsa-native-models");
        if(!modelDir.exists())modelDir.mkdirs();
    }

    private OrtEnvironment environment(){
        OrtEnvironment current=environment;if(current!=null)return current;
        synchronized(this){current=environment;if(current==null){current=OrtEnvironment.getEnvironment();environment=current;}return current;}
    }

    public String capabilities(){
        try{JSONObject out=new JSONObject();out.put("available",true);out.put("runtime","onnxruntime-android");out.put("initialized",environment!=null);out.put("binaryTileApi",true);out.put("nativeFaceApi",true);out.put("nativeRifeApi",true);out.put("sdk",Build.VERSION.SDK_INT);out.put("nnapiEligible",Build.VERSION.SDK_INT>=29);out.put("processors",Runtime.getRuntime().availableProcessors());out.put("registeredModels",countRegisteredModels());return out.toString();}
        catch(Exception e){return "{\"available\":false}";}
    }

    public synchronized boolean registerModelFile(String modelId,File incoming,String sha256){
        if(incoming==null||!incoming.isFile()||incoming.length()<1024)return false;String safe=safeId(modelId);File target=new File(modelDir,safe+".onnx"),tmp=new File(modelDir,safe+".onnx.tmp");String requestedSha=sha256==null?"":sha256.trim(),expectedSha=normalizeSha256(sha256);if(!requestedSha.isEmpty()&&expectedSha.isEmpty())return false;
        try{if(tmp.exists())tmp.delete();copyFile(incoming,tmp);if(!expectedSha.isEmpty()&&!expectedSha.equalsIgnoreCase(sha256Hex(tmp))){tmp.delete();return false;}closeSession(safe);try{Files.move(tmp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}catch(Exception e){Files.move(tmp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);}if(target.isFile()&&target.length()>1024){writeFingerprint(safe,expectedSha,target.length());return true;}return false;}catch(Exception e){tmp.delete();return false;}
    }
    public boolean modelMatches(String modelId,long bytes,String sha256){String safe=safeId(modelId);File f=new File(modelDir,safe+".onnx");if(!f.isFile()||(bytes>0&&f.length()!=bytes))return false;Properties props=readFingerprint(safe);String stored=props.getProperty("sha256","");return sha256==null||sha256.trim().isEmpty()||sha256.equalsIgnoreCase(stored);}
    public boolean hasModel(String modelId){return modelFile(modelId).isFile();}
    public long modelBytes(String modelId){File f=modelFile(modelId);return f.isFile()?f.length():0;}
    public synchronized void deleteModel(String modelId){String safe=safeId(modelId);closeSession(safe);File f=new File(modelDir,safe+".onnx");if(f.exists())f.delete();File meta=new File(modelDir,safe+".properties");if(meta.exists())meta.delete();}

    public synchronized void releaseSessions(){
        List<SessionHolder> closing = new ArrayList<>(sessions.values());
        sessions.clear();
        for(SessionHolder holder:closing){synchronized(holder){holder.close();}}
    }

    public InferenceResult infer(String modelId,float[] input,int channels,int width,int height,int scale,float fidelity)throws Exception{
        if(channels<1||channels>4||width<1||height<1||scale<1||scale>8)throw new IllegalArgumentException("Invalid tensor geometry");long expected=(long)channels*width*height;if(input==null||input.length!=expected)throw new IllegalArgumentException("Input tensor length mismatch");fidelity=Math.max(0f,Math.min(1f,fidelity));String safeModelId=safeId(modelId);OrtEnvironment env=environment();
        for(;;){SessionHolder holder=getOrCreateSession(modelId);synchronized(holder){if (sessions.get(safeModelId) != holder) continue;int runC=channels,runH=height,runW=width;long[] shape=holder.imageInputShape;if(shape.length!=4)throw new IllegalStateException("Expected NCHW model input");if(shape[1]>0)runC=Math.toIntExact(shape[1]);if(shape[2]>0)runH=Math.toIntExact(shape[2]);if(shape[3]>0)runW=Math.toIntExact(shape[3]);if(runC!=channels)throw new IllegalStateException("Model channel count "+runC+" differs from requested "+channels);if(width>runW||height>runH)throw new IllegalStateException("Input exceeds fixed model input "+runW+"x"+runH);float[] prepared=(runW==width&&runH==height)?input:padChwEdge(input,channels,width,height,runW,runH);long[] runShape=new long[]{1,channels,runH,runW};Map<String,OnnxTensor> feeds=new LinkedHashMap<>();List<OnnxTensor> tensors=new ArrayList<>();
            try{OnnxTensor imageTensor=OnnxTensor.createTensor(env,FloatBuffer.wrap(prepared),runShape);tensors.add(imageTensor);feeds.put(holder.imageInputName,imageTensor);for(InputSpec auxiliary:holder.auxiliaryInputs){long[] auxShape=concreteAuxiliaryShape(auxiliary.shape);long countLong=elementCount(auxShape);if(countLong<1||countLong>4096)throw new IllegalStateException("Unsupported native auxiliary input size for "+auxiliary.name);float[] values=new float[(int)countLong];Arrays.fill(values,fidelity);OnnxTensor tensor=OnnxTensor.createTensor(env,FloatBuffer.wrap(values),auxShape);tensors.add(tensor);feeds.put(auxiliary.name,tensor);}try(OrtSession.Result result=holder.session.run(feeds)){OutputTensor imageOutput=selectImageOutput(result,channels);if(imageOutput==null)throw new IllegalStateException("ONNX inference produced no compatible float image output");int outW=imageOutput.width,outH=imageOutput.height,outC=imageOutput.channels;float[] output=imageOutput.data;if(runW!=width||runH!=height){int scaleX=outW/runW,scaleY=outH/runH;if(scaleX<1||scaleX!=scaleY||outW%runW!=0||outH%runH!=0)throw new IllegalStateException("Cannot crop padded native model output safely");output=cropChw(output,outC,outW,width*scaleX,height*scaleY);outW=width*scaleX;outH=height*scaleY;}if(scale>1&&(outW!=width*scale||outH!=height*scale))throw new IllegalStateException("Output scale mismatch: got "+outW+"x"+outH+", expected "+(width*scale)+"x"+(height*scale));return new InferenceResult(output,outW,outH,outC,holder.provider);}}
            finally{for(OnnxTensor tensor:tensors)try{tensor.close();}catch(Exception ignored){}}
        }}
    }

    public InferenceResult inferRife(String modelId,float[] frame0,float[] frame1,int width,int height,float timestep)throws Exception{
        if(width<1||height<1||width>1920||height>1080)throw new IllegalArgumentException("Native RIFE mobile surface exceeds 1080p");int plane=width*height,expected=3*plane;if(frame0==null||frame1==null||frame0.length!=expected||frame1.length!=expected)throw new IllegalArgumentException("RIFE input tensor mismatch");timestep=Math.max(0f,Math.min(1f,timestep));String safeModelId=safeId(modelId);OrtEnvironment env=environment();
        for(;;){SessionHolder holder=getOrCreateSession(modelId);synchronized(holder){if (sessions.get(safeModelId) != holder) continue;List<Map.Entry<String,TensorInfo>> imageInputs=new ArrayList<>(),auxInputs=new ArrayList<>();for(Map.Entry<String,NodeInfo> entry:holder.session.getInputInfo().entrySet()){if(!(entry.getValue().getInfo() instanceof TensorInfo))continue;TensorInfo ti=(TensorInfo)entry.getValue().getInfo();long[] sh=ti.getShape();if(sh.length==4&&(sh[1]==3||sh[1]==6||sh[1]<=0))imageInputs.add(new AbstractMap.SimpleEntry<>(entry.getKey(),ti));else auxInputs.add(new AbstractMap.SimpleEntry<>(entry.getKey(),ti));}if(imageInputs.isEmpty())throw new IllegalStateException("Unsupported native RIFE signature");long[] base=imageInputs.get(0).getValue().getShape();int runH=height,runW=width;if(base[2]>0)runH=Math.toIntExact(base[2]);if(base[3]>0)runW=Math.toIntExact(base[3]);if(width>runW||height>runH)throw new IllegalStateException("RIFE input exceeds fixed model surface");float[] a=(runW==width&&runH==height)?frame0:padChwEdge(frame0,3,width,height,runW,runH),b=(runW==width&&runH==height)?frame1:padChwEdge(frame1,3,width,height,runW,runH);Map<String,OnnxTensor> feeds=new LinkedHashMap<>();List<OnnxTensor> tensors=new ArrayList<>();
            try{boolean concat=imageInputs.get(0).getValue().getShape()[1]==6||imageInputs.size()==1;if(concat){int total=a.length+b.length;float[] both=holder.concatScratch(total);System.arraycopy(a,0,both,0,a.length);System.arraycopy(b,0,both,a.length,b.length);OnnxTensor t=OnnxTensor.createTensor(env,FloatBuffer.wrap(both,0,total),new long[]{1,6,runH,runW});tensors.add(t);feeds.put(imageInputs.get(0).getKey(),t);}else{OnnxTensor ta=OnnxTensor.createTensor(env,FloatBuffer.wrap(a),new long[]{1,3,runH,runW}),tb=OnnxTensor.createTensor(env,FloatBuffer.wrap(b),new long[]{1,3,runH,runW});tensors.add(ta);tensors.add(tb);feeds.put(imageInputs.get(0).getKey(),ta);feeds.put(imageInputs.get(1).getKey(),tb);}for(Map.Entry<String,TensorInfo> aux:auxInputs){long[] shape=concreteAuxiliaryShape(aux.getValue().getShape());long count=elementCount(shape);if(count<1||count>4096)throw new IllegalStateException("Unsupported RIFE auxiliary tensor");float v=aux.getKey().toLowerCase(Locale.ROOT).contains("scale")?1f:timestep;float[] vals=new float[(int)count];Arrays.fill(vals,v);OnnxTensor t=OnnxTensor.createTensor(env,FloatBuffer.wrap(vals),shape);tensors.add(t);feeds.put(aux.getKey(),t);}try(OrtSession.Result result=holder.session.run(feeds)){OutputTensor out=selectImageOutput(result,3);if(out==null)throw new IllegalStateException("RIFE produced no RGB output");float[] data=out.data;int outW=out.width,outH=out.height;if(runW!=width||runH!=height){data=cropChw(data,3,outW,width,height);outW=width;outH=height;}return new InferenceResult(data,outW,outH,3,holder.provider);}}
            finally{for(OnnxTensor t:tensors)try{t.close();}catch(Exception ignored){}}
        }}
    }

    private static final class OutputTensor{final float[] data;final int width,height,channels;OutputTensor(float[] data,int width,int height,int channels){this.data=data;this.width=width;this.height=height;this.channels=channels;}}
    private static OutputTensor selectImageOutput(OrtSession.Result result,int preferredChannels)throws OrtException{for(int index=0;index<result.size();index++){OnnxValue value=result.get(index);if(!(value instanceof OnnxTensor))continue;OnnxTensor tensor=(OnnxTensor)value;TensorInfo info=tensor.getInfo();long[] dims=info.getShape();if(dims.length!=4)continue;int c=safePositiveInt(dims[1]),h=safePositiveInt(dims[2]),w=safePositiveInt(dims[3]);if(c<1||h<1||w<1||(preferredChannels>0&&c!=preferredChannels))continue;FloatBuffer buffer=tensor.getFloatBuffer();if(buffer==null)continue;float[] output=new float[buffer.remaining()];buffer.get(output);if(output.length!=(long)c*h*w)continue;return new OutputTensor(output,w,h,c);}return null;}
    private static long[] concreteAuxiliaryShape(long[] source){if(source==null||source.length==0)return new long[]{1};long[] shape=source.clone();for(int i=0;i<shape.length;i++)if(shape[i]<=0)shape[i]=1;return shape;}
    private static long elementCount(long[] shape){long count=1;for(long value:shape){count*=value;if(count>4096)return count;}return count;}
    private static int safePositiveInt(long value){return value>0&&value<=Integer.MAX_VALUE?(int)value:0;}

    public String selfTestBundledSuperResolution(){File modelFile=null;try{OrtEnvironment env=environment();modelFile=copyAssetToCache("www/models/super-resolution-10.onnx","native-ai-selftest.onnx");try(OrtSession.SessionOptions options=new OrtSession.SessionOptions()){options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);String provider=tryEnableNnapi(options)?"nnapi/cpu-fallback":"cpu";try(OrtSession session=env.createSession(modelFile.getAbsolutePath(),options)){String inputName=session.getInputNames().iterator().next();NodeInfo nodeInfo=session.getInputInfo().get(inputName);if(!(nodeInfo.getInfo() instanceof TensorInfo))throw new IllegalStateException("Model input is not a tensor");TensorInfo info=(TensorInfo)nodeInfo.getInfo();long[] shape=info.getShape().clone();if(shape.length!=4)throw new IllegalStateException("Expected NCHW input");for(int i=0;i<shape.length;i++)if(shape[i]<=0)shape[i]=(i<2?1:32);long elementsLong=1;for(long v:shape)elementsLong*=v;if(elementsLong<=0||elementsLong>16_777_216L)throw new IllegalStateException("Unsafe self-test tensor size");int elements=(int)elementsLong;float[] input=new float[elements];Arrays.fill(input,0.5f);try(OnnxTensor tensor=OnnxTensor.createTensor(env,FloatBuffer.wrap(input),shape);OrtSession.Result result=session.run(Collections.singletonMap(inputName,tensor))){if(result.size()<1)throw new IllegalStateException("ONNX inference produced no outputs");JSONObject out=new JSONObject();out.put("passed",true);out.put("provider",provider);out.put("input",inputName);out.put("elements",elements);out.put("outputs",result.size());out.put("binaryTileApi",true);out.put("nativeFaceApi",true);out.put("nativeRifeApi",true);return out.toString();}}}}catch(Throwable error){try{JSONObject out=new JSONObject();out.put("passed",false);out.put("error",String.valueOf(error.getMessage()));return out.toString();}catch(Exception ignored){return "{\"passed\":false}";}}finally{if(modelFile!=null)modelFile.delete();}}

    private SessionHolder getOrCreateSession(String modelId)throws Exception{String safe=safeId(modelId);SessionHolder existing=sessions.get(safe);if(existing!=null)return existing;synchronized(this){existing=sessions.get(safe);if(existing!=null)return existing;File file=new File(modelDir,safe+".onnx");if(!file.isFile())throw new FileNotFoundException("Native model not registered: "+safe);OrtSession.SessionOptions options=new OrtSession.SessionOptions();options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);String provider=tryEnableNnapi(options)?"nnapi/cpu-fallback":"cpu";SessionHolder created;try{created=new SessionHolder(environment().createSession(file.getAbsolutePath(),options),options,provider);}catch(Throwable error){try{options.close();}catch(Exception ignored){}throw error;}sessions.put(safe,created);return created;}}
    private boolean tryEnableNnapi(OrtSession.SessionOptions options){if(Build.VERSION.SDK_INT<29)return false;try{options.addNnapi();return true;}catch(Throwable ignored){return false;}}
    private void closeSession(String safeId){SessionHolder h=sessions.remove(safeId);if(h!=null)synchronized(h){h.close();}}
    public void releaseSession(String modelId){closeSession(safeId(modelId));}
    private File modelFile(String modelId){return new File(modelDir,safeId(modelId)+".onnx");}
    private int countRegisteredModels(){File[] files=modelDir.listFiles((d,n)->n.endsWith(".onnx"));return files==null?0:files.length;}
    private static String safeId(String id){String safe=id==null?"model":id.replaceAll("[^A-Za-z0-9._-]","_");if(safe.length()>96)safe=safe.substring(0,96);return safe.trim().isEmpty()?"model":safe;}
    private void writeFingerprint(String safe,String sha256,long bytes){Properties props=new Properties();props.setProperty("sha256",sha256==null?"":sha256);props.setProperty("bytes",String.valueOf(bytes));try(OutputStream out=new FileOutputStream(new File(modelDir,safe+".properties"),false)){props.store(out,"BARSA native model fingerprint");}catch(Exception ignored){}}
    private Properties readFingerprint(String safe){Properties props=new Properties();File file=new File(modelDir,safe+".properties");if(!file.isFile())return props;try(InputStream in=new FileInputStream(file)){props.load(in);}catch(Exception ignored){}return props;}
    private static String normalizeSha256(String value){String sha=value==null?"":value.trim().toLowerCase(Locale.ROOT);return sha.matches("[0-9a-f]{64}")?sha:"";}
    private static String sha256Hex(File file)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new BufferedInputStream(new FileInputStream(file),1024*1024)){byte[] buffer=new byte[1024*1024];int n;while((n=in.read(buffer))>=0)if(n>0)digest.update(buffer,0,n);}StringBuilder out=new StringBuilder(64);for(byte b:digest.digest())out.append(String.format(Locale.ROOT,"%02x",b&0xff));return out.toString();}
    private static void copyFile(File src,File dst)throws IOException{try(InputStream in=new FileInputStream(src);OutputStream out=new FileOutputStream(dst,false)){byte[] buffer=new byte[1024*1024];int n;while((n=in.read(buffer))>=0)if(n>0)out.write(buffer,0,n);}}
    private static float[] padChwEdge(float[] src,int channels,int width,int height,int outW,int outH){float[] out=new float[channels*outW*outH];int srcPlane=width*height,outPlane=outW*outH;for(int c=0;c<channels;c++)for(int y=0;y<outH;y++){int sy=Math.min(height-1,y);for(int x=0;x<outW;x++){int sx=Math.min(width-1,x);out[c*outPlane+y*outW+x]=src[c*srcPlane+sy*width+sx];}}return out;}
    private static float[] cropChw(float[] src,int channels,int srcW,int outW,int outH){int srcH=src.length/channels/srcW,srcPlane=srcW*srcH,outPlane=outW*outH;float[] out=new float[channels*outPlane];for(int c=0;c<channels;c++)for(int y=0;y<outH;y++)System.arraycopy(src,c*srcPlane+y*srcW,out,c*outPlane+y*outW,outW);return out;}
    private File copyAssetToCache(String assetPath,String fileName)throws IOException{File out=new File(context.getCacheDir(),fileName);try(InputStream in=context.getAssets().open(assetPath);OutputStream stream=new FileOutputStream(out,false)){byte[] buffer=new byte[1024*1024];int n;while((n=in.read(buffer))>=0)if(n>0)stream.write(buffer,0,n);}return out;}
    @Override public synchronized void close(){releaseSessions();}
}
