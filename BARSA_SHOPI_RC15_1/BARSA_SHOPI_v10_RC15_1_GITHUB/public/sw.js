const CACHE = 'video-toolkit-pro-shell-v4-3';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('video-toolkit-pro-shell') && key !== CACHE).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return withIsolationHeaders(cached);
    const response = await fetch(event.request);
    const durableAsset = ['script', 'style', 'document', 'worker', 'wasm'].includes(event.request.destination)
      || url.pathname.includes('/models/') || url.pathname.includes('/vendor/');
    if (response.ok && durableAsset) {
      const cache = await caches.open(CACHE);
      cache.put(event.request, response.clone()).catch(() => {});
    }
    return withIsolationHeaders(response);
  })());
});

/**
 * Static hosts such as GitHub Pages cannot configure COOP/COEP response
 * headers. Once this service worker controls the page, it adds them to every
 * same-origin response so SharedArrayBuffer and FFmpeg multithreading can be
 * enabled after the one-time activation reload.
 */
function withIsolationHeaders(response) {
  if (!response || response.type === 'opaque') return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
