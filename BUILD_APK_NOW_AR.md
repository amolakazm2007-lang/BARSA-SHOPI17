# بناء BARSA SHOPI v9.8.1 FINAL APK

1. ارفع محتويات نسخة GitHub Lite النهائية إلى المستودع.
2. Commit + Push إلى `main`.
3. افتح GitHub > Actions > **BARSA SHOPI Android APK** لبناء Debug، أو **BARSA SHOPI Android Release** لبناء Release.
4. الـWorkflow ينفذ: `npm ci` → تجهيز وفحص Runtime → الاختبارات → Source/Final Audit → Vite Build → Android Sync → Gradle Build.
5. Debug artifact: `BARSA-SHOPI-v9.8.1-debug`.
6. Release artifact: `BARSA-SHOPI-v9.8.1-release`. إذا مفاتيح التوقيع موجودة ينتج APK موقع؛ وإذا غير موجودة ينتج `UNSIGNED` بوضوح.

مهم: نجاح فحص Runtime شرط قبل بناء APK، ولا يتم قبول FFmpeg/ONNX assets ناقصة أو غير مطابقة.
