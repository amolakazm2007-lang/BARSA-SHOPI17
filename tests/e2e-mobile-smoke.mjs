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
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('[W:onnxruntime:')) errors.push(m.text()); });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#startBtn', { state: 'attached' });

  const required = [
    '#startBtn', '#modelsBtn', '#applySelectedStagesBtn', '#upscaleEnabled',
    '#rifeEnabled', '[data-batch-stage="blur"]', '[data-batch-stage="restore"]',
    '[data-master-target="render"]'
  ];
  for (const selector of required) {
    if (await page.locator(selector).count() < 1) throw new Error(`Missing critical control: ${selector}`);
  }

  const multiCount = await page.locator('[data-batch-stage]').count();
  if (multiCount < 6) throw new Error(`Multi-Select stage count too low: ${multiCount}`);
  const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow390 > 1) throw new Error(`390px mobile overflow: ${overflow390}px`);

  await page.setViewportSize({ width: 360, height: 740 });
  await page.waitForTimeout(100);
  const overflow360 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow360 > 1) throw new Error(`360px mobile overflow: ${overflow360}px`);

  await page.click('[data-master-target="render"]');
  await page.waitForTimeout(120);
  if (!(await page.locator('#startBtn').isVisible())) throw new Error('Render action is unreachable after opening Render at 360px');

  await page.click('#modelsBtn');
  if (!(await page.locator('[data-install="upscale"]').isVisible())) throw new Error('Manual upscale model catalog is not reachable');
  await page.click('#closeModelsBtn');

  if (errors.length) throw new Error(`Browser UI errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ mobileSmoke: true, multiCount, overflow390, overflow360, renderReachable: true }, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { const r = await fetch(url); if (r.ok) return; } catch (e) { lastError = e; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw lastError || new Error('Vite did not start');
}
