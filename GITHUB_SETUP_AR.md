# تشغيل نسخة GitHub Lite

هذه النسخة تستبعد `public/vendor/` عمدًا لتجنب رفع ملفات FFmpeg/ONNX Runtime WASM الثقيلة إلى Git.

## البناء المحلي
1. Node.js 22 (أو >=20 حسب package.json).
2. `npm ci --no-audit --no-fund`
3. `npm run prepare:runtime`
4. `npm run verify:runtime`
5. `npm test`
6. `npm run check`
7. `npm run check:packaging`
8. `npm run build`

## Android APK
GitHub Action الموجود في `.github/workflows/android-build.yml` يثبت Node/dependencies، يعيد توليد runtime، يشغل الاختبارات والتدقيق، يثبت Android API 36 وJava 17 وGradle 8.11.1 ثم يبني APK ويرفعه كـArtifact.

> لا ترفع `public/vendor/` إلى GitHub؛ `.gitignore` يستبعده، و`prepare:runtime` يعيده من npm dependencies المقفلة في package-lock.
