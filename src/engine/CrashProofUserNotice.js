export function crashProofUserMessage(error, { fallback = null } = {}) {
  const code = error?.code || 'UNKNOWN_FAILURE';
  const base = {
    GPU_DEVICE_LOST: 'تعطلت معالجة WebGPU أثناء الرندر.',
    WEBGL_CONTEXT_LOST: 'فُقد سياق WebGL أثناء الرندر.',
    WORKER_FAILED: 'تعطل عامل المعالجة الخلفي.',
    WORKER_MESSAGE_ERROR: 'تعذر تبادل بيانات المعالجة مع العامل الخلفي.',
    WORKER_TIMEOUT: 'توقفت مرحلة المعالجة الخلفية عن التقدم ضمن المهلة.',
    OPERATION_TIMEOUT: 'توقفت إحدى مراحل المعالجة عن الاستجابة ضمن المهلة.',
    PIPELINE_STALLED: 'توقف عداد الإطارات عن التقدم، لذلك أوقفت المرحلة بأمان بدل تجميد التطبيق.',
    MEMORY_PRESSURE: 'ضغط الذاكرة وصل إلى مستوى غير آمن، لذلك تم إيقاف العمل الثقيل بأمان.',
    CHECKPOINT_CORRUPT: 'تعذر التحقق من سلامة نقطة الاستئناف المحفوظة.',
    ENCODER_FAILED: 'فشل مرمز الفيديو أثناء الإخراج.',
    DECODER_FAILED: 'فشل فك ترميز الفيديو.',
  }[code] || (error?.message || 'حدث خطأ أثناء المعالجة.');
  return fallback ? `${base} تم التحويل تلقائيًا إلى ${fallback}.` : base;
}
