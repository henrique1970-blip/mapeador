// Fotos das medições, guardadas só neste aparelho (IndexedDB). Não vão na sincronização: viajam no KMZ e no PDF.
// Registro: { id, itemId, created, caption, lat, lng, blob (JPEG até 1600 px), thumb (JPEG 320 px) }
(function (root) {
  'use strict';
  const DB = 'mapeador-fotos', ST = 'fotos', MAX = 1600, THUMB = 320;
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((ok, fail) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id' }).createIndex('item', 'itemId');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => { dbp = null; fail(r.error); };
    });
    return dbp;
  }
  async function run(mode, fn) {
    const d = await db();
    return new Promise((ok, fail) => {
      const tx = d.transaction(ST, mode), st = tx.objectStore(ST);
      let out;
      const req = fn(st);
      if (req) req.onsuccess = () => { out = req.result; };
      tx.oncomplete = () => ok(out);
      tx.onerror = tx.onabort = () => fail(tx.error || new Error('IndexedDB'));
    });
  }
  // reduz e regrava em JPEG (já aplica a rotação do EXIF e descarta os metadados)
  async function shrink(src, max, q) {
    let bmp;
    try { bmp = await createImageBitmap(src, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(src); }
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return new Promise((ok, fail) => c.toBlob(b => b ? ok(b) : fail(new Error('imagem')), 'image/jpeg', q));
  }
  async function add(itemId, file, extra) {
    const blob = await shrink(file, MAX, 0.82), thumb = await shrink(blob, THUMB, 0.75);
    const rec = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), itemId,
      created: new Date().toISOString(), caption: '' }, extra || {}, { blob, thumb });
    await run('readwrite', st => st.put(rec));
    return rec;
  }
  const list = itemId => run('readonly', st => st.index('item').getAll(itemId))
    .then(a => (a || []).sort((x, y) => x.created < y.created ? -1 : 1));
  const get = id => run('readonly', st => st.get(id));
  async function update(id, patch) {
    const r = await get(id);
    if (r) await run('readwrite', st => st.put(Object.assign(r, patch)));
  }
  const del = id => run('readwrite', st => st.delete(id));
  async function delItem(itemId) {
    const a = await list(itemId);
    await run('readwrite', st => { a.forEach(r => st.delete(r.id)); });
  }
  // contagem por medição, para os botões
  async function counts() {
    const all = await run('readonly', st => st.getAll());
    const c = {};
    (all || []).forEach(r => { c[r.itemId] = (c[r.itemId] || 0) + 1; });
    return c;
  }
  // apaga as fotos das medições excluídas (as marcas de exclusão chegam também de outros aparelhos)
  async function prune(deletedIds) {
    const del = new Set(deletedIds), all = await run('readonly', st => st.getAll());
    const gone = (all || []).filter(r => del.has(r.itemId));
    if (gone.length) await run('readwrite', st => { gone.forEach(r => st.delete(r.id)); });
    return gone.length;
  }
  root.Photos = { add, list, get, update, del, delItem, counts, prune, available: () => typeof indexedDB !== 'undefined' };
})(this);
