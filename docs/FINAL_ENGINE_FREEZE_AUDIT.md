# Barsa Shopi — Final Engine Freeze Audit

Date: 2026-09-02
Target: POCO F6
Project: video-toolkit-pro v4.6.0

## Release intent

This package is the engine-complete source baseline before the separate Barça UI/UX redesign. No new editor features should be added before device acceptance unless a reproducible engine defect is found.

## Final code-side completions

- Automatic model provisioning is wired into render start for enabled Upscale, RIFE and Face models.
- Full Device Test V2 can optionally auto-install missing production models before inference testing.
- Production automatic model catalog entries are pinned to known SHA-256 values and exact known byte sizes where published.
- Large model installation performs browser-storage preflight before download.
- Model downloads are restricted to audited HTTPS catalog hosts; manual URLs remain HTTPS-only and must pass runtime verification.
- CPU Canvas fallback uses a dedicated Worker for Quality/Color pixel loops to avoid keeping the heavy loop on the UI thread.
- Full Device Test V2 reports separate encoding, Quality, Color, LUT, CPU Worker, Blur, model, safe-tile and Cancel/Restart checks.
- Runtime vendor assets are protected by a release audit that checks critical file presence, exact sizes and SHA-256 output.
- Existing streaming render, bounded queues, OPFS, temporal processing, audio validation, frame pacing and export validation are preserved.

## Verified in this audit environment

- `npm run check`: PASS.
- `npm run final:audit`: PASS.
- JavaScript syntax check across `src/` and `scripts/`: PASS.
- Focused engine/model/quality/blur/color/A-V tests: 34/34 PASS.
- Production model catalog integrity test: PASS.
- Critical FFmpeg/ORT runtime assets and bundled Mobile SR model are present at the expected sizes.

## Dependency-run limitation of this audit environment

A fresh `npm ci` could not complete in the current sandbox because package retrieval timed out. The partially-created `node_modules` directory was deliberately excluded from the release archive. The package contains `package-lock.json`; a normal development machine should perform `npm ci` before running the complete test/build suite.

Previous full-suite attempts in this sandbox showed only dependency-resolution failures for `mediabunny` and `playwright` after the timed-out install; these are not marked as engine PASS until a clean dependency install is performed.

## Device-only acceptance still required

The following cannot truthfully be certified without the physical POCO F6 and production browser runtime:

- Real WebGPU inference of downloaded Real-ESRGAN, RIFE, GFPGAN and CodeFormer weights on the phone.
- 1080p120 and 4K60 sustained hardware behavior.
- Safe AI tile size under actual Adreno memory pressure.
- Physical thermals and throttling.
- Five-minute sustained heavy render with AI + RIFE/Blur where applicable.
- Real long-run audio sync on the phone.
- Visual preset tuning against real football, grass, crowd, gameplay, compressed, night and face footage.

These are not hidden or reported as PASS. Use Full Device Test V2 and real sample renders on the POCO F6.

## Freeze rule

After POCO F6 acceptance passes or exposes only hardware-declared limitations, freeze the engine. Move to the Barça UI/UX redesign. Only reopen engine work for reproducible defects or failed device acceptance checks.
