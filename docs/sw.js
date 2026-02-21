const CACHE = 'gruzchik-svo-v3';
const STATIC = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/logo.jpg'
];

// Install — кешируем статику
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC))
  );
  self.skipWaiting();
});

// Activate — удаляем старые кеши
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network-first для данных, cache-first для статики
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // JSON-данные (посты) — сначала сеть, при ошибке — кеш
  if (url.pathname.includes('/data/') || url.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Статика — сначала кеш, при промахе — сеть с записью
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(request, clone));
        return response;
      });
    })
  );
});
