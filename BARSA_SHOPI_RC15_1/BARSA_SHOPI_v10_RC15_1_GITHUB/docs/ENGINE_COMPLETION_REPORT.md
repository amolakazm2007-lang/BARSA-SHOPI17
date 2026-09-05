# Barsa Shopi v4.6.0 — Engine completion report

Date: 2026-09-02

This report records what was retained, completed, and added without claiming physical-device acceptance. A successful build is not treated as proof that every model, resolution, or long-render case works on the POCO F6.

## KEEP

- The single streaming pipeline: demux, decode, bounded processing, encode, mux, validate.
- WebGPU with WebGL2/Canvas fallback, WebCodecs, ONNX Runtime Web, Workers, OPFS, tiled inference, MP4/H.264/AAC, cancellation, checkpoints, quality metrics, and the existing POCO F6 profile.
- Existing Mobile SR x3, RIFE signature adapters, YuNet, face restoration, Temporal Denoise, Anti-Flicker, Scene Cut Guard, native MP4 muxing, and FFmpeg compatibility fallback.
- Unsupported `.pth`, `.param/.bin`, and incompatible model files remain stored-only and are never labelled executable ONNX models.

## FIXED / COMPLETED

- Integrated all processing through the existing `VideoPipeline`; no duplicate render, model, worker, OPFS, RIFE, or encoder system was created.
- Split image processing into compression cleanup, temporal processing, AI reconstruction, detail finish, color, interpolation, temporal Blur, encode, mux, and validation.
- Added hard stage bypass semantics: a disabled Quality/Face/Blur/Color processor contributes no effect to export.
- Added scene-aware strengths, temporal history resets, and catastrophic interpolation-frame fallback.
- Completed model metadata, lazy loading, hash/signature/provider/test records, runtime self-test, manual HTTPS import, repair/retest/replace/delete, and honest custom-runtime verification.
- Kept face finishing inside detected face regions. General quality processing never depends on face detection.
- Fixed FFmpeg's local class worker path and MP4 timestamp normalization. H.264 B-frame reorder delay no longer shifts the playable timeline.
- Added constant-memory frame-pacing validation for duplicate, missing, non-monotonic, and irregular export timestamps.
- Mapped supported Quality and Color controls into the FFmpeg fallback. The fallback does not perform whole-frame portrait smoothing.
- Added the six editable real presets: Natural Restore, Clean 4K, Sports Detail, Maximum Detail, Compressed Rescue, and Blur Pro.

## ADDED

- `QualityEngine`: 16 independent general-video stages, representative-frame analysis, Smart Enhance modes, scene adaptation, risk warnings, and Temporal Artifact Guard.
- `MotionBlurEngine`: real rolling temporal accumulation with bounded memory, gamma-aware blending, deduplication, scene reset, WebGPU/CPU paths, and the requested weighting families.
- `ColorEngine`: float processing, BT.709 SDR controls, RGB/Luma curves, validated 1D/3D `.cube` LUT parsing, trilinear LUT blending, and LUT hash identity.
- Minimal Quality Lab, Face/Portrait Lab, Blur, Color Lab, look library, model health, and preset controls. This is access/testing UI, not the postponed redesign.
- New automated tests for Quality Lab, Blur configuration/weights, Color/LUT behavior, frame pacing, MP4 remuxing, and fallback filter mapping.

## Verification performed

- `npm ci`: PASS before implementation.
- `npm run check`: PASS.
- `npm test`: PASS, 76 tests, including a real Chromium OPFS crash/resume/lock-release integration test.
- `npm run build`: PASS.
- `npm run test:browser`: PASS. Real browser flow installed and inference-tested the bundled Mobile SR model, imported a stored-only NCNN pack, changed preview pixels, decoded sequentially, rendered, remuxed H.264 MP4, validated the video track, and checked a 390 px mobile viewport.
- A real FFmpeg filter graph containing cleanup, detail, halo control, color, anti-flicker, and temporal mixing was executed successfully against the included sample video.

## System status

| System | Status |
| --- | --- |
| Build | PASS |
| Tests | PASS |
| Models | LIMITED |
| Quality Engine | LIMITED |
| RIFE | LIMITED |
| Blur | LIMITED |
| Color | LIMITED |
| LUT | LIMITED |
| Audio | LIMITED |
| Export | PASS |
| MP4 H.264 | PASS |
| Frame Pacing | PASS |
| Memory | LIMITED |
| Cancel / Restart | LIMITED |
| Long Render | NOT TESTED |
| 4K60 | NOT TESTED |
| 120 FPS | NOT TESTED |
| POCO F6 | NOT TESTED |

## Honest limitations

- Mobile SR x3 was installed and inference-tested in Chromium. RIFE, Real-ESRGAN, GFPGAN, and CodeFormer require a compatible user-supplied ONNX file and have not been exercised here with production weights.
- Blur's temporal math and streaming architecture are tested, but RIFE-driven high-sample Blur and long 4K runs require real-device testing.
- Color controls and LUT math are tested on pixels; HDR output is intentionally not invented. Production BT.709 behavior must still be visually checked on the POCO F6 display and exported files.
- Browser test coverage used a tiny 320x180 input. It does not prove thermals, hardware encoding, audio sync, memory stability, 4K60, 4K120, or long-render recovery on the target phone.
- Resume remains limited to checkpoints that are technically safe. It is not presented as universal mid-frame restoration.

Physical POCO F6 acceptance must run the in-app device test plus real 1080p60, 4K30, 4K60, optional 120 FPS, audio, cancel/restart, and long-render cases before any of their statuses can become PASS.
