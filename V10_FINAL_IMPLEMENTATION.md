# BARSA SHOPI v10.0.0 FINAL

Implemented release hardening:
- Android 16 / Java 17 shell with edge-to-edge cutout-safe rendering.
- IME visibility detection without double bottom padding; adjustResize remains authoritative.
- Low-RAM adaptive UI hint and reduced decorative GPU overdraw.
- Responsive Android-only mobile stylesheet and visualViewport sizing helper.
- Existing manual model selection, Apply Stack / Multi-Select, frame-ordered pipeline and independent Blur remain enabled.
- CI verifies exact npm dependency installation (including mediabunny), full JS tests, runtime/source/packaging gates, browser mobile tests, Android lint + unit tests, debug/release assembly, APK zipalign/signature/badging, hashes, and produces one ZIP containing installable APK + unsigned release APK + source + reports.

Deferred deliberately:
- A permanent production release signature requires a persistent private keystore stored in GitHub Secrets. The Actions bundle therefore provides the Gradle-signed installable debug APK plus an unsigned release APK ready for production signing.
- Native SurfaceView migration is architectural work and is not falsely claimed as implemented in this WebView build.
