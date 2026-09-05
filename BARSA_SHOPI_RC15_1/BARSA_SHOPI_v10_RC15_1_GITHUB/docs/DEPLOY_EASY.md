# Deployment

## Build

```bash
npm ci
npm run build
```

انشر محتوى `dist/` فقط على استضافة ثابتة تدعم HTTPS.

## Required headers

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

هذه الرؤوس تسمح بـSharedArrayBuffer وتشغّل FFmpeg متعدد الخيوط وONNX WASM متعدد الخيوط. بدونها يعمل التطبيق محليًا بمسارات أحادية الخيط.

مثال Netlify/Cloudflare Pages:

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  X-Content-Type-Options: nosniff
```

## Static assets

لا تستبعد `vendor/ffmpeg-core` أو `vendor/ffmpeg-core-mt` من `dist`. ملفات ONNX Runtime WASM تُصدر بأسماء hashed داخل `dist/assets`.

## Models

يمكن للمستخدم تنزيل نماذج رفع الدقة المدققة اختيارياً أو استيراد ONNX يدوياً. محركات FFmpeg وONNX Runtime نفسها تبقى أصولاً محلية ولا تعتمد على CDN runtime في الإنتاج.

## Privacy

الاستضافة تقدم app shell وأصول WASM فقط. الفيديو والصوت والموديلات المستوردة تبقى داخل جهاز المستخدم في OPFS ولا تُرسل للاستضافة.
