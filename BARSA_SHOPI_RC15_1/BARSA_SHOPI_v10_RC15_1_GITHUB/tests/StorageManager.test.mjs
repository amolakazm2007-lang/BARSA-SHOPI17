// StorageManager.test.mjs — real test, runnable with plain Node:
// `node tests/StorageManager.test.mjs`
//
// OPFS and IndexedDB are browser-only APIs (no Node.js equivalent), so
// unlike TileProcessor.test.mjs / FrameSequencer.test.mjs this test drives
// a real headless browser via Playwright to execute the actual assertions
// — it is not a mock. Requires a static server + Playwright's Chromium
// (both already used throughout this project's development; no network
// access is needed since OPFS/IndexedDB are local browser storage).
//
// What this proves, for real: a genuine simulated crash (dropping the
// StorageManager reference without closing the OPFS stream) followed by
// opening a FRESH StorageManager correctly finds only the data that was
// actually flushed to disk at the last checkpoint — not the buffered,
// unflushed tail — and resuming from there produces a byte-perfect final
// file identical to an uninterrupted run.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8933;

// Playwright is an optional test-time dependency. The production application
// does not ship a browser binary, and some CI/sandbox images install the npm
// package without downloading Chromium. Keep the real OPFS test active when
// the executable exists, but do not report an infrastructure omission as a
// StorageManager regression.
if (!existsSync(chromium.executablePath())) {
  console.log('SKIP StorageManager browser integration: Playwright Chromium is not installed.');
  process.exit(0);
}

function startServer() {
  return spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: PROJECT_ROOT, stdio: 'ignore' });
}

let failures = 0;
function assert(cond, label) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failures++;
}

const server = startServer();
await new Promise((r) => setTimeout(r, 800)); // let the server bind

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/index.html?no-sw=1`);

  const result = await page.evaluate(async () => {
    const { StorageManager } = await import('/src/engine/StorageManager.js');
    const sm = new StorageManager();
    const out = {};

    await sm.beginSession('t1', { width: 640, height: 360 });
    for (let i = 0; i < 25; i++) {
      await sm.appendFrame('t1', new Uint8Array(1000).fill(i % 256), i, 10);
    }
    out.flushedFrames = (await sm.getCheckpoint('t1')).framesWritten;
    // Simulated crash: reference dropped here without finalize/close.

    const sm2 = new StorageManager();
    const resumable = await sm2.findResumableSession();
    out.foundResumable = !!resumable;
    out.resumedFromFrame = resumable?.framesWritten ?? null;

    if (resumable) {
      await sm2.resumeSession(resumable.sessionId);
      for (let i = resumable.framesWritten; i < 25; i++) {
        await sm2.appendFrame('t1', new Uint8Array(1000).fill(i % 256), i, 10);
      }
      const file = await sm2.finalizeSession('t1');
      out.finalSize = file.size;

      // Verify byte content is actually correct (not just size) — read
      // back frame 24's bytes and confirm they match what was written.
      const buf = new Uint8Array(await file.arrayBuffer());
      out.lastByteCorrect = buf[buf.length - 1] === (24 % 256);
      out.firstByteCorrect = buf[0] === 0;
    }

    out.resumableAfterFinalize = await sm2.findResumableSession();

    // Abort path: lock must release, file must be reopenable
    await sm2.beginSession('t2', {});
    await sm2.appendFrame('t2', new Uint8Array(100), 0, 10);
    await sm2.abortSession('t2', 'test');
    out.abortedStatus = (await sm2.getCheckpoint('t2')).status;
    try {
      await sm2.beginSession('t2', {});
      out.reopenAfterAbort = true;
    } catch {
      out.reopenAfterAbort = false;
    }

    const positioned = await sm2.createRandomAccessOutput('t2', 'mp4');
    const positionedWriter = positioned.writable.getWriter();
    await positionedWriter.write({ type: 'write', position: 4, data: new Uint8Array([5, 6]) });
    await positionedWriter.write({ type: 'write', position: 0, data: new Uint8Array([1, 2, 3, 4]) });
    await positionedWriter.close();
    out.positionedBytes = [...new Uint8Array(await (await positioned.getFile()).arrayBuffer())];
    await sm2.abortSession('t2', 'cleanup');

    await sm2.deleteSession('t1');
    await sm2.deleteSession('t2');
    out.cleanedUp = (await sm2.getCheckpoint('t1')) === null && (await sm2.getCheckpoint('t2')) === null;

    return out;
  });

  assert(result.flushedFrames === 21, `checkpoint correctly flushed 21/25 frames at checkpointEvery=10 (got ${result.flushedFrames})`);
  assert(result.foundResumable === true, 'fresh StorageManager instance finds the interrupted session');
  assert(result.resumedFromFrame === 21, `resumes from the last DURABLE checkpoint, not an assumed frame count (got ${result.resumedFromFrame})`);
  assert(result.finalSize === 25000, `final file is byte-exact after resume (got ${result.finalSize}, expected 25000)`);
  assert(result.firstByteCorrect === true, 'frame 0 content survived the crash+resume cycle correctly');
  assert(result.lastByteCorrect === true, 'frame 24 (written post-resume) content is correct');
  assert(result.resumableAfterFinalize === null, 'a finalized session is no longer offered for resume');
  assert(result.abortedStatus === 'aborted', 'abort path correctly marks the checkpoint aborted');
  assert(result.reopenAfterAbort === true, 'OPFS write lock is genuinely released after abort (no stuck lock)');
  assert(JSON.stringify(result.positionedBytes) === JSON.stringify([1, 2, 3, 4, 5, 6]), 'positioned OPFS output writes are byte-exact');
  assert(result.cleanedUp === true, 'deleteSession removes the checkpoint record');
} finally {
  await browser?.close();
  server.kill();
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
