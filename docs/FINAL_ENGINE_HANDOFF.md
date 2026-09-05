# Barsa Shopi — Code-side engine handoff

Date: 2026-09-02

This pass closes the remaining code-side blockers that can be completed without the physical POCO F6.

## Added / completed in this pass

- Background CPU fallback worker for heavy Canvas2D Quality/Color pixel loops. The render pipeline uses a module Worker with transferable RGBA buffers and a single bounded in-flight request; the main thread retains only canvas readback/upload work.
- Full Device Test V2. It separately measures 1080p60, 1080p120, 4K30 and 4K60 H.264 encode paths; WebGPU/AAC/OPFS; Quality; Color; LUT; worker fallback; Blur; installed production model self-tests; a real Real-ESRGAN tile probe; and Cancel -> Render Again.
- Device test intentionally reports model tests as SKIPPED when a production model is not installed/runtime-verified. It never fabricates temperature, process RAM, or hardware encoder identity.
- Automatic model repair now attempts verified catalog/fallback re-download and runtime self-test for RIFE/Face as well as Upscale before asking for manual import.
- A/V sync validation now records the decoded streaming-audio timeline when native AAC is used and rejects measured drift outside a duration-dependent bound. FFmpeg audio paths remain container-duration/track validated when exact decoded output-audio timing is not exposed.
- Long-render diagnostics now record frame count, elapsed time, encoder queue peak, and JS heap start/end/peak/growth when the browser exposes heap metrics.
- Blur encoder preference is real and capability-driven: Automatic, Prefer Hardware, Prefer Software. It is passed to WebCodecs capability probing; no vendor-specific encoder name is invented.
- CPU fallback worker availability and render stability results are included in export metadata.
- New A/V sync regression tests.

## Verification in this environment

- Source policy check: PASS.
- Syntax check for every src/*.js module: PASS.
- 77 tests that do not require the incomplete extracted mediabunny/playwright/ffmpeg node_modules: PASS 77/77.
- Full npm build/browser suite could not be rerun in this container because the extracted dependency tree is incomplete (for example @ffmpeg/core/dist/esm is absent). This is an environment/dependency state, not reported as a passing build.

## Physical-device-only acceptance remaining

These cannot truthfully be marked PASS without running on the actual POCO F6:

- Real 1080p60 / 1080p120 / 4K60 sustained video render throughput.
- Physical temperature/thermal throttling observation (normal browser APIs do not expose a reliable Celsius sensor).
- Real long render with the user's production combination (target practical workload ~5 minutes, optional longer stress test).
- Production ONNX download + WebGPU/WASM inference for Real-ESRGAN, RIFE, GFPGAN and CodeFormer on the phone.
- Exact safe production tile size for the installed Real-ESRGAN model on the phone (Full Device Test V2 measures this).
- Perceptual preset tuning on real football/grass/crowd/gameplay/compressed/night/face clips.

## Resume status

Crash-safe OPFS/checkpoint/source recovery is retained. Universal mid-render append-resume across RIFE, Motion Blur and other temporal processors is intentionally not labelled complete because correct recovery requires temporal-context/segment overlap and safe mux continuation. The application must not claim FULL RESUME until a segment-context implementation is device-validated.

## UI gate

No additional engine feature is required before beginning the Barcelona UI redesign once Full Device Test V2 and one real production render set are run on the POCO F6. Any failures found there should be fixed as targeted device bugs, not by adding another broad engine phase.

## Final auto-provision pass

- Render preflight now auto-provisions every enabled AI model instead of rejecting the render with a manual-ONNX message.
- If FPS conversion/Blur interpolation requires RIFE, preflight automatically enables the selected RIFE profile and installs/tests it.
- Upscale and RIFE may switch to a verified fallback model automatically when the requested catalog model fails.
- Face restoration automatically attempts the official YuNet detector install as a non-blocking companion before render.
- Manual import remains only as the last-resort path when every audited automatic source fails.
- Added deterministic tests for keep/install/fallback behavior of the model auto-provisioner.

At this point there are no additional broad code-side engine features that should block the Barcelona UI phase. Remaining acceptance items are physical-device measurements and perceptual tuning on the POCO F6.
