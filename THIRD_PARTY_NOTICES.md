# Third-party notices

Video Toolkit Pro uses the following third-party software and model assets. Their
licenses remain with their respective authors.

| Component | Version / asset | License | Source |
| --- | --- | --- | --- |
| Mediabunny | 1.55.5 | MPL-2.0 | https://github.com/Vanilagy/mediabunny |
| ONNX Runtime Web | 1.22.0 | MIT | https://github.com/microsoft/onnxruntime |
| ffmpeg.wasm | 0.12.x packages | MIT; the bundled FFmpeg core retains its applicable FFmpeg/LGPL terms | https://github.com/ffmpegwasm/ffmpeg.wasm |
| ONNX Model Zoo Super Resolution | `super-resolution-10.onnx`, opset 10 | Apache-2.0 | https://huggingface.co/onnxmodelzoo/super-resolution-10 |
| Real-ESRGAN x4plus | Optional auto-downloaded/user-imported ONNX conversion | BSD-3-Clause upstream | https://github.com/xinntao/Real-ESRGAN |
| RIFE 4.9 / 4.7 ONNX | Optional auto-downloaded community ONNX exports | Mirror terms / upstream terms apply | https://huggingface.co/yuvraj108c/rife-onnx |
| GFPGAN 1.4 ONNX | Optional auto-downloaded ONNX conversion | Apache-2.0 upstream | https://github.com/TencentARC/GFPGAN |
| CodeFormer ONNX | Optional auto-downloaded ONNX conversion | NTU S-Lab License 1.0 upstream | https://github.com/sczhou/CodeFormer |

The bundled Super Resolution model is stored at
`public/models/super-resolution-10.onnx`. It is pinned to ONNX Model Zoo commit
`395472c4b6b92f788357237983d83fd913cfe7e3` and SHA-256
`85f36ff88cc504a24af5e0602148bc56a8aa09a58eca8c0da2756f3e8186035e`.

Nihui NCNN/Vulkan assets remain manual/stored-only unless a compatible runtime is provided.
RIFE, Real-ESRGAN, GFPGAN, and CodeFormer are not bundled into the application archive; the
Model Center can download selected compatible ONNX conversions on demand, verifies catalog
hashes where known, then requires a real inference self-test before marking them READY.
Third-party model licenses and training-data terms remain with their respective authors/mirrors.
