// Офлайн-режим «Слов»: приложение открывается и без интернета.
// Страница, код и список слов — сначала из сети (обновления приходят сразу), без сети — из кэша.
// Файлы озвучки не меняются, поэтому их берём из кэша, а если там нет — из сети.
const CACHE = 'slova-v1';
const SHELL = [
  './',
  'index.html',
  'app.js',
  'srs.js',
  'style.css',
  'manifest.webmanifest',
  'words.json',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(url.pathname.includes('/audio/') ? cacheFirst(request) : networkFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  url.search = '';
  const key = request.mode === 'navigate' ? new URL('./', self.registration.scope).href : url.href;
  const network = fetch(url.href, { cache: 'no-cache' }).then((response) => {
    if (response.ok) cache.put(key, response.clone());
    return response;
  });
  const cached = await cache.match(key);
  if (!cached) return network;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS));
  return Promise.race([network.catch(() => cached), timeout]);
}
