package com.barsa.shopi;

import android.app.*;
import android.os.Build;
import android.os.Bundle;
import android.content.*;
import android.net.Uri;
import android.provider.Settings;
import android.webkit.*;
import android.view.*;
import android.graphics.Color;
import android.graphics.Insets;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.content.res.Configuration;
import java.io.IOException;
import java.util.UUID;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER = 9049;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private AssetServer assetServer;
    private NativeAiRuntime nativeAi;
    private NativeBridge nativeBridge;
    private long lastRendererCrashAt = 0L;
    private OnBackInvokedCallback backCallback;
    private String nativeApiToken;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        configureWindow();
        webView = new WebView(this); setContentView(webView); applyWindowInsets(webView);
        nativeAi = new NativeAiRuntime(this);
        nativeApiToken = UUID.randomUUID().toString().replace("-", "");
        nativeBridge = new NativeBridge(this, nativeAi, nativeApiToken);
        configureWebView();
        registerBackNavigation();
        try { assetServer = new AssetServer(getAssets(), nativeAi, getCacheDir(), nativeApiToken); loadApp(); }
        catch (IOException e) { webView.loadData("<h2>BARSA SHOPI runtime failed</h2>", "text/html", "UTF-8"); }
    }


    private void configureWindow() {
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
    }

    private void applyWindowInsets(WebView target) {
        target.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets system = windowInsets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = windowInsets.getInsets(WindowInsets.Type.ime());
                view.setPadding(system.left, system.top, system.right, Math.max(system.bottom, ime.bottom));
            } else {
                view.setPadding(windowInsets.getSystemWindowInsetLeft(), windowInsets.getSystemWindowInsetTop(),
                    windowInsets.getSystemWindowInsetRight(), windowInsets.getSystemWindowInsetBottom());
            }
            return windowInsets;
        });
        target.requestApplyInsets();
    }

    private void registerBackNavigation() {
        if (Build.VERSION.SDK_INT < 33) return;
        backCallback = () -> { if (webView != null && webView.canGoBack()) webView.goBack(); else finishAfterTransition(); };
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
    }

    private void unregisterBackNavigation() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback); backCallback = null;
        }
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(true); s.setMediaPlaybackRequiresUserGesture(false); s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setJavaScriptCanOpenWindowsAutomatically(false); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); s.setSupportZoom(false); s.setBuiltInZoomControls(false); s.setDisplayZoomControls(false);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);
        webView.setBackgroundColor(Color.rgb(2,4,11));
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
        }
        webView.addJavascriptInterface(nativeBridge, "BarsaAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isTrustedAppUri(uri)) return false;
                String scheme = uri == null ? null : uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                }
                return true;
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                recoverRenderer(detail != null && detail.didCrash());
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = callback;
                Intent intent = params.createIntent(); intent.addCategory(Intent.CATEGORY_OPENABLE);
                try { startActivityForResult(intent, FILE_CHOOSER); } catch (Exception e) { fileCallback=null; return false; }
                return true;
            }
        });
    }



    private boolean isTrustedAppUri(Uri uri) {
        if (uri == null || assetServer == null) return false;
        return "http".equalsIgnoreCase(uri.getScheme())
            && "127.0.0.1".equals(uri.getHost())
            && uri.getPort() == assetServer.port();
    }

    private void loadApp() {
        if (webView != null && assetServer != null) webView.loadUrl("http://127.0.0.1:" + assetServer.port() + "/index.html");
    }

    private void recoverRenderer(boolean crashed) {
        long now = android.os.SystemClock.elapsedRealtime();
        boolean repeated = now - lastRendererCrashAt < 10000L;
        lastRendererCrashAt = now;
        if (fileCallback != null) { try { fileCallback.onReceiveValue(null); } catch (Exception ignored) {} fileCallback = null; }
        if (nativeBridge != null) nativeBridge.cancelAllExports();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (webView != null) {
            try { webView.removeJavascriptInterface("BarsaAndroid"); } catch (Exception ignored) {}
            try { webView.destroy(); } catch (Exception ignored) {}
        }
        webView = new WebView(this); setContentView(webView); applyWindowInsets(webView); configureWebView();
        if (repeated && crashed) {
            webView.loadData("<html><body style='background:#02040b;color:white;font-family:sans-serif;padding:24px'><h2>BARSA SHOPI</h2><p>Android WebView stopped repeatedly. Close and reopen the app to restore the editing session.</p></body></html>", "text/html", "UTF-8");
        } else loadApp();
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data); if (request != FILE_CHOOSER || fileCallback == null) return;
        Uri[] resultUris = WebChromeClient.FileChooserParams.parseResult(result, data); fileCallback.onReceiveValue(resultUris); fileCallback = null;
    }

    @Override public void onBackPressed() { if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed(); }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) { webView.onResume(); webView.resumeTimers(); }
    }

    @Override protected void onPause() {
        if (webView != null) { webView.onPause(); webView.pauseTimers(); }
        super.onPause();
    }

    @Override public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (webView == null || level < TRIM_MEMORY_RUNNING_LOW) return;
        final int pressure = level;
        webView.post(() -> webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('barsa-memory-pressure',{detail:{level:" + pressure + "}}));", null));
    }

    @Override protected void onDestroy() {
        unregisterBackNavigation();
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback=null; }
        if (nativeBridge != null) nativeBridge.cancelAllExports();
        if (webView != null) { webView.removeJavascriptInterface("BarsaAndroid"); webView.destroy(); }
        if (assetServer != null) try { assetServer.close(); } catch (Exception ignored) {}
        if (nativeAi != null) try { nativeAi.close(); } catch (Exception ignored) {}
        super.onDestroy();
    }
}
