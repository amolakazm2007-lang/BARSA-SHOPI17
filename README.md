# Video Toolkit Pro

Current engine status: see [`docs/ENGINE_COMPLETION_REPORT.md`](docs/ENGINE_COMPLETION_REPORT.md).

الإصدار الحالي: **4.6 — YuNet Face Detection & Verified Tracks**.

تطبيق معالجة فيديو خاص يعمل داخل المتصفح. لا يرفع الفيديو أو الإطارات أو الصوت إلى API أو خادم معالجة. يستخدم WebGPU للتأثيرات، WebCodecs للترميز/فك ترميز المقاطع الخام، ONNX Runtime Web للاستدلال، OPFS وIndexedDB للحفظ المرحلي، وMediabunny/FFmpeg WASM لإخراج MP4 والصوت والتوافق.

واجهة الإصدار 4.6 تستخدم هوية داكنة مستوحاة من ألوان برشلونة: كحلي، أزرق، خمري،
أحمر ولمسات ذهبية، بدون شعار رسمي. المسار الظاهر للمستخدم بسيط: استيراد، اختيار
الدقة والشكل، معاينة حقيقية، ثم تصدير MP4.

## الدقات ونسب الأبعاد

- 720p، 1080p، 1440p، 4K و8K، حيث يشير الاسم إلى الضلع القصير حتى يعمل بصورة صحيحة أفقياً وعمودياً.
- 16:9، 9:16، 1:1، 4:5، 3:4، 4:3 و21:9.
- عرض وارتفاع مخصصان حتى 8192 بكسل لكل ضلع، مع تحويلهما إلى أرقام زوجية متوافقة مع H.264.
- احتواء بدون قص، ملء مع قص مركزي، أو تمديد صريح.
- المعاينة وCanvas/WebCodecs وFFmpeg تستخدم حساب Geometry واحداً، لذلك لا تختلف النتيجة النهائية عن اختيار الأبعاد في الواجهة.
- مساحة ONNX الوسيطة محدودة تلقائياً لمنع إنشاء Canvas ‏12K عند معالجة 4K→8K.

## التشغيل

المتطلبات: Node.js 20+ ومتصفح Chromium حديث.

```bash
npm install
npm run dev
```

لإنشاء نسخة إنتاجية ثابتة:

```bash
npm run build
npm run preview
```

على POCO F6 يتعرّف التطبيق إلى رمز الجهاز تلقائياً عندما يتيحه Chrome، ويفعّل
`POCO F6 · Turbo`: WebGPU عالي الأداء، بلاطات 384px ودفعتان مع مراقبة الضغط
والحرارة بصورة غير مباشرة. يمكن اختيار الوضع يدوياً إذا أخفى المتصفح اسم الجهاز.

نافذة **قدرات الجهاز** تعرض قبول H.264 عند 1080p60 و4K30 و4K60، وتحتوي مجموعة
اختبارات تشغيل فعلية لـWebGPU وH.264 وAAC وOPFS، إضافة إلى ترميز 4K60 قصير عندما
يعلن المتصفح دعمه. عبارة “hardware requested” دقيقة: يطلب التطبيق
`prefer-hardware`، لكن معيار WebCodecs لا يسمح للصفحة بإجبار Chrome أو إثبات
المشفّر الفيزيائي لأسباب التوافق والخصوصية.

الملفات الناتجة في `dist/` وتضم FFmpeg core وONNX Runtime WASM محليًا. لا تعتمد النسخة المبنية على CDN.

## رؤوس النشر الضرورية

فعّل هذين الرأسين للحصول على SharedArrayBuffer وFFmpeg متعدد الخيوط:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

WebGPU وOPFS يحتاجان HTTPS، أو `localhost` أثناء التطوير. يحتوي `vite.config.js` على الرؤوس في dev وpreview.
عند النشر على GitHub Pages يضيف Service Worker الرؤوس للعناصر المحلية بعد إعادة
تحميل واحدة، ما يتيح `SharedArrayBuffer` وFFmpeg متعدد الخيوط حيث يسمح Chrome.

## GitHub

المستودع مجهز بـGitHub Actions داخل `.github/workflows/ci-pages.yml`. كل Push إلى
`main` يشغّل فحص المصدر والاختبارات وبناء Vite واختبار Chromium، ثم ينشر `dist/`
إلى GitHub Pages. فعّل Pages على **GitHub Actions** من إعدادات المستودع أول مرة.

## موديلات AI

تتضمن الحزمة نموذج ONNX Model Zoo Super Resolution ×3 الخفيف والمدقق (نحو 240KB)، ويمكن تثبيته محلياً في OPFS بنقرة واحدة وإجراء اختبار inference حقيقي. أما النماذج الكبيرة فتبقى استيراداً يدوياً:

