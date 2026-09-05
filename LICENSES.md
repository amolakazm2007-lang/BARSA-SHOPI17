# LICENSES.md

هذا المشروع لا ينسخ كود أي مشروع خارجي حرفيًا. الجدول التالي يوثّق كل مشروع/مكتبة
استُخدم إما كاعتمادية حقيقية (تُحمَّل من CDN وقت التشغيل) أو كمرجع معماري تم الاستفادة
من فكرته دون نسخ الكود.

| المشروع | الرابط | نوع الاستخدام | الترخيص (تحقق بنفسك قبل الإنتاج) |
|---|---|---|---|
| FFmpeg.wasm | https://github.com/ffmpegwasm/ffmpeg.wasm | اعتمادية حقيقية (CDN، Lazy load) | غلاف MIT — لكن FFmpeg الأساسي نفسه LGPL/GPL حسب بناء الكودكات المفعّلة. **إذا كان المشروع تجاريًا مغلق المصدر، تحقق من بناء LGPL تحديدًا لا GPL.** |
| ONNX Runtime Web | https://github.com/microsoft/onnxruntime | اعتمادية حقيقية (CDN، Lazy load) | MIT |
| web-realesrgan (xororz) | https://github.com/xororz/web-realesrgan | مرجع معماري فقط (pipeline: PyTorch→ONNX→TFJS، Tile+Overlap) — لم يُنسخ كود منه | تحقق من ترخيص المستودع قبل أي اقتباس فعلي للكود |
| Practical-RIFE (hzwer) | https://github.com/hzwer/Practical-RIFE | مصدر محتمل لأوزان RIFE — غير مُضمَّن في هذا البناء | MIT (تحقق من الإصدار المحدد) |
| rife-ncnn-vulkan (nihui) | https://github.com/nihui/rife-ncnn-vulkan | مرجع لبنية RIFE قبل التحويل لـONNX — غير مُضمَّن | تحقق من الترخيص |
| Framegen (مشروع WebGPU RIFE) | https://github.com/MONZikWasTaken/Framegen | مرجع إثبات مفهوم فقط لأداء RIFE عبر WGSL يدوي — لم يُستخدم أي كود منه | تحقق من الترخيص قبل أي استلهام كود فعلي |
| Mediabunny | (مكتبة WebCodecs-first حديثة) | ذُكرت كخيار بديل مستقبلي، **غير مُدمجة في هذا البناء** | تحقق من الترخيص عند الدمج الفعلي |

## نماذج AI المُدمَجة فعليًا

هذا المشروع **لا يشحن ملفات الأوزان نفسها** (لن تجدها داخل الـzip)، لكنه يشحن روابط
تحميل حقيقية + SHA256 مُتحقَّق منه فعليًا (تم فتح صفحة كل ملف على Hugging Face والتأكد من
القيمة، وليس نسخها من نتيجة بحث فقط) في `MODEL_REGISTRY` و`RIFE_MODEL_REGISTRY`:

| النموذج | الرابط المباشر | SHA256 | الحجم |
|---|---|---|---|
| Real-ESRGAN x4plus (Qualcomm) | `https://huggingface.co/qualcomm/Real-ESRGAN-x4plus/resolve/01179a4da7bf5ac91faca650e6afbf282ac93933/Real-ESRGAN-x4plus.onnx` | `4e1ae0e47f80d9f4aa2a317c24fde2cb3e49a5381eed6e1d509b4001a4b97ad2` | 67.1MB |
| RIFE (TensorStack) | `https://huggingface.co/TensorStack/RIFE/resolve/main/model.onnx` | `76e4cef9ab42fa7dd4e8f6e4aba47462051e3faa969e4bca6479784fbab0ac6f` | 21.5MB |

**الترخيص — اقرأه بنفسك قبل أي استخدام تجاري**:
- نموذج Qualcomm مرخّص "other" (شروط Qualcomm AI Hub المخصصة) — راجع صفحة الموديل على
  Hugging Face للنص الكامل قبل النشر التجاري.
- نموذج TensorStack/RIFE يُستخدم داخل مشروع `TensorStack-AI/OnnxStack` (.NET) — راجع
  ترخيص ذلك المستودع (GitHub) قبل أي استخدام تجاري لأن صفحة النموذج نفسها لا تذكر ترخيصًا
  صريحًا منفصلاً.
- الأصل المعماري لـRIFE هو `hzwer/Practical-RIFE`، مرخّص MIT.

**لم يُتحقَّق منه بعد (بصدق)**: توقيع المدخلات/المخرجات الدقيق لكل نموذج (هل RIFE يأخذ
فريمين منفصلين أم فريمًا مدمجًا بـ6 قنوات؟ هل Real-ESRGAN يقبل أبعادًا ديناميكية أم أبعادًا
ثابتة فقط؟) — الكود في `UpscaleEngine.js`/`RIFEEngine.js` مكتوب ليتكيّف مع الاحتمالين حيثما
أمكن، لكن لم يُشغَّل فعليًا في هذه البيئة (بلا إنترنت) للتأكيد. أول تشغيل حقيقي لـ
`runSelfTest()` على جهازك سيؤكد ذلك أو يُظهر خطأ واضحًا.
