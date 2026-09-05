# BARSA SHOPI v10 RC15.1 — إصلاحات وتغليف

## الإصلاحات
- توحيد رقم الإصدار إلى `10.0.0-rc15.1` في package.json وpackage-lock وAndroid.
- تحديث Android إلى `versionCode 1001501` و`versionName 10.0.0-rc15.1`.
- تحديث أسماء APK/Artifacts في GitHub Actions إلى RC15.1 بدل الاسم القديم v9.8.1.
- إضافة `src/version.js` كمصدر مركزي لنسخة الويب وكاش مراحل الرندر.
- إضافة `scripts/check-packaging.mjs` لمنع رجوع تضارب الإصدارات.
- إضافة Packaging Audit إلى Android Debug/Release وGitHub Pages CI.
- تحديث اختبارات metadata القديمة وإضافة اختبار اتساق RC15.1 مستقل.

## التحقق المحلي
- Source audit: PASS.
- Runtime assets: PASS (7 ملفات FFmpeg/ORT بالحجم وSHA-256 المقفلين).
- Final audit: PASS.
- Packaging audit: PASS.
- JS/MJS syntax: PASS.
- Full node suite: 314 tests؛ 311 PASS و3 تتطلب dependencies لم تستطع بيئة التنفيذ تنزيلها بسبب network transport timeout: mediabunny وplaywright. هذه الحزم مثبتة ومقفلة أصلًا في package.json/package-lock ويقوم GitHub Actions بتثبيتها عبر npm ci.

## النسخ
- FULL: تحتوي public/vendor الجاهز (FFmpeg + ORT WASM)، لذلك حجمها أكبر وتستطيع تدقيق runtime بدون npm install.
- GITHUB LITE: نفس السورس والاختبارات والـAndroid والـworkflows، لكن تستبعد public/vendor والـlogs/screenshots الثقيلة. `npm ci` ثم `npm run prepare:runtime` يعيدان توليد runtime من النسخ المقفلة في package-lock.

## Quality Lock
لم يتم تخفيض دقة الإخراج أو FPS أو bitrate أو تغيير نماذج AI/خوارزميات الرندر كجزء من هذه الإصلاحات.
