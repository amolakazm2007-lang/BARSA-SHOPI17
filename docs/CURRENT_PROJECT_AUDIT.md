# Current project audit — 4.6.0

> The latest engine-completion state is recorded in `docs/ENGINE_COMPLETION_REPORT.md`. This file remains as implementation history.

## ما نُفّذ وربط فعلياً

- معاينة GPU مباشرة للفلاتر بدل CSS أو قراءة CPU لكل إطار: sharpen، detail، high-pass، denoise، اللون وتنعيم البشرة، مع Canvas fallback.
- مقارنة قبل/بعد متزامنة، تشغيل، seek، ووقت الفيديو داخل واجهة المعاينة.
- إصلاح ذكي يحلل التعريض والضوضاء والتفاصيل ووجود درجات البشرة، ثم يطبّق قيماً قابلة للتعديل.
- Presets: Clean، Portrait Pro، Crisp 4K، وCinema.
- تقدير وقت قبل الرندر وETA/سرعة/إطارات أثناء الرندر.
- WebGPU أساسي، WebGL2 احتياطي سريع للموبايل، وCanvas2D كخيار أخير.
- WebCodecs بملفات profile تتكيف مع الدقة، مع hardware وsoftware encoder fallback.
- WebM mux محلي zero-copy، ومسار MP4/H.264 Fast Start مباشر عبر Mediabunny، مع AAC-LC متدفق عندما يدعمه WebCodecs.
- الصوت يُفك إلى عينات محدودة الذاكرة ويخضع high/low-pass وnoise gate وتطبيع تكيفي وtrue-peak limiter؛ وعند غياب AAC Native يعود إلى FFmpeg تلقائياً.
- demux مباشر لـMP4/WebM/MOV مع PTS وVFR ودوران صحيح وdecode متسلسل، وfallback آمن عند عدم دعم codec.
- Scene Cut Guard يمنع RIFE من مزج لقطتين منفصلتين.
- رندر MP4/H.264 المباشر يكتب إلى OPFS أثناء التنفيذ ولا يحتفظ بملف الإخراج كاملاً في RAM.
- أوضاع Auto/Mobile/Maximum Quality، فحص مساحة قبل الرندر، وWake Lock للرندر الطويل.
- ملف POCO F6 Turbo يضبط tiles/batches للهاتف، مع كشف رمز الجهاز عندما يسمح Chrome واختيار يدوي دائم.
- مصفوفة H.264 تفحص فعلياً 1080p60 و4K30 و4K60؛ واختبار قبول الجهاز يشغّل WebGPU وH.264 وAAC وOPFS و4K60 القصير عندما يكون معلناً.
- اختيار AVC أصبح يرفع مستوى H.264 تلقائياً إلى Level 5.1/5.2 عند 4K30/4K60، ما يمنع رفض Android لإعداد 4K منخفض المستوى.
- GitHub Actions يبني ويختبر وينشر، وService Worker يضيف COOP/COEP على الاستضافة الثابتة بعد إعادة تحميل التفعيل.
- GeometryEngine موحد لكل المسارات: 720p/1080p/1440p/4K/8K، نسب 16:9 و9:16 و1:1 و4:5 و3:4 و4:3 و21:9، وأي مقاس مخصص آمن حتى 8192px.
- contain/cover/stretch تعمل في المعاينة والرندر WebCodecs وFFmpeg بنفس الحساب، بدون تمدد عرضي غير مقصود.
- مساحة AI الوسيطة محدودة بالضلع وعدد البكسلات حتى لا ينشئ نموذج ×3 سطحاً يتجاوز قدرة Canvas/GPU على الهاتف.
- واجهة Barça Color Edition بسيطة بخلفية كحلية وأزرق/خمري/أحمر ولمسات ذهبية، والإعدادات المتقدمة مطوية افتراضياً.
- مسار التصدير الظاهر للمستخدم MP4 فقط، مع H.264/AAC وFast Start حيث ينطبق.
- FFmpeg WASM مفرد ومتعدد الخيوط مع اختيار آمن حسب RAM/عدد الأنوية ومهلة تمنع التعليق.
- OPFS + IndexedDB للحفظ المرحلي والاستعادة، وTileProcessor لمعالجة 4K/8K.
- نموذج Mobile SR ×3 مضمن ومدقق مع progress وOPFS وSHA/self-test، إضافة إلى model vault اليدوي لـReal-ESRGAN وRIFE وGFPGAN/CodeFormer.
- تنفيذ tile inference الذي كان ناقصاً صار فعلياً، مع دعم fixed-input edge padding/crop وYCbCr luminance للنموذج الخفيف.
- واجهة Creator Studio بحركات transform-only، micro-interactions، ومراعاة `prefers-reduced-motion`.
- ملفات ONNX compatible مرنة تُقبل باختلاف الـhash، لكنها لا تُفعّل إلا بعد inference/shape test فعلي.
- Nihui/NCNN vault يستورد `.param + .bin` إلى OPFS ويفحص magic وعدد الطبقات والـblobs، مع تمييز صريح أنه يحتاج ONNX أو NCNN-WASM للتنفيذ في المتصفح.
- Pro Tone: Exposure، Highlights، Shadows، Whites، Blacks، Dehaze، Vignette، وFilm Grain على WebGPU/WebGL2/Canvas مع fallback FFmpeg.
- variable bitrate عند دعمه ومعدلات جودة أعلى للـWebCodecs وFFmpeg.
- Temporal Denoise وAnti-Flicker حقيقيان في المعاينة والرندر، مع motion gate وscene-cut reset وسجل تاريخ محدود الذاكرة.
- RIFE يقبل dual/concat signatures ومدخلات timestep/scale الشائعة، ويشغّل الاستدلالات المتعددة بالتتابع لحماية VRAM الهاتف.
- GFPGAN/CodeFormer يقبلان image-only أو fidelity-weight signatures، مع كاشف YCbCr محلي عند غياب FaceDetector وتثبيت صناديق الوجه وfeather blend.
- كاشف OpenCV YuNet ONNX رسمي اختياري مع hash وحجم ورخصة مدققة، decoding متعدد stride وNMS وخمس landmarks؛ يُستخدم تلقائياً قبل الاستعادة، يصحح ميل الوجه من نقطتي العين، ويعمل كل إطارين لتخفيف الحمل على الهاتف.
- استيراد النماذج يحسب SHA-256 تدريجياً أثناء الكتابة إلى OPFS بدل تجميع نسخة ثانية من النموذج في RAM.
- فحص نهائي لبنية MP4 وقابلية قراءة metadata والأبعاد والمدة قبل إعلان اكتمال الرندر.
- فحص المسارات بعد mux يرفض النتيجة إذا لم يكن الفيديو H.264 أو كان AAC المطلوب مفقوداً، بما في ذلك مسار FFmpeg-only.
- QualityMetricsEngine يدقق عينات الإخراج ويرصد clipping والسطوع والحدة الزائدة دون تخزين الإطارات.

