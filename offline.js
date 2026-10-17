// Download de blocos de mapa da área visível para uso sem internet.
// Os blocos vão para o cache 'tiles-offline', que o service worker consulta antes da rede
// e que não é podado automaticamente (o usuário apaga quando quiser).
(function (root) {
  'use strict';
  const CACHE = 'tiles-offline';
  const MAX_TILES = 4000;
  const CONCURRENCY = 6;

  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
  const lat2y = (lat, z) => {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
  };

  function tileList(bounds, zMin, zMax, templates) {
    const out = [];
    for (let z = zMin; z <= zMax; z++) {
      const n = 2 ** z;
      const x0 = Math.max(0, lon2x(bounds.getWest(), z)), x1 = Math.min(n - 1, lon2x(bounds.getEast(), z));
      const y0 = Math.max(0, lat2y(bounds.getNorth(), z)), y1 = Math.min(n - 1, lat2y(bounds.getSouth(), z));
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        templates.forEach(t => out.push(t.replace('{z}', z).replace('{x}', x).replace('{y}', y)));
      }
    }
    return out;
  }
  function count(bounds, zMin, zMax, nLayers) {
    let c = 0;
    for (let z = zMin; z <= zMax; z++) {
      const n = 2 ** z;
      const dx = Math.min(n - 1, lon2x(bounds.getEast(), z)) - Math.max(0, lon2x(bounds.getWest(), z)) + 1;
      const dy = Math.min(n - 1, lat2y(bounds.getSouth(), z)) - Math.max(0, lat2y(bounds.getNorth(), z)) + 1;
      c += dx * dy;
    }
    return c * nLayers;
  }

  let cancel = false;
  async function download(urls, onProgress) {
    cancel = false;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const cache = await caches.open(CACHE);
    let done = 0, failed = 0, i = 0;
    async function worker() {
      while (i < urls.length && !cancel) {
        const url = urls[i++];
        try {
          if (!(await cache.match(url))) {
            const res = await fetch(url, { mode: 'cors' });
            if (res.ok) await cache.put(url, res); else failed++;
          }
        } catch (e) { failed++; }
        done++;
        onProgress(done, urls.length, failed);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { done, failed, cancelled: cancel };
  }

  async function info() {
    let tiles = 0;
    try { tiles = (await (await caches.open(CACHE)).keys()).length; } catch (e) { /* sem cache */ }
    let usage = null, quota = null;
    try { const e = await navigator.storage.estimate(); usage = e.usage; quota = e.quota; } catch (e) { /* indisponível */ }
    return { tiles, usage, quota };
  }
  async function clear() { await caches.delete(CACHE); }

  root.Offline = { tileList, count, download, info, clear, stop: () => { cancel = true; }, MAX_TILES };
})(window);