- ONNX Model Zoo Super Resolution ×3 كخيار سريع ومضمن للهاتف.
- Qualcomm Real-ESRGAN x4plus (نحو 67MB) كخيار جودة أعلى، مع مصدر وبصمة معلنين في الواجهة.
- RIFE لنمذجة الإطارات الوسيطة.
- GFPGAN 1.4 أو CodeFormer لاستعادة الوجوه.
- OpenCV YuNet الرسمي ككاشف وجه ONNX خفيف (233KB) مع تنزيل اختياري مدقق، SHA-256 وself-test؛ يعمل تلقائياً قبل GFPGAN/CodeFormer ويستعمل نقاط العين لمحاذاة الوجه المائل عند تثبيته.

يقبل التنزيل التلقائي عناوين HTTPS المدققة فقط، ويعرض تقدمه، ويكتب الملف إلى OPFS، ويحسب SHA-256 تدريجياً بدون الاحتفاظ بنسخة ثانية كاملة في RAM، ثم يجري اختبار inference حقيقي. لا يُفعّل المفتاح قبل نجاح الاختبار. يبقى الاستيراد اليدوي متاحاً لـReal-ESRGAN وRIFE وGFPGAN/CodeFormer وملفات ONNX الأخرى.

يدعم محرك RIFE الآن مدخلين RGB أو مدخلاً واحداً من ست قنوات، إضافة إلى مدخلات timestep وscale الشائعة، ويستخدم timestep مباشرة عندما يوفره النموذج. يدعم Face Restoration نماذج GFPGAN ذات مدخل الصورة ونماذج CodeFormer التي تضيف fidelity weight، ويرفض أي signature غير معروف بدل إنتاج نتيجة خاطئة بصمت.

توجد أيضاً خزنة Nihui/NCNN تستورد زوج `.param + .bin` وتفحص بنية `param` وتحفظ الحزمة في OPFS. هذه الحزم native NCNN/Vulkan ولا تُشغّل مباشرة داخل صفحة ويب؛ للتنفيذ الحالي استخدم نسخة ONNX متوافقة واجعل الاختبار الذاتي يمر. راجع `docs/FILTERS_AND_RENDER_REPORT.md` للتفاصيل الكاملة.

## فلاتر Pro Tone والمعالجة الزمنية

إضافة إلى sharpen/detail/high-pass/denoise/portrait/color، يتضمن التطبيق Exposure، Highlights، Shadows، Whites، Blacks، Dehaze، Vignette، وFilm Grain. أضيف Temporal Denoise واعٍ للحركة وAnti-Flicker مع إيقاف المزج عند قطع المشهد. يحتفظ المحرك بسجل مصغّر محدود إلى نحو 1080p حتى عند إدخال 4K/8K. المعاينة الحية تستخدم WebGL2 مباشرة وتعود إلى Canvas2D عند الحاجة؛ الرندر يستخدم WebGPU/WebGL2 وبدائل FFmpeg المناسبة.

## البنية

| الوحدة | المسؤولية |
| --- | --- |
| `StorageManager` | OPFS streams، cache للمصدر/الإطارات/النتيجة، checkpoints في IndexedDB، واستعادة الجلسة |
| `PerformanceManager` | FPS وRAM وذاكرة GPU المخصصة وحجم tile/batch التكيفي |
| `WebCodecsEngine` | VideoDecoder/VideoEncoder وAudioDecoder/AudioEncoder مع backpressure وإغلاق الموارد |
| `FrameSequencer` | PTS بالمايكروثانية وتحويل المعدل وإدراج إطارات RIFE |
| `TileProcessor` | تقسيم متداخل ودمج موزون بدون مصفوفة float بحجم إطار 8K |
| `WebGPUEngine` | WGSL color grade/vibrance/unsharp/high-pass/denoise مع destroy صريح |
| `WebGL2Engine` | مسار GPU احتياطي سريع للهواتف عند غياب WebGPU أو فقدان الجهاز |
| `RealtimePreviewEngine` | معاينة بكسلات حقيقية قبل الرندر مع مقارنة قبل/بعد |
| `AutoFixEngine` | تحليل الإضاءة والضوضاء والتفاصيل وتطبيق إصلاح متوازن |
| `RenderEstimator` | تقدير الوقت قبل الرندر وETA حي أثناء التنفيذ |
| `WebMMuxer` | تغليف IVF إلى WebM بدون نسخ الإطارات إلى RAM للفيديو الصامت |
| `MediaInputEngine` | demux للحاوية وقراءة PTS/VFR والدوران ثم decode متسلسل عبر WebCodecs |
| `SceneChangeDetector` | حماية RIFE من مزج مشهدين مختلفين عند القطع |
| `TemporalConsistencyEngine` | إزالة ضوضاء زمنية ومنع وميض مع motion gate وسجل ذاكرة محدود |
| `GeometryEngine` | كل نسب الأبعاد والمقاسات المخصصة وcontain/cover/stretch لمنع التشويه |
| `NativeMP4Muxer` | بث H.264 وAAC مباشرة إلى MP4 Fast Start داخل OPFS عندما يدعم المتصفح الترميزين |
| `ExportValidator` | فحص ISO-BMFF ثم تشغيل metadata فعلي للتأكد من الأبعاد والمدة |
| `QualityMetricsEngine` | تدقيق عينات الإخراج لرصد clipping والسطوع والحدة الزائدة بذاكرة ثابتة |
| `ModelManager` | تنزيل/استيراد ONNX من مصادر مدققة، والتحقق والتخزين المحلي |
| `UpscaleEngine` | Super-resolution tile inference |
| `RIFEEngine` | midpoint وx4 وinterpolation تقريبي لأي timestamp |
| `FaceRestorationEngine` | اكتشاف ROI واستعادة الوجه ودمج strength |
| `FaceDetectorEngine` | YuNet ONNX متعدد المقاييس، NMS وخمس نقاط وجه مع fallback للكاشف المحلي |
| `AudioEngine` | تنظيف صوت متدفق، resampling/noise gate/normalization وFFmpeg fallback |
| `FFmpegEngine` | remux وaudio merge وfallback transcode محلي |
| `EngineManager` | دورة jobs: start/pause/resume/cancel/progress/restore |
| `VideoPipeline` | ربط الإطارات والتأثيرات وAI والترميز والـremux |

