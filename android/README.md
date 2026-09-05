# BARSA SHOPI Android Shell v4.9

This folder is the native Android shell for the existing Vite/AI engine. It deliberately does **not** duplicate the video engines.

## What is native
- Android WebView host with hardware acceleration.
- Local loopback asset server with COOP/COEP headers for cross-origin isolation where supported by the installed Android System WebView.
- System file picker through `WebChromeClient.onShowFileChooser`.
- Chunked MP4 bridge (256 KiB JS chunks) to avoid sending an entire render as one Base64 payload.
- MediaStore publish to `Movies/BARSA SHOPI`.
- Keep-screen-on during render and haptic completion feedback.

## Build
1. Install Android Studio / Android SDK 35 and JDK 21.
2. From project root run `npm ci`.
3. Run `npm run android:sync` to build the web runtime and copy `dist/` into Android assets.
4. Open `android/` in Android Studio and build `app`.

The browser build remains supported. The Android JS bridge is feature-detected at runtime.
