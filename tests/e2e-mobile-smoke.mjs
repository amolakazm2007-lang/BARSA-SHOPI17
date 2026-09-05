import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const server = spawn(path.resolve('node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', '4173'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await waitForServer('http://127.0.0.1:4173/');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const responseErrors = [];
  const externalRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => {
    try {
      const url = new URL(request.url());
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
        externalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      }
    } catch {}
  });
  page.on('response', response => {
    if (response.status() >= 400) responseErrors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  page.on('console', m => {
    if (m.type() !== 'error' || m.text().includes('[W:onnxruntime:')) return;
    if (m.text().includes('Failed to load resource: the server responded with a status of')) return;
    errors.push(m.text());
  });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#startBtn', { state: 'attached' });

  const required = [
    '#startBtn', '#modelsBtn', '#applySelectedStagesBtn', '#upscaleEnabled',
    '#rifeEnabled', '[data-batch-stage="blur"]', '[data-batch-stage="restore"]',
    '[data-master-target="render"]', '[data-master-target="enhance"]'
  ];
  for (const selector of required) {
    if (await page.locator(selector).count() < 1) throw new Error(`Missing critical control: ${selector}`);
  }

  const multiCount = await page.locator('[data-batch-stage]').count();
  if (multiCount < 6) throw new Error(`Multi-Select stage count too low: ${multiCount}`);
  await assertNoHorizontalOverflow(page, 390);

  await page.setViewportSize({ width: 360, height: 740 });
  await page.waitForTimeout(100);
  await assertNoHorizontalOverflow(page, 360);

  await page.click('[data-master-target="render"]');
  await page.waitForTimeout(120);
  if (!(await page.locator('#startBtn').isVisible())) throw new Error('Render action is unreachable after opening Render at 360px');

  await page.click('[data-master-target="enhance"]');
  await page.waitForTimeout(120);
  if (!(await page.locator('#modelsBtn').isVisible())) throw new Error('Models launcher is unreachable after opening Enhance at 360px');
  await page.click('#modelsBtn');
  await page.locator('#modelsDialog').waitFor({ state: 'visible' });
  if (!(await page.locator('[data-install="upscale"]').isVisible())) throw new Error('Manual upscale model catalog is not reachable');
  await page.click('#closeModelsBtn');

  // Very narrow Android devices must remain usable, not merely un-clipped at 360px.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(120);
  await assertNoHorizontalOverflow(page, 320);
  await page.click('[data-master-target="render"]');
  await page.waitForTimeout(100);
  if (!(await page.locator('#startBtn').isVisible())) throw new Error('Render action is unreachable at 320px');

  // Boot/navigation must be deterministic and offline-safe. Model downloads are
  // explicit user actions and must never happen during application startup or
  // merely by opening the model catalog.
  if (externalRequests.length) errors.push(`Unexpected startup/catalog network requests: ${[...new Set(externalRequests)].join(' | ')}`);
  if (responseErrors.length) errors.push(...responseErrors);
  if (errors.length) throw new Error(`Browser UI errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ mobileSmoke: true, multiCount, widths: [390, 360, 320], renderReachable: true, modelsReachable: true, offlineBoot: true }, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

async function assertNoHorizontalOverflow(page, width) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`${width}px mobile overflow: ${overflow}px`);
}

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { const r = await fetch(url); if (r.ok) return; } catch (e) { lastError = e; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw lastError || new Error('Vite did not start');
}
