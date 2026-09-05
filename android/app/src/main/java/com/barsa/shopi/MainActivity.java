package com.barsa.shopi;

import android.app.*;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.content.*;
import android.net.Uri;
import android.webkit.*;
import android.view.*;
import android.graphics.Color;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import java.io.IOException;
import java.util.UUID;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER = 9049;
    private static final long STARTUP_WATCHDOG_MS = 8000L;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private AssetServer assetServer;
    private NativeAiRuntime nativeAi;
    private NativeBridge nativeBridge;
    private long lastRendererCrashAt = 0L;
    private OnBackInvokedCallback backCallback;
    private String nativeApiToken;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean firstFrameVisible = false;
    private boolean startupRecoveryUsed = false;
    private Runnable startupWatchdog;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        configureWindow();
        webView = new WebView(this); setContentView(webView); applyWindowInsets(webView);
        // NativeAiRuntime is intentionally lightweight at construction time. ORT
        // itself is lazy-loaded on the first real AI request, never during launch.
        nativeAi = new NativeAiRuntime(this);
        nativeApiToken = UUID.randomUUID().toString().replace("-", "");
        nativeBridge = new NativeBridge(this, nativeAi, nativeApiToken);
        configureWebView();
        registerBackNavigation();
        try { assetServer = new AssetServer(getAssets(), nativeAi, getCacheDir(), nativeApiToken); loadApp(); }
        catch (IOException e) { showNativeStartupError("Local runtime failed to start"); }
    }

    private void configureWindow() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
    }

    private void applyWindowInsets(WebView target) {
        ViewCompat.setOnApplyWindowInsetsListener(target, (view, insets) -> {
            Insets system = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            view.setPadding(system.left, system.top, system.right, system.bottom);
            int imeExtra = imeVisible ? Math.max(0, ime.bottom - system.bottom) : 0;
            target.post(() -> {
                if (target != webView) return;
                target.evaluateJavascript(
                    "(function(){var d=document.documentElement;if(!d)return;" +
                    "d.dataset.imeVisible='" + (imeVisible ? "1" : "0") + "';" +
                    "d.style.setProperty('--barsa-safe-left','" + system.left + "px');" +
                    "d.style.setProperty('--barsa-safe-top','" + system.top + "px');" +
                    "d.style.setProperty('--barsa-safe-right','" + system.right + "px');" +
                    "d.style.setProperty('--barsa-safe-bottom','" + system.bottom + "px');" +
                    "d.style.setProperty('--barsa-ime-bottom','" + imeExtra + "px');" +
                    "})();", null);
            });
            return insets;
        });
        ViewCompat.requestApplyInsets(target);
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
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(true); s.setMediaPlaybackRequiresUserGesture(false); s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100); s.setUseWideViewPort(true); s.setLoadWithOverviewMode(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); s.setSupportZoom(false); s.setBuiltInZoomControls(false); s.setDisplayZoomControls(false);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);
        webView.setBackgroundColor(Color.rgb(2,4,11));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER); webView.setVerticalScrollBarEnabled(false); webView.setHorizontalScrollBarEnabled(false);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
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
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                firstFrameVisible = false;
                if (assetServer != null && !isTrustedAppUri(Uri.parse(url))) {
                    try { view.removeJavascriptInterface("BarsaAndroid"); } catch (Exception ignored) {}
                }
            }
            @Override public void onPageCommitVisible(WebView view, String url) {
                super.onPageCommitVisible(view, url);
                if (!isTrustedAppUri(Uri.parse(url))) return;
                firstFrameVisible = true;
                cancelStartupWatchdog();
            }
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!isTrustedAppUri(Uri.parse(url))) return;
                view.addJavascriptInterface(nativeBridge, "BarsaAndroid");
                android.app.ActivityManager am = (android.app.ActivityManager) getSystemService(ACTIVITY_SERVICE);
                boolean lowRam = am != null && am.isLowRamDevice();
                // New installs start in explicit-model mode. A user can opt in later,
                // but boot/visibility/network hooks can never surprise-download AI.
                view.evaluateJavascript("(function(){try{if(localStorage.getItem('barsa.autoModels')!=='on')localStorage.setItem('barsa.autoModels','off');if(localStorage.getItem('barsa.autoFullModels')!=='on')localStorage.setItem('barsa.autoFullModels','off');}catch(e){}document.documentElement.dataset.lowRam='" + (lowRam ? "1" : "0") + "';document.documentElement.dataset.nativeBoot='ready';})();", null);
                view.evaluateJavascript("(function(){if(!document.getElementById('barsa-rc16-css')){var l=document.createElement('link');l.id='barsa-rc16-css';l.rel='stylesheet';l.href='/rc16-mobile.css';document.head.appendChild(l)}if(!document.getElementById('barsa-rc16-js')){var s=document.createElement('script');s.id='barsa-rc16-js';s.src='/rc16-mobile.js';s.defer=true;document.head.appendChild(s)}})();", null);
                ViewCompat.requestApplyInsets(view);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request != null && request.isForMainFrame() && isTrustedAppUri(request.getUrl()) && !startupRecoveryUsed) {
                    startupRecoveryUsed = true;
                    mainHandler.postDelayed(MainActivity.this::loadApp, 250L);
                }
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
        return "http".equalsIgnoreCase(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort() == assetServer.port();
    }

    private void loadApp() {
        if (webView == null || assetServer == null) return;
        armStartupWatchdog();
        webView.loadUrl("http://127.0.0.1:" + assetServer.port() + "/index.html");
    }

    private void armStartupWatchdog() {
        cancelStartupWatchdog();
        startupWatchdog = () -> {
            if (firstFrameVisible || webView == null || assetServer == null) return;
            if (!startupRecoveryUsed) {
                startupRecoveryUsed = true;
                webView.stopLoading();
                webView.loadUrl("http://127.0.0.1:" + assetServer.port() + "/index.html?startup-recovery=1");
            } else {
                showNativeStartupError("The local UI could not become responsive. Reopen the app after closing other heavy apps.");
            }
        };
        mainHandler.postDelayed(startupWatchdog, STARTUP_WATCHDOG_MS);
    }

    private void cancelStartupWatchdog() {
        if (startupWatchdog != null) mainHandler.removeCallbacks(startupWatchdog);
        startupWatchdog = null;
    }

    private void showNativeStartupError(String message) {
        cancelStartupWatchdog();
        if (webView == null) return;
        String safe = message == null ? "Startup failed" : message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
        webView.loadData("<html><body style='background:#02040b;color:white;font-family:sans-serif;padding:24px'><h2>BARSA SHOPI</h2><p>" + safe + "</p></body></html>", "text/html", "UTF-8");
    }

    private void recoverRenderer(boolean crashed) {
        cancelStartupWatchdog();
        long now = android.os.SystemClock.elapsedRealtime();
        boolean repeated = now - lastRendererCrashAt < 10000L;
        lastRendererCrashAt = now;
        if (fileCallback != null) { try { fileCallback.onReceiveValue(null); } catch (Exception ignored) {} fileCallback = null; }
        if (nativeBridge != null) nativeBridge.cancelAllExports();
        if (nativeAi != null) nativeAi.releaseSessions();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (webView != null) {
            try { webView.removeJavascriptInterface("BarsaAndroid"); } catch (Exception ignored) {}
            try { webView.destroy(); } catch (Exception ignored) {}
        }
        if (repeated && crashed) {
            webView = new WebView(this); setContentView(webView); applyWindowInsets(webView); configureWebView();
            showNativeStartupError("Android WebView stopped repeatedly. BARSA released AI memory to prevent a crash loop.");
            return;
        }
        webView = new WebView(this); setContentView(webView); applyWindowInsets(webView); configureWebView();
        mainHandler.postDelayed(this::loadApp, 180L);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data); if (request != FILE_CHOOSER || fileCallback == null) return;
        Uri[] resultUris = WebChromeClient.FileChooserParams.parseResult(result, data); fileCallback.onReceiveValue(resultUris); fileCallback = null;
    }

    @Override public void onBackPressed() { if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed(); }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) { webView.onResume(); webView.resumeTimers(); ViewCompat.requestApplyInsets(webView); }
    }

    @Override protected void onPause() {
        if (webView != null) { webView.onPause(); webView.pauseTimers(); }
        super.onPause();
    }

    @Override public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (nativeAi != null && level >= TRIM_MEMORY_RUNNING_LOW) nativeAi.releaseSessions();
        if (webView == null || level < TRIM_MEMORY_RUNNING_LOW) return;
        final int pressure = level;
        webView.post(() -> webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('barsa-memory-pressure',{detail:{level:" + pressure + "}}));", null));
    }

    @Override protected void onDestroy() {
        cancelStartupWatchdog();
        unregisterBackNavigation();
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback=null; }
        if (nativeBridge != null) nativeBridge.cancelAllExports();
        if (webView != null) { webView.removeJavascriptInterface("BarsaAndroid"); webView.destroy(); }
        if (assetServer != null) try { assetServer.close(); } catch (Exception ignored) {}
        if (nativeAi != null) try { nativeAi.close(); } catch (Exception ignored) {}
        super.onDestroy();
    }
}
