package com.barsa.shopi;

import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import android.database.Cursor;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.view.WindowManager;
import java.io.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONObject;

public final class NativeBridge {
    private static final long MAX_EXPORT_BYTES = 32L * 1024 * 1024 * 1024;

    private static final class ExportSession {
        final ContentResolver resolver; final Uri uri; final String name; final String mime; final long sourceDateMs; final long expectedBytes;
        final BufferedOutputStream stream;
        int sequence = 0; long writtenBytes = 0; boolean closed = false; boolean failed = false;
        ExportSession(ContentResolver resolver, Uri uri, String name, String mime, long sourceDateMs, long expectedBytes) throws IOException {
            this.resolver=resolver; this.uri=uri; this.name=name; this.mime=mime; this.sourceDateMs=sourceDateMs; this.expectedBytes=expectedBytes;
            OutputStream raw = resolver.openOutputStream(uri, "w");
            if (raw == null) throw new IOException("MediaStore output failed");
            this.stream = new BufferedOutputStream(raw, 1024 * 1024);
        }
        synchronized boolean append(byte[] bytes, int requestedSequence) {
            if (closed || failed || requestedSequence != sequence || bytes == null || bytes.length == 0 || writtenBytes + bytes.length > expectedBytes) return false;
            try { stream.write(bytes); writtenBytes += bytes.length; sequence++; return true; }
            catch (IOException error) { failed = true; return false; }
        }
        synchronized boolean finishWriting() {
            if (closed) return !failed && writtenBytes == expectedBytes;
            try { stream.flush(); stream.close(); closed = true; return !failed && writtenBytes == expectedBytes; }
            catch (IOException error) { failed = true; closed = true; try { stream.close(); } catch (Exception ignored) {} return false; }
        }
        synchronized void abort() {
            if (!closed) { try { stream.close(); } catch (Exception ignored) {} closed = true; }
            try { resolver.delete(uri, null, null); } catch (Exception ignored) {}
        }
    }
    private final MainActivity activity;
    private final NativeAiRuntime nativeAi;
    private final String nativeApiToken;
    private final Map<String,ExportSession> exports = new ConcurrentHashMap<>();

    NativeBridge(MainActivity activity, NativeAiRuntime nativeAi, String nativeApiToken) {
        this.activity = activity; this.nativeAi = nativeAi; this.nativeApiToken = nativeApiToken == null ? "" : nativeApiToken;
        Thread cleanup = new Thread(this::cleanupStalePendingExports, "barsa-export-cleanup");
        cleanup.setDaemon(true); cleanup.start();
    }

    @JavascriptInterface public String getDeviceInfo() {
        try {
            JSONObject json = new JSONObject();
            json.put("manufacturer", Build.MANUFACTURER); json.put("model", Build.MODEL); json.put("device", Build.DEVICE);
            json.put("sdk", Build.VERSION.SDK_INT); json.put("cores", Runtime.getRuntime().availableProcessors());
            json.put("maxHeapBytes", Runtime.getRuntime().maxMemory()); json.put("nativeShell", true);
            return json.toString();
        } catch (Exception e) { return "{}"; }
    }

    @JavascriptInterface public String getNativeAiInfo() { return nativeAi.capabilities(); }

    @JavascriptInterface public String getNativeAiToken() { return nativeApiToken; }

    @JavascriptInterface public String getThermalInfo() {
        try {
            JSONObject json = new JSONObject();
            PowerManager pm = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
            int status = Build.VERSION.SDK_INT >= 29 && pm != null ? pm.getCurrentThermalStatus() : -1;
            json.put("status", status);
            json.put("supported", Build.VERSION.SDK_INT >= 29 && pm != null);
            if (Build.VERSION.SDK_INT >= 30 && pm != null) {
                float headroom = pm.getThermalHeadroom(10);
                json.put("headroom", Float.isNaN(headroom) ? JSONObject.NULL : headroom);
            }
            return json.toString();
        } catch (Exception e) { return "{}"; }
    }

    @JavascriptInterface public String runNativeAiSelfTest() { return nativeAi.selfTestBundledSuperResolution(); }

    @JavascriptInterface public void releaseNativeAiMemory() { nativeAi.releaseSessions(); }