## الاختبار الفعلي في 1 سبتمبر 2026

- `npm run check`: نجح.
- `npm test`: نجح — 62 اختباراً، بلا فشل.
- `npm run build`: نجح، وأنتج `dist/` مع WASM محلي.
- OPFS crash/reopen/append/finalize: نجح داخل Chromium حقيقي.
- واجهة الهاتف 390×844: لا يوجد overflow أفقي.
- المعاينة: تغيّرت بيانات البكسل فعلياً بعد الإصلاح الذكي.
- رندر end-to-end حقيقي داخل Chromium: مصدر VP9/WebM → فلاتر → WebCodecs → IVF/OPFS → WebM mux → مشغل النتيجة.
- تثبيت النموذج المضمن إلى OPFS ثم إنشاء جلسة ONNX واستدلال Super Resolution حقيقي: نجح.
- تغليف حزم H.264 حقيقية إلى MP4 عبر Mediabunny والتحقق من توقيع `ftyp`: نجح.
- بث حاوية MP4 بكتابة موضعية بدلاً من Buffer كامل: نجح.
- قراءة WebM حقيقي واستخراج 320×180 و12FPS وVP9 من الحاوية: نجح.
- الرندر المتصفحي النهائي أكد استخدام `Direct Decode`: نجح.
- استيراد حزمة NCNN تجريبية إلى OPFS عبر الواجهة: نجح، وتم التحقق من 2 طبقة داخل Chromium.
- المعاينة: Exposure + Dehaze + Highlight recovery غيّرت بيانات Canvas فعلياً.
- نتيجة الرندر المختبرة: 320×180، 24FPS، VP9، 7.0KB، اكتملت خلال نحو ثانية، بلا أخطاء صفحة؛ backend الاختبار WebGL2.

اختبارات Chromium أعلاه أُجريت على خط الأساس 4.3. تغييرات 4.6 اجتازت 62 اختبار Node وفحص المصدر وبناء Vite، لكن إعادة اختبار Playwright لم تعمل في بيئة التغليف الحالية لأن Chromium التنفيذي غير مثبت؛ لذلك يبقى تشغيل زر «اختبار الجهاز الكامل» وتجربة MP4+AAC طويل وYuNet على POCO F6 شرط القبول النهائي على الجهاز.

## حدود يجب ذكرها بصدق

- نموذج رفع الدقة الخفيف مضمن ومدقق؛ Real-ESRGAN وRIFE وGFPGAN/CodeFormer استيراد يدوي حتى تتوفر تحويلات ONNX ومسارات تنزيل رسمية ثابتة ومتوافقة مع CORS.
- لا يمكن للمتصفح كشف VRAM الفيزيائي؛ الواجهة تعرض ذاكرة GPU التي خصصها التطبيق وميزانية محافظة.
- أداء 4K/8K وAI يختلف كثيراً حسب الهاتف وحرارة الجهاز؛ ETA يتعلم من تقدم المهمة لكنه يبقى تقديراً.
- مسار FFmpeg WASM وصل إلى الـcore المحلي، لكن حجز ذاكرته داخل Chromium Headless في هذه الحاوية غير مستقر. مسار AAC Native الجديد يحتاج فحصاً على Chrome/Android فعلي لأن بيئة Node لا توفر AudioEncoder.
- التطبيق متعمد أن يكون أداة تحسين ورندر محلية مركزة للجودة والدقة والوجوه والحركة والصوت؛ ولا يستهدف القص أو الدمج أو التحرير العام.

## أفضل بيئة تشغيل

Chrome أو Edge حديث عبر HTTPS، مع COOP/COEP، جهاز RAM 8GB أو أكثر، وWebGPU إن توفر. يعمل WebGL2 كخيار عملي على هواتف Android التي لا تتيح WebGPU.
