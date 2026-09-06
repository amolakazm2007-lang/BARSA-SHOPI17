import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const server = spawn(path.resolve('node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', '4174'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await waitForServer('http://127.0.0.1:4174/');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' });

  const webgl = await page.evaluate(async () => {
    const { WebGLContextGuard } = await import('/src/engine/WebGLContextGuard.js');
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const gl = canvas.getContext('webgl2');
    if (!gl) return { supported: false };
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return { supported: true, extension: false };
    const guard = new WebGLContextGuard({ canvas, logger: { error() {}, warn() {} } });
    let lost = false, restored = false;
    guard.addEventListener('lost', () => { lost = true; });
    guard.addEventListener('restored', () => { restored = true; });
    ext.loseContext();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const blocked = (() => { try { guard.assertAvailable(); return false; } catch (error) { return error?.code === 'WEBGL_CONTEXT_LOST'; } })();
    ext.restoreContext();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const alive = document.body.isConnected && typeof document.createElement === 'function';
    guard.dispose(); canvas.remove();
    return { supported: true, extension: true, lost, restored, blocked, alive };
  });
  if (webgl.supported && webgl.extension && (!webgl.lost || !webgl.blocked || !webgl.alive)) throw new Error(`Real WebGL context-loss recovery failed: ${JSON.stringify(webgl)}`);

  const hardTimeout = await page.evaluate(async () => {
    const { withHardTimeout } = await import('/src/engine/CrashProofRuntime.js');
    const started = performance.now();
    try { await withHardTimeout(() => new Promise(() => {}), { timeoutMs: 80, label: 'browser-hung-promise' }); return { ok: false }; }
    catch (error) { return { ok: error?.code === 'OPERATION_TIMEOUT', code: error?.code, elapsed: performance.now() - started, alive: document.body.isConnected }; }
  });
  if (!hardTimeout.ok || !hardTimeout.alive || hardTimeout.elapsed > 1000) throw new Error(`Hard timeout failed in real Chromium: ${JSON.stringify(hardTimeout)}`);

  const workerCrash = await page.evaluate(async () => {
    const NativeWorker = window.Worker;
    const crashURL = URL.createObjectURL(new Blob([`throw new Error('intentional-worker-crash')`], { type: 'text/javascript' }));
    const worker = new NativeWorker(crashURL);
    let crashed = false;
    await new Promise((resolve) => { worker.onerror = () => { crashed = true; resolve(); return true; }; setTimeout(resolve, 1500); });
    worker.terminate(); URL.revokeObjectURL(crashURL);
    return { crashed, alive: document.body.isConnected };
  });
  if (!workerCrash.crashed || !workerCrash.alive) throw new Error(`Real Worker crash did not remain contained: ${JSON.stringify(workerCrash)}`);

  const workerHang = await page.evaluate(async () => {
    const { withHardTimeout } = await import('/src/engine/CrashProofRuntime.js');
    const url = URL.createObjectURL(new Blob([`self.onmessage=()=>{}`], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const reply = new Promise((resolve) => { worker.onmessage = (event) => resolve(event.data); worker.postMessage('hang'); });
    let code = null;
    try { await withHardTimeout(reply, { timeoutMs: 100, label: 'real-worker-hang', onTimeout: () => worker.terminate() }); }
    catch (error) { code = error?.code; }
    URL.revokeObjectURL(url);
    return { code, alive: document.body.isConnected };
  });
  if (workerHang.code !== 'OPERATION_TIMEOUT' || !workerHang.alive) throw new Error(`Real Worker hang timeout failed: ${JSON.stringify(workerHang)}`);

  if (pageErrors.length) throw new Error(`Unexpected page errors after fault injection: ${pageErrors.join(' | ')}`);
  console.log(JSON.stringify({ webgl, hardTimeout, workerCrash, workerHang, pageAlive: !page.isClosed() }, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { const response = await fetch(url); if (response.ok) return; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('Vite did not start');
}
