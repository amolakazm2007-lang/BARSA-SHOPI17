# BARSA SHOPI v10 RC8 — Ultimate AI / Models / Engines

## الهدف
هذه المرحلة تركز على جعل منظومة الذكاء الاصطناعي قابلة للتحقق فعلياً على الجهاز، مع تحميل أخف، حالة رقمية واضحة، مصادر موثوقة مع SHA-256، وتدرج تنفيذ Native Android → WebGPU → WASM.

## التحسينات المنفذة
- ModelManager أصبح مصدر الحالة الموحد للنموذج: حجم متوقع/فعلي، نسبة التحميل، المرحلة، SHA، self-test، execution provider، وآخر خطأ.
- منع تنزيل النموذج نفسه مرتين عبر single-flight لكل Model ID.
- تنزيل نماذج الشبكة Streaming مباشرة إلى OPFS مع SHA-256 أثناء الكتابة، دون تجميع chunks كامل في RAM.
- حد أمان 512MB للنموذج وفحص مساحة التخزين قبل/بعد معرفة Content-Length.
- timeout لقراءة الشبكة المتوقفة حتى لا يبقى زر التحميل معلقاً إلى الأبد.
- Native Android registration يرسل OPFS File/Blob مباشرة بدلاً من ArrayBuffer ضخم للنماذج الثقيلة؛ يوجد fallback توافق للطريقة القديمة.
- واجهة الحزمة تعرض لكل نموذج: %، MB المحمل/الإجمالي، مرحلة التنزيل، SHA ✓، شغال ✓، ومحرك التنفيذ الفعلي.
- «شغال ✓» لا تظهر إلا بعد verify + inference self-test حقيقي.
- زر «فحص كل المثبت» يعيد SHA/الحجم ثم inference لكل نموذج مثبت.
- YuNet 2026 أصبح الافتراضي، مع مصدرين موثقين وYuNet 2023 fallback تلقائي إذا تعذر 2026.
- RIFE 4.9 لديه 3 مصادر تنزيل متتابعة مع SHA واحد مثبت؛ RIFE 4.7 fallback ثم Compatible manual.
- CodeFormer لديه مصدران متطابقان بالبصمة كـ fallback.
- استعادة Real-ESRGAN ×8 كخيار يدوي مضبوط؛ لا يتم ادعاء تنزيل تلقائي له بدون مصدر مطابق مثبت.
- تصحيح منطق RIFE ليعتمد توقيع ONNX الحقيقي: timestep/scale فقط عندما يعلن النموذج عنها.
- حفظ حالة الخطأ وآخر نسبة وصلها التحميل بدل إرجاع البطاقة بشكل مضلل إلى 0%.
- تحرير جلسات WebGPU/WASM وAndroid Native بعد الاستخدام والاختبار لتقليل تراكم RAM.

## الحزمة المدققة آلياً
النماذج الظاهرة في لوحة الحزمة الرقمية:
1. Real-ESRGAN General ×4 Turbo
2. ONNX Model Zoo Mobile SR ×3
3. Real-ESRGAN ×4 Plus
4. RIFE 4.9
5. RIFE 4.7
6. YuNet 2026 May
7. YuNet 2023 Mar fallback
8. GFPGAN 1.4
9. CodeFormer

نماذج Compatible/×8/Real-CUGAN اليدوية تبقى متاحة، لكنها لا تحصل على «شغال ✓» إلا بعد استيراد الملف وفحصه على الجهاز.

## نتائج الاختبارات على آخر كود
- 100/100 دورة ضغط متكررة PASS.
- 97 اختباراً حرجاً في كل دورة = 9700/9700 تحقق PASS، صفر فشل.
- Full Suite: 246/249 PASS.
- الثلاثة غير القابلة للتشغيل في هذه البيئة فقط تعتمد mediabunny/playwright غير المثبتتين بسبب timeout شبكة بيئة العمل؛ سجل الخطأ مرفق ولا تم تحويلها إلى PASS وهمي.
- Source policy: PASS.
- Runtime assets: 7/7 SHA-256 PASS.
- Final audit: PASS.
- JavaScript/MJS syntax: 154/154 PASS.
- Android XML parsing: 8/8 PASS.

## مبدأ الحالة في الواجهة
- 0% / غير مثبت: لا يوجد ملف صالح.
- يحمل: النسبة + bytes/MB + المرحلة.
- SHA ✓ · بانتظار inference: الملف مطابق لكن لم ينجح self-test بعد.
- 100% · شغال ✓ · SHA ✓ · الحجم · Provider: الحالة الوحيدة التي تعني نموذجاً جاهزاً فعلياً.
- خطأ: تبقى آخر نسبة وآخر رسالة خطأ حتى إعادة المحاولة/الإصلاح.

## ملاحظة APK
هذه RC Source مدققة. لا يتم وصفها كـ Final APK لأن بيئة التنفيذ الحالية لم تتمكن من إكمال node_modules/Gradle build الكامل بسبب timeout الشبكة. بوابة CI في المشروع مصممة لمنع إخراج APK عند فشل اختبارات التكامل/Android checks.
