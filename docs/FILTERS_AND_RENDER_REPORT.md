# تقرير الفلاتر والرندر — Video Toolkit Pro 4.6

## الخلاصة التنفيذية

المعاينة والرندر يستخدمان القيم نفسها. المسار الأساسي WebGPU/WGSL، يليه WebGL2/GLSL، ثم Canvas2D، بينما يستخدم مسار FFmpeg-only بدائل قريبة عندما لا يتوفر WebCodecs. لا يوجد فلتر تجميلي وهمي: كل منزلق يغير البكسلات فعلياً في المعاينة والنتيجة.

## الفلاتر الموجودة

| المجموعة | الفلتر | المجال | التنفيذ | ملاحظات الجودة |
| --- | --- | ---: | --- | --- |
| Tone | Brightness | -0.5…0.5 | GPU/CPU/FFmpeg | إزاحة عامة |
| Tone | Exposure | -2…2 EV | GPU/CPU، تقريبي في FFmpeg | مضاعفة خطية بـ `2^EV` |
| Tone | Contrast | 0.5…1.8 | جميع المسارات | حول نقطة 0.5 |
| Tone | Highlights | -1…1 | GPU/CPU، تقريبي في FFmpeg | قناع ناعم للمناطق المضيئة |
| Tone | Shadows | -1…1 | GPU/CPU، تقريبي في FFmpeg | قناع ناعم للمناطق الداكنة |
| Tone | Whites / Blacks | -1…1 | GPU/CPU، تقريبي في FFmpeg | ضبط نهايتي المجال بدون قطع صلب |
| Color | Saturation | 0…2 | جميع المسارات | تشبع خطي |
| Color | Vibrance | -1…1 | GPU/CPU، تقريبي في FFmpeg | يحمي الألوان المشبعة نسبياً |
| Color | Temperature | -1…1 | جميع المسارات | انحياز دافئ/بارد |
| Detail | Unsharp Sharpen | 0…2 | جميع المسارات | Threshold لمنع تضخيم الضوضاء |
| Detail | Detail / Clarity | 0…2 | GPU متعدد المقاييس، تقريبي في fallbacks | تباين محلي أوسع من sharpen |
| Detail | High Pass | 0…2 | GPU/CPU/FFmpeg | حدة luma لتقليل الهالات الملونة |
| Repair | Denoise | 0…1 | bilateral على GPU/CPU، HQDN3D في FFmpeg | يحافظ على الحواف قدر الإمكان |
| Repair | Temporal Denoise | 0…1 | motion-adaptive history، HQDN3D في FFmpeg | يتوقف عند الحركة القوية وقطع المشهد لتجنب ghosting |
| Repair | Anti-Flicker | 0…1 | تحليل luma زمني محدود | يصحح تغير التعريض الصغير بحد أقصى 8% |
| Portrait | Skin Smooth | 0…1 | GPU/CPU، Smartblur fallback | skin-tone heuristic مع edge gate، ليس كشف وجه AI |
| Portrait | Face Restore | 0…1 | GFPGAN/CodeFormer ONNX | لا يعمل إلا بعد inference test ناجح |
| Atmosphere | Dehaze | 0…1 | GPU/CPU، تقريبي في FFmpeg | contrast + chroma restoration مقيد |
| Finish | Vignette | 0…1 | جميع المسارات | سقوط شعاعي ناعم |
| Finish | Film Grain | 0…1 | جميع المسارات | ثابت مكانياً في GPU/preview؛ متحرك في FFmpeg |

## النماذج

