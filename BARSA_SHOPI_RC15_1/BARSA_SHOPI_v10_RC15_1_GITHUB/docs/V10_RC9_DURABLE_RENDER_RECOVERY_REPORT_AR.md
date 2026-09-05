# BARSA SHOPI v10 RC9 — Durable Render Recovery / Maximum Hardening

التاريخ: 2026-09-05

## الهدف
تقوية أخطر نقطة في الرندر الطويل: أن تكون نقطة الاستكمال مطابقة فعلياً للبايتات المثبتة على OPFS، وأن لا يعاد رندر الفيديو من الصفر إذا اكتمل ترميز الإطارات ثم حدث انهيار أثناء MP4/remux.

## الإصلاحات المنفذة
- تصحيح حد checkpoint ليعتمد عدد الإطارات المكتوبة فعلياً، وليس zero-based frameIndex؛ لم يعد أول إطار يجبر flush غير مقصود.
- ElementaryVideoWriter يستأنف من `framesWritten` المثبتة فقط، ولا يثق بعداد live encoded frames.
- فصل `liveEncodedFrames` عن عداد الاستكمال durable لمنع تقدم Resume على التخزين الحقيقي.
- تمرير `renderPlan.checkpointEvery` مباشرة إلى writer لتوحيد cadence بين خطة الحمل وOPFS durability.
- إضافة `stageResumeMetadata(frameNumber, metadata)` قبل إرسال الإطار للـencoder؛ metadata الخاصة بالمصدر/timestamp لا تُثبت إلا عندما تصبح الحزمة المقابلة durable في OPFS.
- StorageManager يكتب `durableEncodedFrames` مع bytes/frames في نفس checkpoint boundary.
- إضافة حالة `remux_pending`: بعد اكتمال elementary stream يتم إغلاقه وتثبيته، لكن لا تُعتبر الجلسة Completed قبل نجاح mux + validation.
- `findResumableSession()` يتعرف على `remux_pending` بالإضافة إلى `in_progress`.
- إضافة `getSessionFile()` لاستعادة elementary stream المكتمل بدون فتح writer جديد.
- إضافة مسار `recoverPendingRemux()` في VideoPipeline: يعيد تكوين MP4/WebM من elementary stream + المصدر المخزن بدون إعادة AI/frames.
- التحقق من حجم elementary stream مقابل bytesWritten قبل remux recovery.
- لا تُحذف جلسة Resume إلا بعد نجاح export validation وtrack validation.
- واجهة Restore تقبل `remux_pending` وتوضح أن الاستعادة تكمل MP4 بدون إعادة الرندر.
- تحديث اختبار v9.8 القديم ليعكس قاعدة durability الصحيحة بدل الاعتماد على `encodedFrames` غير المضمون.

## الاختبارات
- v10 critical suite: 67/67 PASS.
- 100 دورة ضغط مركزة على Resume / Render fast-path / Performance / Android memory / Thermal / A-V / FFmpeg: 100/100 PASS.
- Full suite: 250/253 PASS.
- الثلاثة غير القابلة للتشغيل محلياً هي نفس اختبارات البيئة المعروفة بسبب packages غير المثبتة بالكامل: mediabunny وplaywright.
- Source policy: PASS.
- Runtime assets: 7/7 SHA-256 + size PASS.
- Final audit: PASS.
- JS/MJS syntax: 155/155 PASS.

## الحالة
هذه أقوى نسخة Source مرشحة حالياً في المشروع، لكنها ليست Final APK. لا يتم إطلاق Final APK قبل build حقيقي ناجح مع npm dependencies كاملة وAndroid lint/unit/build وapksigner واختبار تشغيل فعلي.
