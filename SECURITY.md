# Security policy

Video Toolkit Pro processes media locally in the browser. Please report security
issues privately through GitHub's **Security → Report a vulnerability** flow and
do not attach private videos, ONNX models, device logs, or personal data to a
public issue.

Supported release: **4.3.x**.

## Runtime trust boundaries

- The application does not require an upload or processing server.
- Bundled runtime assets are served from the same origin.
- Remote ONNX installation accepts only catalogued HTTPS sources, streams the
  bytes into OPFS, verifies constraints, and runs a local inference self-test.
- Imported ONNX and NCNN files never execute as JavaScript.
- Browser, GPU driver, codec implementation, and installed PWA permissions remain
  part of the trusted device environment.
