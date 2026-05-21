const CACHE_NAME = 'comformation-v11';
let appURL = '';

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SET_URL') {
    appURL = e.data.url;
    /* Met en cache l'URL de l'app immédiatement */
    caches.open(CACHE_NAME).then(c => c.add(appURL)).catch(()=>{});
  }
});

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const external = [
        'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap',
        'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
      ];
      for (const url of external) {
        try { await cache.add(url); } catch(_) {}
      }
    })()
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  /* Stratégie : Cache-first pour fonts/JS externes, Network-first pour l'app */
  const isExternal = url.origin !== self.location.origin ||
                     url.hostname === 'fonts.googleapis.com' ||
                     url.hostname === 'fonts.gstatic.com' ||
                     url.hostname === 'cdnjs.cloudflare.com';
  if (isExternal) {
    /* Cache-first pour ressources externes */
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return resp;
        }).catch(() => cached);
      })
    );
  } else {
    /* Network-first pour l'app principale (données toujours fraîches) */
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request))
    );
  }
});
