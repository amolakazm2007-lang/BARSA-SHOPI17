package com.barsa.shopi;

import android.content.res.AssetManager;
import java.io.*;
import java.net.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.security.MessageDigest;
import android.util.Log;

/** Localhost asset/runtime server. v6.5 also exposes a binary Native AI API. */
final class AssetServer implements Closeable {
    private static final String TAG = "BARSA.AssetServer";
    private static final String CSP = "default-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; media-src 'self' blob: data:; connect-src 'self' https: blob:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'";
    private static final long MAX_MODEL_BYTES = 512L * 1024 * 1024;
    private static final long MAX_TENSOR_BYTES = 64L * 1024 * 1024;
    private static final long MAX_NATIVE_OUTPUT_BYTES = 256L * 1024 * 1024;
    private final AssetManager assets;
    private final NativeAiRuntime nativeAi;
    private final File cacheDir;
    private final String nativeApiToken;
    private final ServerSocket server;
    private final ExecutorService pool = Executors.newFixedThreadPool(Math.max(2, Math.min(6, Runtime.getRuntime().availableProcessors())));
    private volatile boolean running = true;

    AssetServer(AssetManager assets, NativeAiRuntime nativeAi, File cacheDir, String nativeApiToken) throws IOException {
        this.assets = assets; this.nativeAi = nativeAi; this.cacheDir = cacheDir; this.nativeApiToken = nativeApiToken == null ? "" : nativeApiToken;
        this.server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        pool.execute(this::acceptLoop);
    }

    int port() { return server.getLocalPort(); }

    private void acceptLoop() {
        while (running) {
            try { Socket socket = server.accept(); socket.setSoTimeout(15000); pool.execute(() -> serve(socket)); }
            catch (IOException error) { if (!running) break; Log.w(TAG, "accept failed", error); }
        }
    }