| المهمة | تنسيق التنفيذ | ملفات مقبولة | التفعيل |
| --- | --- | --- | --- |
| Upscale سريع | ONNX Runtime Web | ONNX Model Zoo Mobile SR ×3، قناة Y/YCbCr | نموذج مضمن ومدقق، WebGPU ثم WASM، واختبار inference فعلي |
| Upscale عالي | ONNX Runtime Web | Qualcomm Real-ESRGAN x4plus ×4 (128×128 fixed input) | استيراد يدوي من المصدر المثبت، edge padding/crop للبلاطات |
| Upscale يدوي | ONNX Runtime Web | Real-ESRGAN-compatible ×4، Real-CUGAN ×2 | استيراد ONNX ثم self-test |
| Interpolation | ONNX Runtime Web | RIFE dual-input أو 6-channel، مع timestep/scale الاختياريين | فحص signature ثم inference مباشر أو midpoint recursion |
| Face restoration | ONNX Runtime Web | GFPGAN NCHW أو CodeFormer مع fidelity weight | inference فعلي ثم `testPassed`، دمج feather وثبات boxes |
| Face detection | ONNX Runtime Web | OpenCV YuNet 2023 الرسمي | تنزيل اختياري 233KB، SHA-256، self-test، multi-stride decode وNMS ومحاذاة ميل العينين |
| Nihui vault | NCNN storage | زوج `.param + .bin` | فحص magic/layer counts ثم OPFS؛ لا يُشغّل كـVulkan داخل الصفحة |

إصدارات Nihui الرسمية (`waifu2x-ncnn-vulkan`, `rife-ncnn-vulkan`, `realsr-ncnn-vulkan`) هي برامج native تستخدم NCNN/Vulkan. المتصفح لا يستطيع إطلاق هذه الملفات التنفيذية أو الوصول إلى Vulkan native. لذلك التطبيق يحفظ حزمها ويفحصها، لكنه لا يضع علامة «جاهز للتنفيذ» إلا لنسخة ONNX اجتازت ONNX Runtime Web. يدعم مشروع NCNN الرسمي بناء WebAssembly، لكن إدماج runtime مخصص مع operators كل نموذج مشروع مستقل ولا يساوي تشغيل إصدار Vulkan الأصلي.

## جودة الرندر

- WebCodecs يطلب hardware acceleration و`latencyMode: quality` ويجرب variable bitrate ثم fallback متوافق.
- معدلات الجودة: اقتصادي 0.065، متوازن 0.11، عالي 0.18، فائق 0.28 bit/pixel/frame كأساس تكيفي.
- keyframe كل ثانيتين، أبعاد زوجية، ومفاضلة codec حسب الحاوية.
- H.264 يُغلّف مباشرة إلى MP4 Fast Start عبر Mediabunny. عند دعم AudioEncoder يُنظف الصوت كعينات متدفقة ويُرمّز AAC-LC مباشرة؛ وإلا يعود إلى FFmpeg WASM.
- VP9/AV1 الصامت يمكن تغليفه مباشرة إلى WebM بدون FFmpeg؛ الصوت يستخدم Opus محلياً عبر FFmpeg عند الحاجة.
- الإدخال يُفك بالتتابع عبر Mediabunny/WebCodecs مع PTS وVFR حقيقيين بدلاً من seek لكل إطار، ثم تذهب الإطارات المشفرة إلى OPFS مباشرة.
- Scene Cut Guard يقيس تغير luminance/histogram على thumbnail محدود ويمنع استدعاء RIFE بين لقطتين منفصلتين.
- MP4/H.264 المباشر يُكتب كتابة موضعية إلى OPFS، لذلك لا توجد عتبة 180MB أو Buffer بحجم النتيجة كاملة.
- البلاطات المتداخلة تمنع seams وتحد من ذاكرة AI، ويقل حجم tile تلقائياً عند ضغط الذاكرة.
- كل MP4 نهائي يمر بفحص `ftyp`/ISO-BMFF ثم metadata decode داخل المتصفح للتأكد من الأبعاد والمدة قبل إعلان النجاح.
- بعد ذلك يُقرأ جدول المسارات نفسه للتأكد من H.264 ووجود AAC عند طلب الصوت وعدم وجوده عند تعطيله.
- النماذج الكبيرة تُكتب إلى OPFS ويُحسب SHA-256 لها chunk-by-chunk، فلا تبقى نسخة digest ثانية كاملة في RAM.
- تدقيق جودة محدود الكلفة يأخذ عينات مصغرة من الناتج ويرصد clipping والسطوع والحدة أو الضوضاء الزائدة، ويعرض مؤشراً تقنياً لا يدّعي أنه VMAF.

## ما تم اختباره

