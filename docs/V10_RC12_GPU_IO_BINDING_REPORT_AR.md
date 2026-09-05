# BARSA SHOPI v10 RC12 — GPU IO Binding / Quality-Locked Render

## الهدف
تسريع الرندر بالذكاء الاصطناعي بدون خفض الدقة أو FPS أو bitrate أو تغيير خوارزمية النموذج. هذه الدفعة تركز على تقليل تخصيص/نسخ الذاكرة في WebGPU مع بقاء مسار fallback الكامل.

## ما تم تنفيذه

### 1) WebGpuIoArena جديد
- GPU input buffers قابلة لإعادة الاستخدام حسب tensor shape.
- pre-allocated GPU output buffers عبر ONNX Runtime Web `Tensor.fromGpuBuffer`.
- readback buffer قابل لإعادة الاستخدام.
- LRU محدود لعدد الـshapes حتى لا تتراكم VRAM.
- تحرير GPUBuffer صريح عند destroy/clear.
- دعم single-input وmulti-input inference.

### 2) Upscale IO Binding
- Real-ESRGAN / SR WebGPU fast path يرفع Float32 إلى GPU buffer ثابت.
- ONNX Runtime يكتب النتيجة داخل output GPU buffer ثابت بدل تخصيص output جديد بكل tile.
- النتيجة تنزل إلى CPU مرة واحدة فقط لأن compositor الحالي CPU/Canvas.
- fallback تلقائي إلى `session.run()` التقليدي عند أي عدم توافق.
- أي نموذج يفشل IO binding يتم تعطيل fast path له فقط، وليس AI كله.

### 3) RIFE IO Binding
- دعم RIFE concat [1,6,H,W] وdual [1,3,H,W] + [1,3,H,W].
- frame tensors على GPU buffers قابلة لإعادة الاستخدام.
- timestep/scale تبقى feeds عادية حسب signature الحقيقي.
- preallocated output GPU buffer + readback مضبوط.
- fallback تلقائي للمسار التقليدي.

### 4) Self-test حقيقي للـIO Binding
- فحص النموذج العادي يبقى موجودًا.
- إذا WebGPU IO binding متاح، يتم تشغيل نفس tensor عبر المسار المقيد للـGPU.
- مقارنة رقمية بين النتيجتين قبل اعتبار fast path موثوقًا.
- عند الاختلاف/الفشل: يبقى النموذج شغال عبر المسار القياسي، ويتم تعطيل IO binding فقط.

### 5) Graph Capture متوقف في Final Render
تم تعطيله عمدًا في وضع Quality-Locked بسبب تقارير upstream حديثة عن replay غير صحيح لبعض static-shape WebGPU graphs. الهدف هنا عدم قبول أي تسريع يمكن أن يغيّر output. يمكن إعادة تقييمه لاحقًا بعد ترقية ORT واختبار تفاضلي على أجهزة حقيقية.

## ما لم يتغير
- Output resolution.
- Output FPS.
- جودة/خوارزمية AI.
- Tile blending math.
- RIFE interpolation semantics.
- MP4/audio validation paths.
- Native/WASM fallbacks.

## نتائج الاختبار
- v10 critical: 92/92 PASS.
- ضغط 100 دورة: 100/100 PASS.
- 92 اختبارًا في كل دورة = 9,200/9,200 PASS.
- Full Suite: 275/278 PASS.
- الثلاثة المتبقية بسبب حزم بيئة التنفيذ المفقودة: mediabunny (2) وplaywright (1).
- Source Audit: PASS.
- Runtime SHA audit: 7/7 PASS.
- Final Audit: PASS.
- UI Audit: PASS (172 IDs، بدون duplicate static IDs).
- JS/MJS syntax: 169/169 PASS.

## حدود الإثبات الحالية
اختبارات الـGPU arena تشمل mocks واختبارات تكامل/سلوك ساكن، لكن لا يوجد في بيئة التنفيذ الحالية WebGPU Android فعلي أو APK مثبت على جهاز. لذلك سرعة IO binding الفعلية وVRAM/thermal improvement يجب قياسها على جهاز Android حقيقي قبل وصفها كنسبة أداء مؤكدة.