    private void serve(Socket socket) {
        try (socket; BufferedInputStream in = new BufferedInputStream(socket.getInputStream(), 64 * 1024); OutputStream out = new BufferedOutputStream(socket.getOutputStream(), 64 * 1024)) {
            String request = readLine(in); if (request == null || request.trim().isEmpty()) return;
            String[] parts = request.split(" "); if (parts.length < 2) return;
            String method = parts[0].toUpperCase(Locale.ROOT), target = parts[1];
            Map<String,String> headers = new HashMap<>();
            String line; int headerCount = 0, headerBytes = 0;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                headerCount++; headerBytes += line.length();
                if (headerCount > 64 || headerBytes > 64 * 1024) { writeError(out, 431, "Request Header Fields Too Large"); return; }
                int p=line.indexOf(':'); if(p>0) headers.put(line.substring(0,p).trim().toLowerCase(Locale.ROOT), line.substring(p+1).trim());
            }
            socket.setSoTimeout(120000);
            if (target.startsWith("/native-ai/")) {
                if (!authorized(headers)) { writeError(out, 403, "Forbidden"); return; }
                serveNativeAi(method, target, headers, in, out); return;
            }
            if (!"GET".equals(method) && !"HEAD".equals(method)) { writeError(out, 405, "Method Not Allowed"); return; }
            serveAsset(target, "HEAD".equals(method), out);
        } catch (Exception error) { Log.e(TAG, "request failed", error); }
    }


    private boolean authorized(Map<String,String> headers) {
        String supplied = headers.getOrDefault("x-barsa-token", "");
        byte[] expected = nativeApiToken.getBytes(StandardCharsets.UTF_8);
        byte[] actual = supplied.getBytes(StandardCharsets.UTF_8);
        return expected.length >= 16 && MessageDigest.isEqual(expected, actual);
    }

    private void serveNativeAi(String method, String target, Map<String,String> headers, InputStream in, OutputStream out) throws Exception {
        URL url = new URL("http://127.0.0.1" + target);
        String path = url.getPath(); Map<String,String> query = parseQuery(url.getQuery());
        if ("GET".equals(method) && "/native-ai/status".equals(path)) {
            byte[] body = nativeAi.capabilities().getBytes(StandardCharsets.UTF_8); writeBytes(out, 200, "application/json", body, Collections.emptyMap()); return;
        }
        if ("GET".equals(method) && "/native-ai/model".equals(path)) {
            String id = required(query, "id"); long bytes = parseLong(query.get("bytes"), 0, MAX_MODEL_BYTES); String sha = query.getOrDefault("sha", "");
            boolean ready = nativeAi.modelMatches(id, bytes, sha); byte[] body = ("{\"ready\":" + ready + ",\"bytes\":" + nativeAi.modelBytes(id) + "}").getBytes(StandardCharsets.UTF_8); writeBytes(out,200,"application/json",body,Collections.emptyMap()); return;
        }
        if ("POST".equals(method) && "/native-ai/register".equals(path)) {
            long length = contentLength(headers, MAX_MODEL_BYTES); String id = query.getOrDefault("id", "model"); String sha = query.getOrDefault("sha", "");
            File tmp = File.createTempFile("barsa-model-", ".part", cacheDir);
            try (OutputStream fileOut = new BufferedOutputStream(new FileOutputStream(tmp), 1024 * 1024)) { copyExactly(in, fileOut, length); }
            boolean ok = nativeAi.registerModelFile(id, tmp, sha); tmp.delete();
            byte[] body = ("{\"registered\":" + ok + ",\"bytes\":" + nativeAi.modelBytes(id) + "}").getBytes(StandardCharsets.UTF_8); writeBytes(out, ok?200:400, "application/json", body, Collections.emptyMap()); return;
        }

        if ("POST".equals(method) && "/native-ai/rife".equals(path)) {
            long length = contentLength(headers, MAX_TENSOR_BYTES);
            String id = required(query, "id"); int w=parseInt(query,"w",1,1920), h=parseInt(query,"h",1,1080);
            long frameFloats = 3L*w*h, expected = frameFloats*2L*4L;
            if(length!=expected) { writeError(out,400,"RIFE tensor byte length mismatch"); return; }
            if(!nativeAi.hasModel(id)) { writeError(out,404,"Native RIFE model not registered"); return; }
            float[] a=readFloatArrayExactly(in, (int)frameFloats), b=readFloatArrayExactly(in, (int)frameFloats);
            float timestep=parseFloat(query.get("t"),0f,1f,0.5f);
            NativeAiRuntime.InferenceResult result = nativeAi.inferRife(id,a,b,w,h,timestep);
            Map<String,String> extra = new LinkedHashMap<>(); extra.put("X-Barsa-Width", String.valueOf(result.width)); extra.put("X-Barsa-Height", String.valueOf(result.height)); extra.put("X-Barsa-Channels", "3"); extra.put("X-Barsa-Provider", result.provider);
            writeFloatResponse(out,result.data,extra); return;
        }
        if ("POST".equals(method) && "/native-ai/infer".equals(path)) {
            long length = contentLength(headers, MAX_TENSOR_BYTES);
            String id = required(query, "id"); int c=parseInt(query,"c",1,4), w=parseInt(query,"w",1,4096), h=parseInt(query,"h",1,4096), scale=parseInt(query,"scale",1,8);
            long expected = (long)c*w*h*4L; if(length!=expected) { writeError(out,400,"Tensor byte length mismatch"); return; }
            long outputBytesUpperBound = (long)c*w*h*scale*scale*4L;
            if(outputBytesUpperBound<=0 || outputBytesUpperBound>MAX_NATIVE_OUTPUT_BYTES) { writeError(out,413,"Native output tensor would exceed mobile memory budget"); return; }
            if(!nativeAi.hasModel(id)) { writeError(out,404,"Native model not registered"); return; }
            float[] input = readFloatArrayExactly(in, (int)(length / 4L));
            float fidelity=parseFloat(query.get("fidelity"),0f,1f,0.5f);
            NativeAiRuntime.InferenceResult result = nativeAi.infer(id,input,c,w,h,scale,fidelity);
            long actualOutputBytes=(long)result.data.length*4L;if(actualOutputBytes<=0||actualOutputBytes>MAX_NATIVE_OUTPUT_BYTES){writeError(out,413,"Native output exceeded mobile memory budget");return;}
            Map<String,String> extra = new LinkedHashMap<>(); extra.put("X-Barsa-Width", String.valueOf(result.width)); extra.put("X-Barsa-Height", String.valueOf(result.height)); extra.put("X-Barsa-Channels", String.valueOf(result.channels)); extra.put("X-Barsa-Provider", result.provider);
            writeFloatResponse(out,result.data,extra); return;
        }
        if ("DELETE".equals(method) && "/native-ai/session".equals(path)) { String id=required(query,"id"); nativeAi.releaseSession(id); writeBytes(out,200,"application/json","{\"released\":true}".getBytes(StandardCharsets.UTF_8),Collections.emptyMap()); return; }
        if ("DELETE".equals(method) && "/native-ai/model".equals(path)) { String id=required(query,"id"); nativeAi.deleteModel(id); writeBytes(out,200,"application/json","{\"deleted\":true}".getBytes(StandardCharsets.UTF_8),Collections.emptyMap()); return; }
        writeError(out,404,"Native AI route not found");
    }

    private void serveAsset(String target, boolean head, OutputStream out) throws IOException {
        String rawPath = decodeUrl(target.split("\\?",2)[0]); String path=rawPath.equals("/")?"index.html":rawPath.replaceFirst("^/","");
        if(path.contains("..")){writeError(out,403,"Forbidden");return;} InputStream body; try{body=assets.open("www/"+path,AssetManager.ACCESS_STREAMING);}catch(IOException e){writeError(out,404,"Not Found");return;}
        try(body){String hs="HTTP/1.1 200 OK\r\nContent-Type: "+mime(path)+"\r\nTransfer-Encoding: chunked\r\nCache-Control: no-cache\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Embedder-Policy: require-corp\r\nCross-Origin-Resource-Policy: same-origin\r\nContent-Security-Policy: "+CSP+"\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nConnection: close\r\n\r\n";out.write(hs.getBytes(StandardCharsets.US_ASCII));if(!head){byte[] chunk=new byte[64*1024];int n;while((n=body.read(chunk))>=0){if(n==0)continue;out.write(Integer.toHexString(n).getBytes(StandardCharsets.US_ASCII));out.write("\r\n".getBytes(StandardCharsets.US_ASCII));out.write(chunk,0,n);out.write("\r\n".getBytes(StandardCharsets.US_ASCII));}}out.write("0\r\n\r\n".getBytes(StandardCharsets.US_ASCII));out.flush();}
    }

    private static String readLine(InputStream in) throws IOException { ByteArrayOutputStream b=new ByteArrayOutputStream(128); int prev=-1,v; while((v=in.read())!=-1){if(prev=='\r'&&v=='\n'){byte[] a=b.toByteArray();return new String(a,0,Math.max(0,a.length-1),StandardCharsets.US_ASCII);}b.write(v);prev=v;if(b.size()>16384)throw new IOException("Header line too long");}return b.size()==0?null:new String(b.toByteArray(),StandardCharsets.US_ASCII); }
    private static long contentLength(Map<String,String> headers,long max)throws IOException{String v=headers.get("content-length");if(v==null)throw new IOException("Content-Length required");long n=Long.parseLong(v);if(n<0||n>max)throw new IOException("Payload too large");return n;}
    private static void copyExactly(InputStream in,OutputStream out,long length)throws IOException{byte[] b=new byte[1024*1024];long left=length;while(left>0){int n=in.read(b,0,(int)Math.min(b.length,left));if(n<0)throw new EOFException();out.write(b,0,n);left-=n;}}
    private static float[] readFloatArrayExactly(InputStream in,int floatCount)throws IOException{
        if(floatCount<0)throw new IOException("Invalid float count");
        float[] out=new float[floatCount]; byte[] chunk=new byte[256*1024]; int pos=0;
        while(pos<floatCount){int floats=Math.min(chunk.length/4,floatCount-pos), bytes=floats*4, off=0;while(off<bytes){int n=in.read(chunk,off,bytes-off);if(n<0)throw new EOFException();off+=n;}FloatBuffer fb=ByteBuffer.wrap(chunk,0,bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer();fb.get(out,pos,floats);pos+=floats;}
        return out;
    }
    private static void writeFloatResponse(OutputStream out,float[] data,Map<String,String> extra)throws IOException{
        long contentLength=(long)data.length*4L;StringBuilder h=new StringBuilder("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: ").append(contentLength).append("\r\nCache-Control: no-store\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Embedder-Policy: require-corp\r\nCross-Origin-Resource-Policy: same-origin\r\nContent-Security-Policy: ").append(CSP).append("\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nAccess-Control-Expose-Headers: X-Barsa-Width, X-Barsa-Height, X-Barsa-Channels, X-Barsa-Provider\r\n");for(Map.Entry<String,String>e:extra.entrySet())h.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");h.append("Connection: close\r\n\r\n");out.write(h.toString().getBytes(StandardCharsets.US_ASCII));
        ByteBuffer buffer=ByteBuffer.allocate(256*1024).order(ByteOrder.LITTLE_ENDIAN);FloatBuffer floats=buffer.asFloatBuffer();int pos=0, capacity=floats.capacity();while(pos<data.length){int count=Math.min(capacity,data.length-pos);floats.clear();floats.put(data,pos,count);out.write(buffer.array(),0,count*4);pos+=count;}out.flush();
    }
    private static byte[] readExactly(InputStream in,int length)throws IOException{byte[] b=new byte[length];int p=0;while(p<length){int n=in.read(b,p,length-p);if(n<0)throw new EOFException();p+=n;}return b;}
    private static String decodeUrl(String value){ try{return URLDecoder.decode(value,"UTF-8");}catch(Exception ignored){return value;} }
    private static Map<String,String> parseQuery(String q){Map<String,String> m=new HashMap<>();if(q==null||q.trim().isEmpty())return m;for(String pair:q.split("&")){String[] p=pair.split("=",2);m.put(decodeUrl(p[0]),p.length>1?decodeUrl(p[1]):"");}return m;}
    private static long parseLong(String value,long min,long max)throws IOException{if(value==null||value.isEmpty())return min;long v=Long.parseLong(value);if(v<min||v>max)throw new IOException("Invalid number");return v;}
    private static String required(Map<String,String> q,String k)throws IOException{String v=q.get(k);if(v==null||v.trim().isEmpty())throw new IOException("Missing "+k);return v;}
    private static int parseInt(Map<String,String> q,String k,int min,int max)throws IOException{int v=Integer.parseInt(required(q,k));if(v<min||v>max)throw new IOException("Invalid "+k);return v;}
    private static float parseFloat(String value,float min,float max,float fallback)throws IOException{if(value==null||value.isEmpty())return fallback;float v=Float.parseFloat(value);if(!Float.isFinite(v)||v<min||v>max)throw new IOException("Invalid float");return v;}
    private static String mime(String path){String p=path.toLowerCase(Locale.ROOT);if(p.endsWith(".html"))return"text/html; charset=utf-8";if(p.endsWith(".js")||p.endsWith(".mjs"))return"text/javascript; charset=utf-8";if(p.endsWith(".css"))return"text/css; charset=utf-8";if(p.endsWith(".json"))return"application/json";if(p.endsWith(".wasm"))return"application/wasm";if(p.endsWith(".onnx"))return"application/octet-stream";if(p.endsWith(".mp4"))return"video/mp4";if(p.endsWith(".webm"))return"video/webm";if(p.endsWith(".svg"))return"image/svg+xml";if(p.endsWith(".png"))return"image/png";if(p.endsWith(".jpg")||p.endsWith(".jpeg"))return"image/jpeg";return"application/octet-stream";}
    private static void writeBytes(OutputStream out,int code,String type,byte[] body,Map<String,String> extra)throws IOException{String label=code==200?"OK":code==400?"Bad Request":code==403?"Forbidden":code==404?"Not Found":code==405?"Method Not Allowed":code==413?"Payload Too Large":code==431?"Request Header Fields Too Large":"Error";StringBuilder h=new StringBuilder("HTTP/1.1 ").append(code).append(' ').append(label).append("\r\nContent-Type: ").append(type).append("\r\nContent-Length: ").append(body.length).append("\r\nCache-Control: no-store\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Embedder-Policy: require-corp\r\nCross-Origin-Resource-Policy: same-origin\r\nContent-Security-Policy: ").append(CSP).append("\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nAccess-Control-Expose-Headers: X-Barsa-Width, X-Barsa-Height, X-Barsa-Channels, X-Barsa-Provider\r\n");for(Map.Entry<String,String>e:extra.entrySet())h.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");h.append("Connection: close\r\n\r\n");out.write(h.toString().getBytes(StandardCharsets.US_ASCII));out.write(body);out.flush();}
    private static void writeError(OutputStream out,int code,String label)throws IOException{writeBytes(out,code,"text/plain; charset=utf-8",label.getBytes(StandardCharsets.UTF_8),Collections.emptyMap());}
    @Override public void close() throws IOException { running=false;server.close();pool.shutdownNow(); }
}
