/* Service worker - offline caching for the PWA shell + read-only API caching */
const CACHE = 'sbrms-v24';
const SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/icons.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/pages.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return; // never cache writes

  const url = new URL(request.url);

  // API GET requests: network-first, fall back to cache (offline viewing)
  if (url.pathname.startsWith('/api/')) {
    // Don't cache auth or exports
    if (url.pathname.startsWith('/api/auth') || url.pathname.includes('/export')) return;
    e.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return resp;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App shell / static: cache-first
  e.respondWith(
    caches.match(request).then((cached) =>
      cached ||
      fetch(request).then((resp) => {
        if (resp.ok && (request.destination === 'script' || request.destination === 'style' || request.destination === 'document')) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return resp;
      }).catch(() => caches.match('/index.html'))
    )
  );
});

// Push notification ready
self.addEventListener('push', (e) => {
  let data = { title: 'Route Management', body: 'You have a new notification.' };
  try { if (e.data) data = e.data.json(); } catch (_) {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
