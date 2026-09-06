import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/engine/WebCodecsEngine.js', import.meta.url);
let source = await readFile(path, 'utf8');

function ensureReplace(before, after, alreadyToken, label) {
  if (source.includes(alreadyToken)) return;
  if (!source.includes(before)) throw new Error(`WebCodecs watchdog integration anchor missing: ${label}`);
  source = source.replace(before, after);
}

ensureReplace(
  "const FLUSH_TIMEOUT_MS = 15000;\n",
  "const FLUSH_TIMEOUT_MS = 15000;\nconst QUEUE_STALL_TIMEOUT_MS = 15000;\n",
  'const QUEUE_STALL_TIMEOUT_MS = 15000;',
  'queue timeout constant',
);

ensureReplace(
  "        while (this.decoder.decodeQueueSize >= this.maxQueueSize) await waitForQueue(this.decoder, signal);\n        this.decoder.decode(chunk);",
  "        await waitForQueueBelow(this.decoder, this.maxQueueSize, signal, {\n          label: 'VideoDecoder queue drain',\n          onTimeout: () => safeCloseCodec(this, 'decoder'),\n        });\n        this.decoder.decode(chunk);",
  "label: 'VideoDecoder queue drain'",
  'decoder queue watchdog',
);

ensureReplace(
  "      while (this.encoder.encodeQueueSize >= this.maxQueueSize) await waitForQueue(this.encoder, signal);\n      this.encoder.encode(frame, { keyFrame });",
  "      await waitForQueueBelow(this.encoder, this.maxQueueSize, signal, {\n        label: 'VideoEncoder queue drain',\n        onTimeout: () => safeCloseCodec(this, 'encoder'),\n      });\n      this.encoder.encode(frame, { keyFrame });",
  "label: 'VideoEncoder queue drain'",
  'encoder queue watchdog',
);

ensureReplace(
  "async function waitForQueue(codec, signal) {\n",
  `async function waitForQueueBelow(codec, maxQueueSize, signal, { label = 'WebCodecs queue drain', onTimeout = null } = {}) {\n  return withHardTimeout(async () => {\n    while (codecQueueSize(codec) >= maxQueueSize) {\n      abortIfNeeded(signal);\n      if (!codec || codec.state !== 'configured') {\n        throw new BarsaError('WEBCODECS_QUEUE_UNAVAILABLE', \`\${label} stopped because codec is not configured\`, { recoverable: true });\n      }\n      await waitForQueue(codec, signal);\n    }\n  }, {\n    timeoutMs: QUEUE_STALL_TIMEOUT_MS,\n    label,\n    signal,\n    onTimeout,\n  });\n}\n\nfunction codecQueueSize(codec) {\n  const value = codec?.encodeQueueSize ?? codec?.decodeQueueSize ?? 0;\n  return Math.max(0, Number(value) || 0);\n}\n\nasync function waitForQueue(codec, signal) {\n`,
  'async function waitForQueueBelow(codec, maxQueueSize, signal',
  'queue drain helper',
);

await writeFile(path, source);
console.log('WebCodecs queue stall watchdog applied.');
