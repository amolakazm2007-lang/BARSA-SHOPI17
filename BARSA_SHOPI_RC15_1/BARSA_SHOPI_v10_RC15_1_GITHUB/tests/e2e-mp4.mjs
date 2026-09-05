import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const server = spawn(path.resolve('node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', '4174'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await waitForServer('http://127.0.0.1:4174/');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' });
  await page.setInputFiles('#videoInput', path.resolve('tests/tiny-render.webm'));
  await page.waitForSelector('#previewShell:not([hidden])');
  await page.selectOption('#resolution', 'original');
  await page.selectOption('#targetFps', '24');
  await page.selectOption('#quality', 'LOW');
  await page.selectOption('#outputFormat', 'mp4');
  await page.locator('#audioEnabled').evaluate((input) => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
  const mp4Path = await page.locator('#codecBadge').textContent();
  if (mp4Path.includes('FFmpeg')) {
    console.log(JSON.stringify({
      skipped: true,
      reason: 'Headless Chromium has no H.264 WebCodecs encoder; FFmpeg WASM core cannot allocate reliably in this container',
      mp4Path,
    }, null, 2));
    await browser.close();
    browser = null;
    server.kill('SIGTERM');
    process.exit(0);
  }
  await page.locator('#contrast').fill('1.12');
  await page.locator('#sharpen').fill('0.55');
  await page.locator('#vibrance').fill('0.18');
  await page.click('#startBtn');
  try {
    await page.waitForSelector('#resultPanel:not([hidden])', { timeout: 260_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      toast: document.querySelector('#toast')?.textContent,
      stage: document.querySelector('#progressStage')?.textContent,
      detail: document.querySelector('#progressDetail')?.textContent,
      percent: document.querySelector('#progressPercent')?.textContent,
    }));
    throw new Error(`MP4 render timed out: ${JSON.stringify(state)} | browser: ${errors.join(' | ')}`, { cause: error });
  }
  const result = await page.evaluate(async () => {
    const video = document.querySelector('#resultVideo');
    const response = await fetch(video.src);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      info: document.querySelector('#resultInfo').textContent,
      download: document.querySelector('#downloadBtn').download,
      mime: response.headers.get('content-type'),
      size: bytes.length,
      signature: String.fromCharCode(...bytes.slice(4, 8)),
      codecBadge: document.querySelector('#codecBadge').textContent,
    };
  });
  if (result.signature !== 'ftyp') throw new Error(`MP4 ftyp signature missing: ${result.signature}`);
  if (!result.download.endsWith('.mp4') || result.mime !== 'video/mp4') throw new Error(`Wrong MP4 delivery: ${JSON.stringify(result)}`);
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify(result, null, 2));
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
