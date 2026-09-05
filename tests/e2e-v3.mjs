import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const server = spawn(path.resolve('node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', '4173'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await waitForServer('http://127.0.0.1:4173/');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('[W:onnxruntime:')) errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400 && !isOptionalRemoteModel(response.url())) errors.push(`HTTP ${response.status()} ${response.url()}`); });
  page.on('requestfailed', (request) => { if (!isOptionalRemoteModel(request.url())) errors.push(`REQUEST FAILED ${request.url()} · ${request.failure()?.errorText || 'unknown'}`); });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });

  // CI must be deterministic: verify the trusted catalog action exists, but do not make
  // a third-party model host a release gate. Download retry + SHA integrity are unit-tested.
  await page.click('#modelsBtn');
  const catalogAction = await page.locator('[data-install="upscale"]').textContent();
  if (!catalogAction.includes('240 KB')) throw new Error('Trusted mobile model download is not exposed in the UI');

  await page.locator('#upscaleEnabled').evaluate((input) => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.setInputFiles('#nihuiModelInput', [
    { name: 'test.param', mimeType: 'text/plain', buffer: Buffer.from('7767517\n2 3\nInput input 0 1 data\nConvolution conv 1 1 data out 0=3') },
    { name: 'test.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2, 3, 4, 5]) },
  ]);
  await page.waitForFunction(() => document.querySelector('#nihuiModelState')?.textContent.includes('تم فحص وحفظ'));
  const nihuiImported = await page.locator('#nihuiModelState').textContent();
  await page.click('#closeModelsBtn');

  await page.setInputFiles('#videoInput', path.resolve('tests/tiny-render.webm'));
  await page.waitForSelector('#previewShell:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#outputCanvas')?.width > 2);
  await page.waitForFunction(() => /^LIVE (GPU|CPU)$/.test(document.querySelector('#previewBackendBadge')?.textContent || ''));
  const previewBackend = await page.locator('#previewBackendBadge').textContent();
  await page.click('#compareBtn');
  const before = await page.locator('#outputCanvas').evaluate((canvas) => canvas.toDataURL());
  await page.locator('#cl-exposure').evaluate((input) => { input.closest('details').open = true; });
  await page.locator('#cl-exposure').fill('0.75');
  await page.locator('#cl-dehaze').fill('0.35');
  await page.locator('#cl-highlights').fill('-0.25');
  await page.locator('#ql-temporalDenoise').fill('0.2');
  await page.locator('#ql-antiFlicker').fill('0.15');
  await page.waitForTimeout(250);
  const after = await page.locator('#outputCanvas').evaluate((canvas) => canvas.toDataURL());
  if (before === after) throw new Error('Advanced filters did not change preview pixels');

  await page.selectOption('#resolution', 'original');
  await page.selectOption('#targetFps', 'original');
  await page.selectOption('#quality', 'LOW');
  await page.selectOption('#outputFormat', 'mp4');
  await page.locator('#audioEnabled').evaluate((input) => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#startBtn');
  try {
    await page.waitForSelector('#resultPanel:not([hidden])', { timeout: 60_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      toast: document.querySelector('#toast')?.textContent,
      stage: document.querySelector('#progressStage')?.textContent,
      detail: document.querySelector('#progressDetail')?.textContent,
      percent: document.querySelector('#progressPercent')?.textContent,
    }));
    throw new Error(`Browser render timed out: ${JSON.stringify(state)} | ${errors.join(' | ')}`, { cause: error });
  }
  const result = await page.evaluate(() => ({
    info: document.querySelector('#resultInfo').textContent,
    download: document.querySelector('#downloadBtn').download,
    source: document.querySelector('#resultVideo').src,
    backend: document.querySelector('#backendBadge').textContent,
  }));
  await page.screenshot({ path: 'tests/e2e-v4.png', fullPage: true });
  if (!result.source.startsWith('blob:')) throw new Error('Render did not produce a local blob URL');
  if (!result.download.endsWith('.mp4')) throw new Error(`Render did not produce MP4: ${result.download}`);
  if (!result.info.includes('H.264 مُتحقق')) throw new Error(`Final H.264 MP4 track validation was not reported: ${result.info}`);
  if (!result.info.includes('Direct Decode')) throw new Error(`Container-aware sequential decode was not used: ${result.info}`);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (mobileOverflow > 1) throw new Error(`Mobile layout has ${mobileOverflow}px horizontal overflow`);
  await page.click('[data-master-target="enhance"]');
  await page.click('[data-master-target="render"]');
  await page.setViewportSize({ width: 360, height: 740 });
  const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (narrowOverflow > 1) throw new Error(`Narrow mobile layout has ${narrowOverflow}px horizontal overflow`);
  const startVisible = await page.locator('#startBtn').isVisible();
  if (!startVisible) throw new Error('Final render action is not reachable on narrow mobile viewport');
  await page.screenshot({ path: 'tests/e2e-v4-mobile.png', fullPage: false });
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ previewChanged: true, previewBackend, catalogAction, mobileOverflow, narrowOverflow, startVisible, nihuiImported, ...result }, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

function isOptionalRemoteModel(url) {
  return /model|\.onnx(?:$|\?)/i.test(String(url || '')) && !String(url || '').startsWith('http://127.0.0.1:4173/');
}

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const response = await fetch(url); if (response.ok) return; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('Vite did not start');
}
