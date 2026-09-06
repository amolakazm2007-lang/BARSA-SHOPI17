# BARSA SHOPI Crash-Proof Acceptance Gate

A build MUST NOT be described as crash-proof or 100/100 unless every item below has a current passing proof from the same commit.

- hard-timeout: a deliberately never-resolving Promise must fail with OPERATION_TIMEOUT.
- graphics-fallback: forced WebGPU failure must reach WebGL2; forced WebGPU+WebGL2 failure must reach Canvas2D.
- webgl-context-loss: a real browser test must trigger WEBGL_lose_context and prove the page remains alive and switches backend or reports a controlled failure.
- webgpu-device-loss: when the environment exposes a real loss mechanism, prove device.lost is observed and the render switches backend without page death. If unavailable, mark UNPROVEN, never PASS by mock alone.
- worker-crash: a real Worker must throw; caller/page must remain alive and the task must fall back or fail clearly.
- worker-messageerror: malformed/uncloneable messaging path must be surfaced.
- worker-hang-timeout: a Worker task that never replies must terminate by timeout and release the worker.
- periodic-resume-integrity: during a real render, durable checkpoint + file integrity must be verified every configured N frames.
- quality-lock: recovery may change queue/concurrency/preview load but not requested final width/height/FPS/bitrate/frame count.
- end-to-end-render: browser upload -> settings -> render -> result must either complete or end with a visible controlled error; no silent freeze/page crash.
- android-coldstart-3x: same APK must install and survive three force-stop/cold-start cycles with a live PID/resumed activity.
- android-logcat-clean: no fatal exception, renderer-death loop, or ANR in the release gate logcat.

Debug signing is not production signing. A release keystore is a separate distribution requirement and must never be claimed unless provided and verified.
