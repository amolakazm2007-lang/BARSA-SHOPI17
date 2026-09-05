# ONNX model integration

Video Toolkit Pro never enables an AI feature based only on a filename.

## Install lifecycle

1. User either installs the bundled audited Mobile SR model or selects a local `.onnx` file.
2. `ModelManager` streams it to `/models` in OPFS.
3. SHA-256 is calculated and stored with size/role metadata in IndexedDB.
4. The owning engine opens an ONNX Runtime session with WebGPU first and WASM fallback.
5. A synthetic inference validates the model signature and output shape.
6. Only then is `testPassed=true` and the UI toggle enabled.

## Supported profiles

| Role | Registry ids | Expected profile |
| --- | --- | --- |
| Mobile upscale | `onnx-model-zoo-sr-x3` | NCHW Y channel, YCbCr reconstruction, dynamic/fixed x3 |
| Upscale | `real-esrgan-x4plus`, `real-esrgan-x8-facefusion` | NCHW RGB, fixed scale x4/x8 |
| Interpolation | `rife-tensorstack`, `rife47-emmajohnson311` | dual NCHW frames or concatenated 6-channel input |
| Face restoration | `gfpgan-1.4`, `codeformer` | NCHW RGB 512x512, -1..1 range |
| Generic upscale | `real-esrgan-compatible-x4` | NCHW RGB, runtime-validated x4 output |
| Generic interpolation | `rife-compatible` | dual NCHW or concatenated 6-channel, runtime-validated |

The bundled Mobile SR model is pinned to a revision and SHA-256 and still has to pass real inference before activation. The Qualcomm x4 entry exposes its official source, size, and digest for manual import because its host does not provide a reliable browser-CORS download path. A differently exported but architecturally compatible model should be registered under a new id with its own input profile and digest.

## Storage

Model files are durable local data in OPFS. Deleting a model removes its OPFS file and IndexedDB metadata. ONNX Runtime loads the verified ArrayBuffer only when that engine is used.

## Nihui / NCNN packs

`NihuiModelBridge` accepts a `.param + .bin` pair, validates NCNN magic (`7767517`) and declared layer/blob counts, then streams both files to OPFS. It deliberately records `execution=stored-only`: Nihui releases use native Vulkan and cannot be executed by ONNX Runtime Web. Convert/export a compatible ONNX graph or provide a separately built NCNN-WASM runtime before execution.