    @JavascriptInterface public void setKeepScreenOn(boolean enabled) {
        activity.runOnUiThread(() -> { if (enabled) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); });
    }

    @JavascriptInterface public void vibrate(int milliseconds) {
        Vibrator vibrator = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null) return;
        long ms = Math.max(1, Math.min(500, milliseconds));
        if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)); else vibrator.vibrate(ms);
    }

    @JavascriptInterface public String beginExport(String fileName, String mime, String totalBytes, String sourceDateMs) {
        Uri uri = null;
        try {
            long expected = 0; try { expected = Long.parseLong(totalBytes == null ? "0" : totalBytes); } catch (Exception ignored) {}
            if (expected <= 0 || expected > MAX_EXPORT_BYTES) return "";
            long date = 0; try { date = Long.parseLong(sourceDateMs == null ? "0" : sourceDateMs); } catch (Exception ignored) {}
            String name = safeName(fileName), type = safeMime(mime);
            ContentResolver resolver = activity.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Video.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Video.Media.MIME_TYPE, type);
            values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/BARSA SHOPI");
            if (date > 0) { long seconds = date / 1000L; values.put(MediaStore.Video.Media.DATE_ADDED, seconds); values.put(MediaStore.Video.Media.DATE_MODIFIED, seconds); }
            values.put(MediaStore.Video.Media.IS_PENDING, 1);
            uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return "";
            String id = UUID.randomUUID().toString();
            exports.put(id, new ExportSession(resolver, uri, name, type, Math.max(0, date), expected));
            return id;
        } catch (Exception e) {
            if (uri != null) try { activity.getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
            return "";
        }
    }

    @JavascriptInterface public boolean appendExportChunk(String id, String base64, int sequence) {
        ExportSession session = exports.get(id); if (session == null || base64 == null) return false;
        try { return session.append(Base64.decode(base64, Base64.DEFAULT), sequence); }
        catch (Exception error) { return false; }
    }

    @JavascriptInterface public String finishExport(String id) {
        ExportSession session = exports.remove(id); if (session == null) return "";
        if (!session.finishWriting()) { session.abort(); return ""; }
        try {
            long actualBytes = mediaStoreSize(session.resolver, session.uri);
            if (actualBytes != session.expectedBytes) throw new IOException("MediaStore byte count mismatch");
            ContentValues ready = new ContentValues(); ready.put(MediaStore.Video.Media.IS_PENDING, 0);
            int updated = session.resolver.update(session.uri, ready, null, null);
            if (updated <= 0) throw new IOException("MediaStore publish failed");
            return session.uri.toString();
        } catch (Exception e) { session.abort(); return ""; }
    }

    @JavascriptInterface public void cancelExport(String id) { ExportSession session=exports.remove(id); if (session!=null) session.abort(); }

    void cancelAllExports() {
        for (ExportSession session : exports.values()) try { session.abort(); } catch (Exception ignored) {}
        exports.clear();
    }

    private static long mediaStoreSize(ContentResolver resolver, Uri uri) {
        String[] projection = { MediaStore.MediaColumns.SIZE };
        try (Cursor cursor = resolver.query(uri, projection, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) return -1L;
            int column = cursor.getColumnIndex(MediaStore.MediaColumns.SIZE);
            return column >= 0 && !cursor.isNull(column) ? cursor.getLong(column) : -1L;
        } catch (Exception ignored) { return -1L; }
    }

    private void cleanupStalePendingExports() {
        ContentResolver resolver = activity.getContentResolver();
        String relative = Environment.DIRECTORY_MOVIES + "/BARSA SHOPI/";
        String[] projection = { MediaStore.Video.Media._ID };
        String selection = MediaStore.Video.Media.RELATIVE_PATH + "=? AND " + MediaStore.Video.Media.IS_PENDING + "=1 AND " + MediaStore.MediaColumns.OWNER_PACKAGE_NAME + "=?";
        String[] args = { relative, activity.getPackageName() };
        try (Cursor cursor = resolver.query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, projection, selection, args, null)) {
            if (cursor == null) return;
            int idColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID);
            while (cursor.moveToNext()) {
                Uri uri = Uri.withAppendedPath(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, String.valueOf(cursor.getLong(idColumn)));
                try { resolver.delete(uri, null, null); } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
    }

    private static String safeMime(String mime) {
        String value = mime == null ? "video/mp4" : mime.trim().toLowerCase(Locale.ROOT);
        return "video/mp4".equals(value) ? value : "video/mp4";
    }

    private static String safeName(String name) {
        String value = name == null ? "BARSA_EXPORT.mp4" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (!value.toLowerCase(Locale.ROOT).endsWith(".mp4")) value += ".mp4";
        return value.trim().isEmpty() ? "BARSA_EXPORT.mp4" : value;
    }
}
