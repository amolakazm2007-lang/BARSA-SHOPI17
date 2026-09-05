# BARSA SHOPI v9.0 — مخطط البنية

```mermaid
flowchart TD
  A[الفيديو / MediaInput] --> B[Frame Integrity Guard]
  B --> C[Temporal Reconstruction]
  C --> D[Stabilization]
  D --> E[Quality Restore + Denoise + Compression Rescue]
  E --> F[Upscale AI\nNative Android → WebGPU → WASM]
  F --> G[Face AI\nYuNet + GFPGAN/CodeFormer]
  G --> H[Color Engine\nRGB Mixer + Curves + LUT]
  H --> I[Frame Sequencer / RIFE]
  I --> J{Blur enabled?}
  J -- Yes --> K[BLUR COMPLETE\nWeighting + Gamma + Deduplicate]
  J -- No --> L[Output Frames]
  K --> L
  L --> M[WebCodecs H.264]
  M --> N[OPFS Durable Stream]
  N --> O{Native MP4 works?}
  O -- Yes --> P[Native MP4 + AAC]
  O -- No --> Q[FFmpeg Recovery / Remux]
  P --> R[MP4 + A/V + Track Validation]
  Q --> R
  R --> S[Render Proof]
  S --> T[Android MediaStore / Gallery]

  U[RenderLoadGovernor] -.-> M
  U -.-> N
  V[RenderResilienceEngine] -.-> F
  V -.-> I
  V -.-> M
  W[DeviceGuard] -.-> C
  W -.-> M
```

## قاعدة البنية
- لا إسقاط فريمات لتخفيف الحمل.
- لا تغيير output resolution أو FPS خلف ظهر المستخدم.
- لا تبديل model مختار يدوياً أثناء render.
- عند فشل backend: fallback آمن ومسجل.
- عند فشل MP4 native: استعادة عبر FFmpeg من elementary stream.