- 62 اختباراً لتسلسل الإطارات، كل نسب الأبعاد والمقاسات المخصصة، tile blending، OPFS crash recovery والكتابة الموضعية، mux المتدفق، فحص MP4 والمسارات، signatures لـRIFE وCodeFormer وYuNet ومحاذاة الوجه، SHA-256 المتدرج، temporal denoise، تثبيت الوجه، تنظيف الصوت المتدفق، تدقيق الصورة، probe لحاوية حقيقية، Scene Cut Guard، fallback النماذج، Mobile SR، Auto Fix، ETA، portrait smoothing، الفلاتر، وفحص NCNN param.
- اختبار معاينة يثبت تغير قيم البكسلات مع بقاء alpha صحيحاً.
- اختبار رندر متصفح فعلي صغير عبر WebCodecs/WebM، واختبار MP4 حقيقي يمرر حزم H.264 إلى `NativeMP4Muxer` ويتحقق من حاوية `ftyp`.

## حدود صريحة

- النموذج الخفيف مضمن ولا يحتاج اتصالاً. أوزان Real-ESRGAN وRIFE وGFPGAN/CodeFormer تبقى استيراداً يدوياً لغياب مسار تنزيل CORS/تحويل ONNX رسمي ثابت ومدقق لكل نموذج.
- حجز ذاكرة FFmpeg WASM غير مستقر داخل Chromium Headless في حاوية الاختبار؛ لذلك يلزم فحص AAC Native وMP4 طويل على أجهزة Chrome/Edge فعلية، بينما اختُبر بناء MP4/H.264 native فعلياً خارج ذلك المسار.
- لا يمكن لمتصفح معرفة VRAM الحقيقية؛ القياس يعرض تخصيصات التطبيق وحدود adapter.
- Skin Smooth غير AI وقد يخطئ تحت إضاءة ملونة. عند تثبيت YuNet يستخدم Face Restore كاشف ONNX مع خمس landmarks؛ ويبقى كاشف Shape Detection/YCbCr احتياطياً عندما لا يكون النموذج مثبتاً.
- لا يمكن ضمان مساواة Topaz/After Effects/DaVinci في كل حالة؛ هذه تطبيقات native ضخمة. هذا المشروع يوفر مساراً محلياً قوياً ومختبراً ضمن قيود المتصفح.

## ما ينقص كأداة تحسين جودة فقط

1. تحويلات RIFE وGFPGAN/CodeFormer رسمية ومدققة مع quantization للهاتف؛ لا ينبغي تنزيل تحويلات مجهولة تلقائياً.
2. محاذاة similarity كاملة (scale/translation) للحالات الجانبية جداً؛ الإصدار الحالي يصحح دوران العينين ويستعمل قصاً متدرج الحواف لتقليل التشويه.
3. WebNN/NPU وINT8/FP16 model variants لتقليل الحرارة والبطارية على الهاتف.
4. Color-management صريح لـHDR10/HLG و10-bit بدلاً من الاعتماد على تحويل المتصفح إلى SDR.
5. اختبارات أجهزة حقيقية موزعة لWebGPU وMP4+AAC و4K/8K الطويل؛ زر القبول المدمج يقيس الجهاز الحالي لكن لا يعوض مختبر أجهزة واسعاً.

## المصادر التقنية الرسمية

- ONNX Runtime Web WebGPU: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- ONNX Runtime Web deployment: https://onnxruntime.ai/docs/tutorials/web/deploy.html
- Mediabunny: https://mediabunny.dev/
- ONNX Model Zoo: https://github.com/onnx/models
- Mobile Super Resolution ×3: https://huggingface.co/onnxmodelzoo/super-resolution-10
- Qualcomm Real-ESRGAN x4plus: https://huggingface.co/qualcomm/Real-ESRGAN-x4plus
- Nihui waifu2x NCNN Vulkan: https://github.com/nihui/waifu2x-ncnn-vulkan
- Nihui RIFE NCNN Vulkan: https://github.com/nihui/rife-ncnn-vulkan
- Nihui RealSR NCNN Vulkan: https://github.com/nihui/realsr-ncnn-vulkan
- Tencent NCNN: https://github.com/Tencent/ncnn
