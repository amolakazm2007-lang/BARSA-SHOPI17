# BARSA SHOPI v9.1 — مخطط Compact Pro UI

## الفكرة
قوة كبيرة داخلية، واجهة خارجية بسيطة. كل زر يجمع فقط المعالجات من نفس الاختصاص، وماكو دمج بين مؤثرات مختلفة.

## المخطط الرئيسي

```text
اختيار الفيديو
    │
    ▼
┌──────────────────────────────┐
│      BARSA COMPACT PRO       │
├──────────────────────────────┤
│ 1) تنظيف الجودة             │──► Denoise / Temporal Denoise
│                              │    Deblock / Deband / Artifact
│                              │    Chroma / Mosquito / Compression Rescue
├──────────────────────────────┤
│ 2) استعادة التفاصيل         │──► Detail / Fine Detail / Texture
│                              │    Micro Texture / Structure / Fusion / Edges
├──────────────────────────────┤
│ 3) الحدة والوضوح            │──► Clarity / Local Contrast / Smart Sharpen
│                              │    Dehalo / Anti-Ringing
├──────────────────────────────┤
│ 4) الوجوه والبورتريه        │──► YuNet + GFPGAN/CodeFormer
│                              │    Face Detail / Eye / Hair / Skin Protect
├──────────────────────────────┤
│ 5) الحركة والنعومة          │──► RIFE / Temporal Reconstruction
│                              │    Anti-Flicker / Scene Protection
├──────────────────────────────┤
│ 6) تثبيت الفيديو            │──► Stabilization فقط
├──────────────────────────────┤
│ 7) الألوان                  │──► Color Engine / Contrast / Vibrance
│                              │    Clarity / Dehaze
└──────────────────────────────┘
    │
    ├────────► البلور: خانة مستقلة + رندر مستقل
    │
    ▼
Frame Perfect + Resilience
    │
    ▼
Native / WebGPU / WASM fallback
    │
    ▼
H.264 + AAC MP4 + Validation
```

## قاعدة الواجهة
- كل بطاقة: تشغيل/إيقاف + قوة 0–100 + زر «متقدم» فقط.
- الإعدادات التفصيلية مخفية افتراضياً، لكنها لم تُحذف.
- البلور لا يندمج مع التحسينات ويظل له رندر منفصل.
- التصدير لا يختلط مع إعدادات AI.
- لا يتم خفض الدقة أو إسقاط الفريمات من أجل السرعة.

## فلسفة الرندر
1. قراءة متسلسلة للفريمات.
2. Frame Integrity Guard.
3. Back-pressure للـEncoder وOPFS.
4. Resilience Engine يقلل التوازي عند الضغط، لا الجودة.
5. Native/NNAPI ثم WebGPU ثم WASM.
6. MP4 recovery عند فشل mux.