## الذاكرة والمتانة

- يُنسخ المصدر إلى OPFS في بداية job.
- تذهب encoded chunks مباشرة إلى OPFS بدل تجميعها في RAM.
- يثبت checkpoint دوري بعد flush فعلي للـwritable stream.
- يعمل AI tile-by-tile، ويتكيف الحجم عند ضغط الذاكرة.
- تُغلق VideoFrame/AudioData، وتُدمّر GPUTexture/GPUBuffer، وتُحذف ملفات FFmpeg MEMFS المؤقتة.
- يفحص التطبيق المساحة المطلوبة قبل الرندر ويكتب MP4 المباشر كتابة موضعية إلى OPFS بدل حجز الحاوية كاملة في RAM.
- يمنع Wake Lock إطفاء الشاشة أثناء الرندر الطويل عندما يدعم الجهاز ذلك.
- المتصفح لا يكشف VRAM الفعلي لأسباب الخصوصية؛ الواجهة تعرض bytes التي خصصها التطبيق وميزانية محافظة مشتقة من حدود adapter.

## fallbacks

- غياب WebGPU: انتقال إلى WebGL2 الفعلي، ثم Canvas2D كخيار أخير.
- غياب WebCodecs encoder: FFmpeg WASM ينفذ resize/FPS/color/sharpen/denoise والصوت. ميزات AI لكل إطار تتطلب WebCodecs encoder.
- الواجهة تصدّر MP4 فقط؛ H.264 المباشر يستخدم Mediabunny، والصوت يُفك على دفعات صغيرة ويُنظف ويُرمّز AAC-LC عبر WebCodecs عندما يدعمه المتصفح.
- إذا غاب AAC Native أو كان ترميز الفيديو غير متوافق، ينتقل المسار تلقائياً إلى FFmpeg WASM لإخراج H.264/YUV420P وAAC.
- بعد الرندر يفحص التطبيق توقيع وبنية MP4 ثم يطلب من المتصفح قراءة أبعاده ومدته؛ الملف غير السليم لا يُعرض كنجاح.
- يفحص المسارات الفعلية داخل الحاوية بعد الرندر، ويرفض MP4 إذا لم يكن الفيديو H.264 أو كان AAC المطلوب مفقوداً.
- فشل WebGPU device: التحويل إلى WebGL2 لبقية job بدون إيقاف الرندر.
- فشل WebGPU execution provider في ONNX: انتقال إلى WASM execution provider.

## الاختبارات

```bash
npm run check
npx playwright install chromium
npm test
npm run build
```

تضم الحزمة 62 اختباراً آلياً تغطي ترتيب الإطارات، fallback للموديلات، signatures لـRIFE وCodeFormer، YuNet decoding/NMS/signature ومحاذاة ميل الوجه، التثبيت المتدرج وSHA-256، blending للبلاطات، المعالجة الزمنية، تثبيت صناديق الوجه، تنظيف الصوت المتدفق، تدقيق سلامة الصورة ومسارات H.264/AAC، خوارزمية تنعيم البشرة، الإصلاح الذكي، تقدير الرندر، قراءة حاوية فعلية، Scene Cut Guard، المعاينة، WebM mux، إنشاء وبث وفحص MP4، ودورة OPFS crash/resume في Chromium عندما يكون Playwright متوفراً.

## ملاحظة حول الحاويات

فك MP4/WebM/MOV يتم عبر Mediabunny، ويقرأ PTS وVFR والدوران من الحاوية ثم يفك الإطارات بالتتابع عبر WebCodecs؛ وإذا تعذر codec يرجع لمسار `<video>` أو FFmpeg. الإخراج يستخدم WebCodecs متى توفر encoder، وMediabunny لمسار MP4/H.264 السريع، ثم FFmpeg WASM للصوت والتحويل المتوافق.
