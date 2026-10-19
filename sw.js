// Service worker: app funciona sem internet e guarda os blocos de mapa já vistos.
const VERSION = 'v5';
const SHELL = `shell-${VERSION}`;
const TILES = 'tiles-v2';        // blocos vistos durante o uso (podado)
const OFFLINE = 'tiles-offline'; // blocos baixados de propósito (não podado)
const MAX_TILES = 3000;
const ASSETS = [
  './', 'index.html', 'manual.html', 'manual.pdf', 'style.css', 'app.js', 'geo.js', 'proj.js', 'zip.js', 'formats.js', 'offline.js', 'sync.js',
  'firebase-config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.15.0/proj4.js'
];
const TILE_HOSTS = ['server.arcgisonline.com', 'tile.openstreetmap.org', 'tile.opentopomap.org'];
const CACHEABLE_HOSTS = ['cdnjs.cloudflare.com', 'www.gstatic.com'];
const NO_CACHE_HOSTS = ['nominatim.openstreetmap.org', 'api.github.com', 'gist.githubusercontent.com',
  'firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // a v1 guardava blocos em modo opaco; com crossOrigin ligado eles não servem mais
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => (k.startsWith('shell-') && k !== SHELL) || (k.startsWith('tiles-v') && k !== TILES)).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

let trimming = false;
async function trimTiles() {
  if (trimming) return;
  trimming = true;
  try {
    const c = await caches.open(TILES);
    const keys = await c.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
  } finally { trimming = false; }
}

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (NO_CACHE_HOSTS.some(h => url.hostname === h)) return;
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    // mapa: cache primeiro (baixados e vistos), rede quando não houver
    e.respondWith((async () => {
      const hit = (await caches.match(req.url, { cacheName: OFFLINE })) || (await caches.match(req.url, { cacheName: TILES }));
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type !== 'opaque') {
        const copy = res.clone();
        caches.open(TILES).then(c => c.put(req.url, copy)).then(trimTiles);
      }
      return res;
    })());
    return;
  }
  if (url.origin !== location.origin && !CACHEABLE_HOSTS.includes(url.hostname)) return;
  // app: rede primeiro (pega atualizações), cache se offline ou se a rede demorar mais de 4 s
  e.respondWith((async () => {
    const net = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
      return res;
    });
    try {
      return await Promise.race([net, timeout(4000)]);
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const idx = await caches.match('index.html'); if (idx) return idx; }
      return net; // sem cópia guardada: espera a rede, mesmo lenta
    }
  })());
});
