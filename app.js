// Mapeador de Áreas — medição de área, distância e pontos sobre o mapa, com GPS.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const KEY = 'mapeador.v1';

  // ---------- Unidades ----------
  const AREA_UNITS = {
    ha: { label: 'hectares', short: 'ha', f: 1e4, d: 4 },
    m2: { label: 'metros quadrados', short: 'm²', f: 1, d: 1 },
    km2: { label: 'quilômetros quadrados', short: 'km²', f: 1e6, d: 4 },
    alqsp: { label: 'alqueire paulista (24.200 m²)', short: 'alq. SP', f: 24200, d: 4 },
    alqmg: { label: 'alqueire mineiro/goiano (48.400 m²)', short: 'alq. MG', f: 48400, d: 4 },
    ac: { label: 'acres', short: 'ac', f: 4046.8564224, d: 4 }
  };
  const LEN_UNITS = {
    m: { label: 'metros', short: 'm', f: 1, d: 1 },
    km: { label: 'quilômetros', short: 'km', f: 1000, d: 3 },
    mi: { label: 'milhas', short: 'mi', f: 1609.344, d: 3 },
    ft: { label: 'pés', short: 'ft', f: 0.3048, d: 0 }
  };
  const COLORS = ['#ffeb3b', '#ff9800', '#e53935', '#ec407a', '#ab47bc', '#3f51b5', '#29b6f6', '#26a69a', '#66bb6a', '#ffffff'];
  const TYPE_LABEL = { area: 'Área', distance: 'Distância', poi: 'Ponto' };
  const TYPE_COLOR = { area: '#ffeb3b', distance: '#29b6f6', poi: '#e53935' };

  const nf = (v, d) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtArea = (m2, u) => nf(m2 / AREA_UNITS[u].f, AREA_UNITS[u].d) + ' ' + AREA_UNITS[u].short;
  const fmtLen = (m, u) => nf(m / LEN_UNITS[u].f, LEN_UNITS[u].d) + ' ' + LEN_UNITS[u].short;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- Armazenamento ----------
  const defaults = { areaUnit: 'ha', lenUnit: 'm', layer: 'hybrid', labels: true, gpsMinDist: 5, gpsMaxAcc: 25,
    gpsStraight: 1, gpsOffset: 0, gpsOffSide: 'r', coordFmt: 'dd', datum: 'sirgas', view: null };
  // deleted: marcas de exclusão {id, updated}, para a exclusão chegar aos outros aparelhos
  let store = { items: [], deleted: [], settings: Object.assign({}, defaults) };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      store.items = Array.isArray(s.items) ? s.items : [];
      store.deleted = Array.isArray(s.deleted) ? s.deleted : [];
      store.settings = Object.assign({}, defaults, s.settings || {});
    }
  } catch (e) { /* sem armazenamento: segue em memória */ }
  // a configuração de sync guarda o token do Gist: fica em chave própria, fora do backup exportado
  const SYNC_KEY = 'mapeador.sync';
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { toast('Não foi possível salvar neste aparelho. Exporte suas medições.'); }
  }
  // grava e avisa o sync (só quando as medições mudaram)
  function persistItems() { persist(); Sync.schedule(); }
  const S = store.settings;

  // buracos válidos de uma área (anéis com 3+ vértices); a área desconta os buracos, o perímetro é só o do contorno
  const holesOf = m => m.type === 'area' && Array.isArray(m.holes) ? m.holes.filter(h => h && h.length >= 3) : [];
  const netArea = m => Math.max(0, Geo.area(m.points) - holesOf(m).reduce((t, h) => t + Geo.area(h), 0));
  function measure(m) {
    if (m.type === 'area') {
      const a = netArea(m);
      return { area_m2: +a.toFixed(2), area_ha: +(a / 1e4).toFixed(6), length_m: +Geo.length(m.points, true).toFixed(2) };
    }
    if (m.type === 'distance') return { length_m: +Geo.length(m.points, false).toFixed(2) };
    return {};
  }
  function describe(m) {
    if (!m.points.length) return '';
    if (m.type === 'area') {
      const v = measure(m);
      return `${fmtArea(v.area_m2, S.areaUnit)} · perímetro ${fmtLen(v.length_m, S.lenUnit)}`;
    }
    if (m.type === 'distance') return fmtLen(measure(m).length_m, S.lenUnit);
    return fmtLL(m.points[0]);
  }
  // ---------- Coordenadas ----------
  const COORD_FMTS = {
    dd: { label: 'Graus decimais (-19.923456)' },
    ddm: { label: 'Graus e minutos (19° 55,4074′ S)' },
    dms: { label: 'Graus, minutos e segundos (19° 55′ 24,44″ S)' }
  };
  // arredonda no total (segundos ou minutos) para não gerar 60″ ou 60′
  function fmtDeg(v, pos, neg) {
    const h = v < 0 ? neg : pos, a = Math.abs(v);
    if (S.coordFmt === 'ddm') {
      const tm = Math.round(a * 60 * 1e4) / 1e4, d = Math.floor(tm / 60);
      return `${d}° ${nf(tm - d * 60, 4)}′ ${h}`;
    }
    const ts = Math.round(a * 3600 * 100) / 100, d = Math.floor(ts / 3600), mi = Math.floor((ts - d * 3600) / 60);
    return `${d}° ${String(mi).padStart(2, '0')}′ ${nf(ts - d * 3600 - mi * 60, 2).padStart(5, '0')}″ ${h}`;
  }
  function fmtLL(p) {
    if (S.coordFmt !== 'ddm' && S.coordFmt !== 'dms') return `${p[0].toFixed(6)}, ${p[1].toFixed(6)}`;
    return `${fmtDeg(p[0], 'N', 'S')}  ${fmtDeg(p[1], 'L', 'O')}`;
  }
  // "19°55'24.4"S 43°56'W" → [lat, lon]; hemisfério em português (L/O) ou inglês (E/W)
  function parseDMSPair(q) {
    const num = '(\\d+(?:[.,]\\d+)?)';
    const re = new RegExp(`${num}\\s*[°º]\\s*(?:${num}\\s*['′’]\\s*)?(?:${num}\\s*(?:["″”]|''|′′)\\s*)?([NSLOEW])`, 'gi');
    let lat = null, lon = null, m;
    while ((m = re.exec(q))) {
      const v = [m[1], m[2], m[3]].map(x => x ? parseFloat(x.replace(',', '.')) : 0);
      const h = m[4].toUpperCase();
      const dec = (v[0] + v[1] / 60 + v[2] / 3600) * (/[SOW]/.test(h) ? -1 : 1);
      if (/[NS]/.test(h)) lat = dec; else lon = dec;
    }
    return lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
  }
  // UTM no datum escolhido; SIRGAS 2000 = WGS84 dentro de centímetros, então dispensa o proj4
  function utmOf(p) {
    return S.datum === 'sirgas' || !window.Proj ? Geo.toUTM(p[0], p[1]) : Proj.toUTM(p, S.datum);
  }
  function utmText(p) {
    const u = utmOf(p);
    return `UTM ${u.zone}${u.hemisphere}${S.datum === 'sirgas' ? '' : ' ' + Proj.DATUMS[S.datum].label}  E ${nf(u.easting, 1)}  N ${nf(u.northing, 1)}`;
  }
  // "23S 345678 8190000" (fuso, E, N) → [lat, lon] no datum das configurações. Sem letra: hemisfério sul.
  // A letra S é lida como sul (costume no Brasil), embora na grade UTM seja uma faixa do norte.
  function parseUTM(q) {
    const m = q.match(/^\s*(?:fuso\s*)?(\d{1,2})\s*([A-Za-z])?\s*[,;\s]\s*(?:E\s*[:=]?\s*)?(\d{5,8}(?:[.,]\d+)?)\s*(?:m\s*)?(?:E\b)?\s*[,;\s]\s*(?:N\s*[:=]?\s*)?(\d{5,8}(?:[.,]\d+)?)\s*(?:m\s*)?N?\s*$/i);
    if (!m || !window.Proj) return null;
    const zone = +m[1], L = (m[2] || 'S').toUpperCase();
    const e = parseFloat(m[3].replace(',', '.')), n = parseFloat(m[4].replace(',', '.'));
    if (zone < 1 || zone > 60 || e < 100000 || e > 900000 || n < 0 || n > 10000000) return null;
    const south = L === 'S' || (L >= 'C' && L <= 'M');
    const ll = Proj.fromUTM(zone, south, e, n, S.datum);
    return isFinite(ll[0]) && isFinite(ll[1]) ? ll : null;
  }

  // ---------- Mapa ----------
  const map = L.map('map', {
    zoomControl: false, doubleClickZoom: true, maxZoom: 21,
    center: S.view ? S.view.c : [-15.8, -47.9], zoom: S.view ? S.view.z : 4
  });
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  if (window.matchMedia('(pointer: fine)').matches) L.control.zoom({ position: 'topright' }).addTo(map);

  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  const esriAttr = 'Imagens © Esri, Maxar, Earthstar Geographics';
  // crossOrigin: o service worker guarda respostas legíveis (opacas estourariam a cota do navegador)
  const tl = (url, o) => L.tileLayer(url, Object.assign({ maxNativeZoom: 19, maxZoom: 21, crossOrigin: true }, o));
  const ESRI_SAT = esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const ESRI_ROADS = esri + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
  const ESRI_PLACES = esri + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
  // Onde a Esri não tem imagem no zoom pedido (comum em área rural acima do 17), ela devolve um bloco cinza
  // "Map data not yet available". O serviço tilemap diz onde há imagem; o bloco sem imagem é desenhado
  // ampliando o ancestral mais próximo que tem.
  const ESRI_TILEMAP = esri + 'World_Imagery/MapServer/tilemap/';
  const TM = 16; // blocos de disponibilidade 16×16 alinhados: o download offline pede as mesmas URLs
  const tmCache = new Map();
  function tmBlock(z, y, x) {
    const key = `${z}/${Math.floor(y / TM) * TM}/${Math.floor(x / TM) * TM}`;
    if (!tmCache.has(key)) {
      tmCache.set(key, fetch(`${ESRI_TILEMAP}${key}/${TM}/${TM}`, { mode: 'cors' })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
        .then(j => { if (!j) tmCache.delete(key); return j; })); // sem rede: tenta de novo depois
    }
    return tmCache.get(key);
  }
  // true / false, ou null quando não dá para saber (sem rede, resposta estranha)
  async function hasImagery(z, y, x) {
    const j = await tmBlock(z, y, x);
    if (!j || !j.valid || !Array.isArray(j.data) || !j.location) return null;
    const c = x - j.location.left, r = y - j.location.top;
    if (c < 0 || r < 0 || c >= j.location.width || r >= j.location.height) return null;
    const v = j.data[r * j.location.width + c];
    return v == null ? null : !!v;
  }
  function loadImg(url) {
    return new Promise((ok, fail) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => ok(img);
      img.onerror = () => fail(new Error('tile'));
      img.src = url;
    });
  }
  const EsriSat = L.GridLayer.extend({
    createTile(c, done) {
      const tile = document.createElement('canvas');
      tile.width = tile.height = 256;
      this._fill(c, tile).then(() => done(null, tile), err => done(err, tile));
      return tile;
    },
    async _fill(c, tile) {
      const t = await satCrop(c.z, c.x, c.y);
      tile.getContext('2d').drawImage(t.img, t.sx, t.sy, t.sw, t.sw, 0, 0, 256, 256);
      tile.dataset.z = t.z; // zoom de onde a imagem veio (usado nos testes)
    }
  });
  // recorte do bloco de satélite: desce no máximo 6 níveis (ampliação de 64×) atrás de imagem; "não sei" conta como "tem"
  async function satCrop(cz, cx, cy) {
    let z = Math.min(cz, 19);
    for (let k = 0; k < 6 && z > 1; k++) {
      const s = 2 ** (cz - z);
      if ((await hasImagery(z, Math.floor(cy / s), Math.floor(cx / s))) !== false) break;
      z--;
    }
    const s = 2 ** (cz - z), ax = Math.floor(cx / s), ay = Math.floor(cy / s), w = 256 / s;
    const img = await loadImg(ESRI_SAT.replace('{z}', z).replace('{y}', ay).replace('{x}', ax));
    return { img, sx: (cx - ax * s) * w, sy: (cy - ay * s) * w, sw: w, z };
  }
  // bloco de um modelo de URL comum, ampliando o ancestral acima do zoom nativo
  const urlCrop = (tpl, maxNative, subs) => async (cz, cx, cy) => {
    const z = Math.min(cz, maxNative), s = 2 ** (cz - z), ax = Math.floor(cx / s), ay = Math.floor(cy / s), w = 256 / s;
    const url = tpl.replace('{s}', subs ? subs[(ax + ay) % subs.length] : '').replace('{z}', z).replace('{y}', ay).replace('{x}', ax);
    return { img: await loadImg(url), sx: (cx - ax * s) * w, sy: (cy - ay * s) * w, sw: w };
  };
  const sat = () => new EsriSat({ maxZoom: 21, attribution: esriAttr });
  // offline: só as camadas cujo provedor não proíbe download em lote (OSM e OpenTopoMap proíbem)
  // img: camadas para a imagem exportada (JPG e PDF), com a atribuição que os provedores exigem
  const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', OSM_ATTR = '© colaboradores do OpenStreetMap';
  const TOPO_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', TOPO_ATTR = '© OpenStreetMap, SRTM · estilo © OpenTopoMap (CC-BY-SA)';
  const BASES = {
    hybrid: { label: 'Satélite com nomes', offline: [ESRI_SAT, ESRI_ROADS, ESRI_PLACES],
      make: () => L.layerGroup([sat(), tl(ESRI_ROADS), tl(ESRI_PLACES)]),
      img: () => [satCrop, urlCrop(ESRI_ROADS, 19), urlCrop(ESRI_PLACES, 19)], attr: esriAttr },
    sat: { label: 'Satélite', offline: [ESRI_SAT], make: sat, img: () => [satCrop], attr: esriAttr },
    osm: { label: 'Ruas (OpenStreetMap)', make: () => tl(OSM_URL, { attribution: OSM_ATTR }),
      img: () => [urlCrop(OSM_URL, 19)], attr: OSM_ATTR },
    topo: { label: 'Topográfico (OpenTopoMap)', make: () => tl(TOPO_URL, { maxNativeZoom: 17, subdomains: 'abc', attribution: TOPO_ATTR }),
      img: () => [urlCrop(TOPO_URL, 17, 'abc')], attr: TOPO_ATTR }
  };
  let baseLayer = null;
  function setBase(key) {
    if (!BASES[key]) key = 'hybrid';
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = BASES[key].make().addTo(map);
    S.layer = key;
  }
  setBase(S.layer);
  map.on('moveend', () => { S.view = { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() }; persist(); });

  const savedLayer = L.layerGroup().addTo(map);
  const editLayer = L.layerGroup().addTo(map);
  let selectedId = null;

  // ---------- Interface auxiliar ----------
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  // actions: [{ label, cls, onClick }] — onClick devolve false para manter aberto
  function modal(title, html, actions) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = html;
    const box = $('modalActions');
    box.innerHTML = '';
    actions.forEach(a => {
      const b = document.createElement('button');
      b.className = 'tool ' + (a.cls || '');
      b.textContent = a.label;
      b.onclick = () => { if (!a.onClick || a.onClick() !== false) closeModal(); };
      box.appendChild(b);
    });
    $('modal').hidden = false;
  }
  function closeModal() { $('modal').hidden = true; }
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

  function confirmBox(title, text, okLabel, onOk, danger) {
    modal(title, `<p>${esc(text)}</p>`, [
      { label: 'Cancelar', cls: 'ghost' },
      { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: onOk }
    ]);
  }

  // ---------- Medições salvas ----------
  function shapeFor(m, opts) {
    const c = m.color || TYPE_COLOR[m.type];
    const sel = opts && opts.selected;
    if (m.type === 'area') return L.polygon([m.points].concat(holesOf(m)), { color: c, weight: sel ? 5 : 3, fillOpacity: sel ? 0.35 : 0.22 });
    if (m.type === 'distance') return L.polyline(m.points, { color: c, weight: sel ? 6 : 4 });
    return L.marker(m.points[0], { icon: L.divIcon({ className: 'poi-pin', html: `<div style="background:${c}"></div>` }) });
  }
  function renderSaved() {
    savedLayer.clearLayers();
    store.items.forEach(m => {
      if (cur && cur.editingId === m.id) return;
      if (!m.points.length) return;
      const lyr = shapeFor(m, { selected: m.id === selectedId });
      if (S.labels) {
        const txt = m.type === 'poi' ? m.name : `${m.name}<br>${describe(m).split(' · ')[0]}`;
        lyr.bindTooltip(txt, { permanent: true, direction: m.type === 'poi' ? 'top' : 'center', className: 'lbl',
          offset: m.type === 'poi' ? [0, -20] : [0, 0] });
      }
      lyr.on('click', e => {
        if (cur) return; // durante a edição o toque vai para o mapa
        L.DomEvent.stop(e);
        selectItem(m.id);
      });
      lyr.addTo(savedLayer);
    });
  }
  function selectItem(id, fit) {
    selectedId = id;
    const m = store.items.find(x => x.id === id);
    renderSaved();
    if (!m) { showInfo(false); return; }
    $('infoGroup').textContent = TYPE_LABEL[m.type] + (m.group ? ' · ' + m.group : '');
    $('infoName').textContent = m.name;
    if (m.type === 'area') {
      const v = measure(m);
      $('infoValue').textContent = fmtArea(v.area_m2, S.areaUnit);
      const nh = holesOf(m).length;
      $('infoSub').textContent = `${otherAreas(v.area_m2)} · perímetro ${fmtLen(v.length_m, S.lenUnit)} · ${m.points.length} vértices` +
        (nh ? ` · ${nh} buraco${nh > 1 ? 's' : ''} descontado${nh > 1 ? 's' : ''}` : '');
    } else if (m.type === 'distance') {
      $('infoValue').textContent = fmtLen(measure(m).length_m, S.lenUnit);
      $('infoSub').textContent = `${m.points.length} pontos`;
    } else {
      const p = m.points[0];
      $('infoValue').textContent = fmtLL(p);
      $('infoSub').textContent = utmText(p);
    }
    $('infoNotes').textContent = m.notes || '';
    $('btnInfoPhotos').textContent = '📷';
    Photos.list(m.id).then(a => { if (selectedId === m.id && a.length) $('btnInfoPhotos').textContent = `📷 ${a.length}`; }).catch(() => {});
    showInfo(true);
    if (fit) fitItem(m);
  }
  function showInfo(v) { $('infoPanel').hidden = !v; $('fabWrap').hidden = v || !!cur; }
  function otherAreas(m2) {
    return ['ha', 'm2', 'alqsp', 'alqmg'].filter(u => u !== S.areaUnit).slice(0, 2).map(u => fmtArea(m2, u)).join(' · ');
  }
  function fitItem(m) {
    if (m.type === 'poi') map.setView(m.points[0], Math.max(map.getZoom(), 17));
    else map.fitBounds(L.latLngBounds(m.points), { padding: [40, 40], maxZoom: 19 });
  }
  map.on('click', () => { if (!cur && selectedId) { selectedId = null; showInfo(false); renderSaved(); } });

  $('btnInfoClose').onclick = () => { selectedId = null; showInfo(false); renderSaved(); };
  $('btnInfoDelete').onclick = () => {
    const m = store.items.find(x => x.id === selectedId);
    if (!m) return;
    confirmBox('Excluir medição', `Excluir "${m.name}"? Não dá para desfazer.`, 'Excluir', () => {
      store.items = store.items.filter(x => x.id !== m.id);
      store.deleted.push({ id: m.id, updated: new Date().toISOString() });
      persistItems(); selectedId = null; showInfo(false); renderSaved(); renderList();
      Photos.delItem(m.id).catch(() => {});
      toast('Medição excluída');
    }, true);
  };
  // ---------- Fotos ----------
  // URLs de objeto da galeria aberta (liberadas ao trocar de tela)
  let photoUrls = [];
  const freeUrls = () => { photoUrls.forEach(u => URL.revokeObjectURL(u)); photoUrls = []; };
  const objUrl = b => { const u = URL.createObjectURL(b); photoUrls.push(u); return u; };
  async function openPhotos(id) {
    const m = store.items.find(x => x.id === id);
    if (!m) return;
    let list = [];
    try { list = await Photos.list(id); } catch (e) { return toast('Este navegador não deixa guardar fotos'); }
    freeUrls();
    modal(`Fotos · ${esc(m.name)}`, `
      ${list.length ? `<div class="photo-grid">${list.map(r => `<button data-ph="${r.id}" aria-label="Abrir foto"><img src="${objUrl(r.thumb)}" alt=""></button>`).join('')}</div>`
        : '<p style="color:var(--muted)">Nenhuma foto ainda.</p>'}
      <p style="color:var(--muted);font-size:12px;margin:4px 0 0">As fotos ficam só neste aparelho. Elas vão junto no relatório PDF e no KMZ exportado (que leva as fotos para outro aparelho).</p>
      <input type="file" id="photoInput" accept="image/*" multiple hidden>`,
    [{ label: 'Fechar', cls: 'ghost', onClick: freeUrls }, { label: '＋ Adicionar foto', cls: 'primary', onClick: () => { $('photoInput').click(); return false; } }]);
    $('modalBody').querySelectorAll('[data-ph]').forEach(b => b.onclick = () => openPhoto(id, b.dataset.ph));
    $('photoInput').onchange = async e => {
      const files = [...e.target.files];
      if (!files.length) return;
      toast(`Guardando ${files.length} foto(s)…`, 20000);
      // posição da foto: o GPS, se estiver ligado e recente
      const where = lastFix && Date.now() - lastFix.t < 60000 ? { lat: lastFix.ll[0], lng: lastFix.ll[1] } : {};
      let ok = 0;
      for (const f of files) { try { await Photos.add(id, f, where); ok++; } catch (err) { /* arquivo que não é imagem */ } }
      toast(ok ? `${ok} foto(s) guardada(s)` : 'Não foi possível ler a imagem');
      openPhotos(id);
      if (selectedId === id) selectItem(id);
    };
  }
  async function openPhoto(id, phId) {
    const r = await Photos.get(phId);
    if (!r) return openPhotos(id);
    freeUrls();
    const when = new Date(r.created).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const canShare = !!(navigator.canShare && navigator.share);
    const keep = () => Photos.update(phId, { caption: $('phCap').value.trim() });
    modal('Foto', `
      <img class="photo-view" src="${objUrl(r.blob)}" alt="">
      <p style="color:var(--muted);font-size:12px;margin:6px 0 0">${when}${r.lat != null ? ' · ' + esc(fmtLL([r.lat, r.lng])) : ''}</p>
      <label for="phCap">Legenda</label><input id="phCap" value="${esc(r.caption)}" placeholder="ex.: porteira norte">`,
    [{ label: 'Apagar', cls: 'danger', onClick: () => {
      confirmBox('Apagar foto', 'Apagar esta foto? Não dá para desfazer.', 'Apagar', async () => {
        await Photos.del(phId); toast('Foto apagada'); openPhotos(id); if (selectedId === id) selectItem(id);
      }, true);
      return false;
    } }]
      .concat(canShare ? [{ label: 'Enviar', onClick: () => {
        keep();
        const file = new File([r.blob], `foto_${phId}.jpg`, { type: 'image/jpeg' });
        navigator.share({ files: [file] }).catch(() => {});
        return false;
      } }] : [])
      .concat([{ label: 'Voltar', cls: 'primary', onClick: () => { keep().then(() => openPhotos(id)); return false; } }]));
  }
  $('btnInfoPhotos').onclick = () => { if (selectedId) openPhotos(selectedId); };

  $('btnInfoEdit').onclick = () => {
    const m = store.items.find(x => x.id === selectedId);
    if (m) startDraw(m.type, m);
  };
  $('btnInfoShare').onclick = () => {
    const m = store.items.find(x => x.id === selectedId);
    if (m) exportDialog([m], m.name);
  };

  // ---------- Desenho / edição ----------
  // { item, editingId, original, history, future, sel, ring, mode, paused, aim, run, dirty, xf, cut, extra }
  // ring: -1 = contorno, n = buraco n. xf: modo mover/girar. cut: modo cortar ({ pts }). extra: peças cortadas a salvar.
  let cur = null;
  const ringPts = () => cur.ring >= 0 ? cur.item.holes[cur.ring] : cur.item.points;
  const copyRing = r => r.map(p => p.slice());

  function startDraw(type, existing) {
    closeFabMenu();
    showInfo(false);
    selectedId = null;
    const item = existing
      ? JSON.parse(JSON.stringify(existing))
      : { id: uid(), type, name: '', group: '', color: TYPE_COLOR[type], notes: '', points: [] };
    if (type === 'area') item.holes = Array.isArray(item.holes) ? item.holes : [];
    cur = { item, editingId: existing ? existing.id : null, original: null,
      history: [], future: [], sel: item.points.length - 1, ring: -1, mode: 'manual', paused: false, aim: false, run: null, dirty: false,
      xf: null, cut: null, extra: [] };
    if (existing) cur.original = stateNow();
    map.doubleClickZoom.disable();
    $('fabWrap').hidden = true;
    $('drawPanel').hidden = false;
    $('drawKind').textContent = (existing ? 'Editando · ' : 'Nova ') + TYPE_LABEL[type].toLowerCase();
    $('btnMode').hidden = $('btnMore').hidden = type === 'poi';
    $('btnReset').hidden = !existing;
    setMode('manual');
    setAim(false);
    renderSaved();
    redraw();
    if (existing) fitItem(existing);
  }
  function endDraw() {
    if (cur && cur.mode === 'gps') stopGpsRecording();
    cur = null;
    $('aim').hidden = true;
    $('ringBar').hidden = true;
    editLayer.clearLayers();
    map.doubleClickZoom.enable();
    $('drawPanel').hidden = true;
    $('fabWrap').hidden = false;
    renderSaved();
  }
  const stateNow = () => ({ points: copyRing(cur.item.points), holes: (cur.item.holes || []).map(copyRing),
    extra: cur.extra.map(e => ({ points: copyRing(e.points), holes: e.holes.map(copyRing) })), sel: cur.sel, ring: cur.ring });
  function snapshot() {
    cur.history.push(stateNow());
    if (cur.history.length > 200) cur.history.shift();
    cur.future = []; // alteração nova invalida o que foi desfeito
    cur.dirty = true;
  }
  function addPoint(latlng) {
    snapshot();
    const p = [latlng[0], latlng[1]];
    if (cur.item.type === 'poi') { cur.item.points = [p]; cur.sel = 0; }
    else {
      const pts = ringPts();
      const at = (cur.sel == null || cur.sel < 0) ? pts.length : cur.sel + 1;
      pts.splice(at, 0, p);
      cur.sel = at;
    }
    redraw();
  }

  const vtxIcon = (sel, first) => L.divIcon({ className: 'vtx' + (sel ? ' sel' : '') + (first ? ' first' : '') });
  const midIcon = L.divIcon({ className: 'mid' });

  function redraw() {
    editLayer.clearLayers();
    renderRingBar();
    const m = cur.item, pts = ringPts(), c = m.color || TYPE_COLOR[m.type];
    let shape = null, holeLine = null;
    // atualiza o desenho durante o arraste sem refazer as alças
    const live = () => {
      if (shape) shape.setLatLngs(m.type === 'area' && m.points.length >= 3 ? [m.points].concat(holesOf(m)) : m.points);
      if (holeLine) holeLine.setLatLngs(pts);
      updateDrawPanel();
    };
    if (m.type === 'area' && m.points.length >= 2) {
      shape = (m.points.length >= 3 ? L.polygon([m.points].concat(holesOf(m)), { color: c, weight: 3, fillOpacity: 0.25, interactive: false })
        : L.polyline(m.points, { color: c, weight: 3, interactive: false })).addTo(editLayer);
    } else if (m.type === 'distance' && m.points.length >= 2) {
      shape = L.polyline(m.points, { color: c, weight: 4, interactive: false }).addTo(editLayer);
    }
    // buraco em desenho (menos de 3 vértices ainda não entra no polígono) e anel ativo realçado
    if (cur.ring >= 0) holeLine = L.polyline(pts.length >= 3 ? pts.concat([pts[0]]) : pts, { color: '#fff', weight: 2, dashArray: '6 5', interactive: false }).addTo(editLayer);
    cur.extra.forEach((e, k) => {
      L.polygon([e.points].concat(e.holes), { color: c, weight: 3, dashArray: '8 6', fillOpacity: 0.12, interactive: false })
        .bindTooltip(`Peça ${k + 2}: ${fmtArea(netArea({ type: 'area', points: e.points, holes: e.holes }), S.areaUnit)}`, { permanent: true, direction: 'center', className: 'lbl' })
        .addTo(editLayer);
    });
    if (cur.xf) { drawXf(); updateDrawPanel(); return; }
    if (cur.cut) {
      cur.cut.pts.forEach(q => L.circleMarker(q, { radius: 6, color: '#fff', weight: 2, fillColor: '#e53935', fillOpacity: 1, interactive: false }).addTo(editLayer));
      updateDrawPanel();
      return;
    }
    if (m.type === 'poi') {
      if (pts.length) {
        const mk = L.marker(pts[0], { draggable: true, icon: L.divIcon({ className: 'poi-pin', html: `<div style="background:${c}"></div>` }) });
        mk.on('dragstart', snapshot);
        mk.on('drag', e => { pts[0] = [e.latlng.lat, e.latlng.lng]; updateDrawPanel(); });
        mk.addTo(editLayer);
      }
      updateDrawPanel();
      return;
    }
    // pontos do meio de cada lado: tocar ou arrastar insere vértice
    const closed = m.type === 'area' && pts.length >= 3;
    const nEdges = closed ? pts.length : pts.length - 1;
    const showLens = pts.length <= 40;
    for (let i = 0; i < nEdges; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const mk = L.marker(mid, { icon: midIcon, draggable: true, zIndexOffset: -100 });
      if (showLens) mk.bindTooltip(fmtLen(Geo.distance(a, b), S.lenUnit), { permanent: true, direction: 'top', offset: [0, -8], className: 'lbl' });
      let inserted = false;
      const insert = ll => { snapshot(); pts.splice(i + 1, 0, [ll.lat, ll.lng]); cur.sel = i + 1; inserted = true; };
      mk.on('click', e => { L.DomEvent.stop(e); insert(L.latLng(mid)); redraw(); });
      mk.on('dragstart', () => { insert(mk.getLatLng()); mk.unbindTooltip(); });
      mk.on('drag', e => { if (inserted) { pts[i + 1] = [e.latlng.lat, e.latlng.lng]; live(); } });
      mk.on('dragend', redraw);
      mk.addTo(editLayer);
    }
    pts.forEach((p, i) => {
      const mk = L.marker(p, { icon: vtxIcon(i === cur.sel, i === 0 && pts.length > 1), draggable: true, zIndexOffset: 100 });
      mk.on('click', e => { L.DomEvent.stop(e); cur.sel = i; redraw(); });
      mk.on('dragstart', () => { snapshot(); cur.sel = i; });
      mk.on('drag', e => { pts[i] = [e.latlng.lat, e.latlng.lng]; live(); });
      mk.on('dragend', redraw);
      mk.addTo(editLayer);
    });
    updateDrawPanel();
  }

  function updateDrawPanel() {
    const m = cur.item, pts = m.points, rp = m.type === 'poi' ? pts : ringPts();
    let val = '—', sub = '';
    if (m.type === 'area') {
      const a = pts.length >= 3 ? netArea(m) : 0;
      const per = Geo.length(pts, pts.length >= 3);
      const nh = holesOf(m).length;
      if (pts.length >= 3) {
        val = fmtArea(a, S.areaUnit);
        sub = `${otherAreas(a)} · perímetro ${fmtLen(per, S.lenUnit)}` + (nh ? ` · ${nh} buraco${nh > 1 ? 's' : ''}` : '') +
          (cur.extra.length ? ` · + ${cur.extra.length} peça${cur.extra.length > 1 ? 's' : ''}` : '');
      } else sub = pts.length ? `${pts.length} vértice(s) — faltam ${3 - pts.length}` : '';
      if (cur.ring >= 0 && rp.length < 3) sub = `Buraco ${cur.ring + 1}: ${rp.length} vértice(s) — faltam ${3 - rp.length}`;
    } else if (m.type === 'distance') {
      if (pts.length >= 2) { val = fmtLen(Geo.length(pts, false), S.lenUnit); sub = `${pts.length} pontos`; }
      else sub = pts.length ? 'Marque o próximo ponto' : '';
    } else if (pts.length) {
      val = fmtLL(pts[0]);
      sub = utmText(pts[0]);
    }
    $('drawValue').textContent = val;
    $('drawSub').textContent = sub;
    const sp = cur.xf || cur.cut ? null : rp[cur.sel];
    const vi = $('vertexInfo'), vt = $('vertexText');
    const vName = i => cur.ring >= 0 ? `vértice ${i + 1} do buraco ${cur.ring + 1}` : `vértice ${i + 1}`;
    if (cur.xf) {
      vi.hidden = false;
      vt.textContent = `Movido ${fmtLen(cur.xf.move, S.lenUnit)} · girado ${nf(cur.xf.turn, 1)}°`;
    } else if (cur.aim) {
      const c = aimLatLng(), ref = m.type === 'poi' || cur.cut ? null : rp[cur.sel];
      vi.hidden = false;
      vt.textContent = `Mira: ${fmtLL(c)}\n${utmText(c)}` + (ref ? ` · ${fmtLen(Geo.distance(ref, c), S.lenUnit)} do ${vName(cur.sel)}` : '');
    } else if (sp && m.type !== 'poi') {
      vi.hidden = false;
      const nm = vName(cur.sel);
      vt.textContent = `${nm[0].toUpperCase() + nm.slice(1)}: ${fmtLL(sp)}\n${utmText(sp)}`;
    } else vi.hidden = true;
    $('btnUndo').disabled = !cur.history.length;
    $('btnRedo').disabled = !cur.future.length;
    // com a mira ligada a linha mostra a mira, não o vértice: o apagar some para não confundir
    $('btnDelVertex').hidden = !sp || cur.aim || m.type === 'poi';
    $('btnMore').textContent = cur.xf || cur.cut ? '✓' : '⋯';
    $('btnMore').classList.toggle('on', !!(cur.xf || cur.cut));
    let hint;
    if (cur.xf) hint = 'Arraste ✥ para mover e ⟳ para girar a medição inteira. Toque em ✓ quando terminar.';
    else if (cur.cut) hint = cur.cut.pts.length ? 'Agora marque o outro ponto da linha de corte, do outro lado da área.' :
      'Marque dois pontos, um de cada lado da área: a linha entre eles corta a área em duas. ✓ cancela.';
    else if (cur.ring >= 0 && cur.mode !== 'gps') hint = `Desenhando o buraco ${cur.ring + 1}: toque nos cantos dele. Para voltar ao contorno, toque em “Contorno” acima.`;
    else if (cur.mode === 'gps' && cur.paused) hint = 'Gravação pausada. Ande sem marcar e toque em “▶ Continuar” no próximo trecho; “📍 Aqui” marca um ponto avulso.';
    else if (cur.mode === 'gps') hint = `Caminhe pelo ${cur.ring >= 0 ? 'contorno do buraco ' + (cur.ring + 1) : 'contorno'}. Um ponto é marcado a cada ${S.gpsMinDist} m, com precisão de até ${S.gpsMaxAcc} m.` +
      (S.gpsOffset > 0 ? ` Deslocamento: ${nf(S.gpsOffset, 1)} m à ${S.gpsOffSide === 'l' ? 'esquerda' : 'direita'}.` : '');
    else if (cur.aim) hint = 'Arraste o mapa até a mira ficar sobre o ponto e toque no ＋ vermelho.';
    else if (m.type === 'poi') hint = 'Toque no mapa ou use “📍 Aqui” para marcar o ponto. Arraste para ajustar.';
    else hint = 'Toque no mapa para marcar. Arraste um vértice para ajustar; toque no ponto do meio de um lado para inserir.';
    $('drawHint').textContent = hint;
    if (cur.aim) placeAim();
  }

  map.on('click', e => {
    if (!cur || cur.aim || cur.xf || (cur.mode === 'gps' && !cur.paused)) return;
    if (cur.cut) return addCutPoint([e.latlng.lat, e.latlng.lng]);
    addPoint([e.latlng.lat, e.latlng.lng]);
  });

  // ---------- Buracos, mover/girar e cortar ----------
  function renderRingBar() {
    const bar = $('ringBar'), m = cur.item;
    const show = m.type === 'area' && m.holes.length > 0 && !cur.xf && !cur.cut;
    bar.hidden = !show;
    if (!show) return;
    bar.innerHTML = ['Contorno'].concat(m.holes.map((_, i) => `Buraco ${i + 1}`))
      .map((t, i) => `<button class="chip${i - 1 === cur.ring ? ' on' : ''}" data-ring="${i - 1}">${t}</button>`).join('');
  }
  $('ringBar').addEventListener('click', e => {
    const b = e.target.closest('button[data-ring]');
    if (!b || !cur) return;
    dropEmptyHole();
    cur.ring = Math.min(+b.dataset.ring, cur.item.holes.length - 1);
    cur.sel = ringPts().length - 1;
    redraw();
  });
  // buraco começado e abandonado (menos de 3 vértices) some ao trocar de anel
  function dropEmptyHole() {
    const h = cur.ring >= 0 && cur.item.holes[cur.ring];
    if (h && h.length < 3) { cur.item.holes.splice(cur.ring, 1); cur.ring = -1; }
  }
  // plano UTM em torno da medição (SIRGAS 2000, fuso do centro): mover, girar e cortar trabalham em metros
  function planeOf(pts) {
    const c = L.latLngBounds(pts).getCenter();
    return Proj.utm('sirgas', Proj.zoneOf(c.lng), c.lat < 0);
  }
  function startXf() {
    if (cur.mode === 'gps') return toast('Desligue o GPS (🚶 GPS) antes de mover');
    setAim(false);
    dropEmptyHole();
    cur.xf = { move: 0, turn: 0 };
    redraw();
  }
  // alças: ✥ no centro (mover) e ⟳ acima dele (girar). Cada arraste parte do desenho atual, sem acumular erro.
  function drawXf() {
    const m = cur.item, P = planeOf(m.points);
    const rings = () => [m.points].concat(m.holes || []);
    const xy = m.points.map(P.fwd);
    const bx = xy.map(q => q[0]), by = xy.map(q => q[1]);
    const c0 = [(Math.min(...bx) + Math.max(...bx)) / 2, (Math.min(...by) + Math.max(...by)) / 2];
    const H = Math.max(15, 0.6 * Math.max(Math.max(...bx) - Math.min(...bx), Math.max(...by) - Math.min(...by)));
    const shape = editLayer.getLayers()[0];
    let base = null, a0 = 0;
    const begin = () => { snapshot(); base = rings().map(r => r.map(P.fwd)); };
    const apply = (dx, dy, ang) => {
      const cs = Math.cos(ang), sn = Math.sin(ang);
      const out = base.map(r => r.map(([x, y]) => {
        const u = x - c0[0], v = y - c0[1];
        return P.inv([c0[0] + u * cs + v * sn + dx, c0[1] - u * sn + v * cs + dy]);
      }));
      m.points.splice(0, m.points.length, ...out[0]);
      if (m.holes) out.slice(1).forEach((r, k) => m.holes[k].splice(0, m.holes[k].length, ...r));
      if (shape) shape.setLatLngs(m.type === 'area' ? [m.points].concat(holesOf(m)) : m.points);
    };
    const mover = L.marker(P.inv(c0), { draggable: true, zIndexOffset: 200, icon: L.divIcon({ className: 'xf-h', html: '✥', iconSize: [40, 40] }) });
    let last = 0;
    mover.on('dragstart', begin);
    mover.on('drag', e => {
      const q = P.fwd([e.latlng.lat, e.latlng.lng]);
      apply(q[0] - c0[0], q[1] - c0[1], 0);
      last = Math.hypot(q[0] - c0[0], q[1] - c0[1]);
      $('vertexText').textContent = `Movido ${fmtLen(cur.xf.move + last, S.lenUnit)} · girado ${nf(cur.xf.turn, 1)}°`;
    });
    mover.on('dragend', () => { cur.xf.move += last; last = 0; redraw(); });
    const rot = L.marker(P.inv([c0[0], c0[1] + H]), { draggable: true, zIndexOffset: 200, icon: L.divIcon({ className: 'xf-h', html: '⟳', iconSize: [40, 40] }) });
    let ang = 0;
    rot.on('dragstart', () => { begin(); a0 = 0; });
    rot.on('drag', e => {
      const q = P.fwd([e.latlng.lat, e.latlng.lng]);
      ang = Math.atan2(q[0] - c0[0], q[1] - c0[1]); // a partir do norte, sentido horário
      apply(0, 0, ang - a0);
      $('vertexText').textContent = `Movido ${fmtLen(cur.xf.move, S.lenUnit)} · girado ${nf(cur.xf.turn + ang * 180 / Math.PI, 1)}°`;
    });
    rot.on('dragend', () => { cur.xf.turn = (cur.xf.turn + ang * 180 / Math.PI + 540) % 360 - 180; ang = 0; redraw(); });
    L.polyline([P.inv(c0), P.inv([c0[0], c0[1] + H])], { color: '#fff', weight: 2, dashArray: '4 4', interactive: false }).addTo(editLayer);
    mover.addTo(editLayer); rot.addTo(editLayer);
  }
  function startCut() {
    if (cur.mode === 'gps') return toast('Desligue o GPS (🚶 GPS) antes de cortar');
    dropEmptyHole();
    cur.ring = -1;
    cur.cut = { pts: [] };
    redraw();
  }
  function addCutPoint(ll) {
    cur.cut.pts.push(ll);
    if (cur.cut.pts.length < 2) return redraw();
    const err = cutArea(cur.cut.pts[0], cur.cut.pts[1]);
    cur.cut = null;
    if (err) toast(err, 4000);
    redraw();
  }
  // corta o contorno pela reta entre a e b (que precisa cruzar a borda exatamente duas vezes).
  // A peça maior fica nesta medição; a outra é salva como medição nova. Buracos vão para a peça que os contém.
  function cutArea(a, b) {
    const m = cur.item, P = planeOf(m.points), A = P.fwd(a), B = P.fwd(b), xy = m.points.map(P.fwd);
    const hit = (p, q) => {
      const d = (B[0] - A[0]) * (q[1] - p[1]) - (B[1] - A[1]) * (q[0] - p[0]);
      if (Math.abs(d) < 1e-12) return null;
      const t = ((p[0] - A[0]) * (q[1] - p[1]) - (p[1] - A[1]) * (q[0] - p[0])) / d;
      const u = ((p[0] - A[0]) * (B[1] - A[1]) - (p[1] - A[1]) * (B[0] - A[0])) / d;
      return t >= 0 && t <= 1 && u >= 0 && u < 1 ? { t, u, pt: [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])] } : null;
    };
    const hits = [];
    xy.forEach((p, i) => { const h = hit(p, xy[(i + 1) % xy.length]); if (h) hits.push(Object.assign(h, { i })); });
    if (hits.length !== 2) return hits.length < 2
      ? 'A linha de corte precisa atravessar a área: marque um ponto de cada lado, fora dela.'
      : 'A linha cruza a borda mais de duas vezes. Corte em partes, uma de cada vez.';
    const hs = m.holes.filter(h => h.length >= 3);
    if (hs.some(h => { const q = h.map(P.fwd); return q.some((p, i) => hit(p, q[(i + 1) % q.length])); })) return 'A linha de corte passa por um buraco. Mude a linha.';
    const [h1, h2] = hits.sort((x, y) => x.i - y.i || x.u - y.u);
    const i1 = P.inv(h1.pt), i2 = P.inv(h2.pt);
    const r1 = [i1].concat(m.points.slice(h1.i + 1, h2.i + 1), [i2]);
    const r2 = [i2].concat(m.points.slice(h2.i + 1), m.points.slice(0, h1.i + 1), [i1]);
    const piece = r => ({ points: r, holes: hs.filter(h => Formats.pointInRing(h[0], r)) });
    let [big, small] = [piece(r1), piece(r2)];
    if (netArea(Object.assign({ type: 'area' }, small)) > netArea(Object.assign({ type: 'area' }, big))) [big, small] = [small, big];
    snapshot();
    m.points = big.points; m.holes = big.holes.map(copyRing);
    cur.extra.push({ points: small.points, holes: small.holes.map(copyRing) });
    cur.sel = m.points.length - 1;
    toast(`Cortada em duas: ${fmtArea(netArea(m), S.areaUnit)} e ${fmtArea(netArea(Object.assign({ type: 'area' }, small)), S.areaUnit)}. As peças viram medições separadas ao salvar.`, 5000);
    return null;
  }
  $('btnMore').onclick = () => {
    if (!cur) return;
    if (cur.xf || cur.cut) { cur.xf = null; cur.cut = null; redraw(); return; }
    const m = cur.item, acts = [];
    if (m.type === 'area') acts.push(['hole', '◌ Desenhar um buraco', 'Represa, reserva, construção: a área dele é descontada.']);
    if (m.type === 'area' && cur.ring >= 0) acts.push(['delhole', `✕ Apagar o buraco ${cur.ring + 1}`, '']);
    if (m.points.length >= 2) acts.push(['xf', '✥ Mover e girar', 'Arrasta ou gira a medição inteira, sem mudar o formato.']);
    if (m.type === 'area' && m.points.length >= 3) acts.push(['cut', '✂ Cortar em duas', 'Divide a área por uma linha; cada parte vira uma medição.']);
    if (!acts.length) return toast('Marque a medição primeiro');
    modal('Mais ferramentas', acts.map(([k, t, d]) => `<button class="tool more-act" data-act="${k}">${t}${d ? `<small>${d}</small>` : ''}</button>`).join(''),
      [{ label: 'Fechar', cls: 'ghost' }]);
    $('modalBody').querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      closeModal();
      const k = b.dataset.act;
      if (k === 'hole') {
        if (cur.mode === 'gps' && !cur.paused) toast('O GPS agora grava o contorno do buraco');
        dropEmptyHole();
        snapshot();
        m.holes.push([]); cur.ring = m.holes.length - 1; cur.sel = -1;
        redraw();
      } else if (k === 'delhole') {
        snapshot(); m.holes.splice(cur.ring, 1); cur.ring = -1; cur.sel = m.points.length - 1; redraw();
      } else if (k === 'xf') startXf();
      else if (k === 'cut') startCut();
    });
  };

  // ---------- Mira ----------
  // centro da parte do mapa que fica entre a barra de busca e o painel
  function aimPoint() {
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const bottom = $('drawPanel').hidden ? window.innerHeight : $('drawPanel').getBoundingClientRect().top;
    return L.point(window.innerWidth / 2, (top + bottom) / 2);
  }
  function aimLatLng() {
    const ll = map.containerPointToLatLng(aimPoint());
    return [ll.lat, ll.lng];
  }
  function placeAim() { $('aim').style.top = aimPoint().y + 'px'; }
  function setAim(on) {
    if (!cur) return;
    cur.aim = on;
    $('aim').hidden = !on;
    $('btnAim').classList.toggle('on', on);
    if (on) placeAim();
    updateDrawPanel();
  }
  $('btnAim').onclick = () => setAim(!cur.aim);
  $('btnAimAdd').onclick = e => {
    L.DomEvent.stop(e);
    if (cur && cur.cut) addCutPoint(aimLatLng());
    else if (cur) addPoint(aimLatLng());
  };
  map.on('move', () => { if (cur && cur.aim) updateDrawPanel(); });
  window.addEventListener('resize', () => { if (cur && cur.aim) placeAim(); });

  // ---------- Desfazer / refazer ----------
  function restore(h) {
    cur.item.points = h.points;
    if (cur.item.type === 'area') cur.item.holes = h.holes;
    cur.extra = h.extra;
    cur.ring = Math.min(h.ring, (cur.item.holes || []).length - 1);
    cur.sel = h.sel;
    redraw();
  }
  function undo() {
    if (!cur || !cur.history.length) return;
    cur.future.push(stateNow());
    restore(cur.history.pop());
  }
  function redo() {
    if (!cur || !cur.future.length) return;
    cur.history.push(stateNow());
    restore(cur.future.pop());
  }
  function resetOriginal() {
    if (!cur || !cur.original) return;
    confirmBox('Voltar ao original', 'Descartar todas as alterações e voltar ao desenho salvo? Se mudar de ideia, toque em ↶.', 'Voltar', () => {
      snapshot();
      restore(JSON.parse(JSON.stringify(Object.assign({}, cur.original, { extra: [], ring: -1, sel: cur.original.points.length - 1 }))));
    });
  }
  function deleteVertex() {
    if (!cur || cur.xf || cur.cut || cur.item.type === 'poi' || ringPts()[cur.sel] == null) return;
    snapshot();
    ringPts().splice(cur.sel, 1);
    cur.sel = Math.min(cur.sel, ringPts().length - 1);
    redraw();
  }
  $('btnUndo').onclick = undo;
  $('btnRedo').onclick = redo;
  $('btnReset').onclick = resetOriginal;
  $('btnDelVertex').onclick = deleteVertex;
  document.addEventListener('keydown', e => {
    if (!cur || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || !$('modal').hidden) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && k === 'z') { e.preventDefault(); undo(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteVertex(); }
  });

  $('btnCancel').onclick = () => {
    if (!cur.dirty) return endDraw();
    confirmBox('Descartar', 'Descartar as alterações desta medição?', 'Descartar', endDraw, true);
  };

  $('btnSave').onclick = () => {
    const m = cur.item, need = { area: 3, distance: 2, poi: 1 }[m.type];
    if (m.points.length < need) return toast(`Marque pelo menos ${need} ponto(s).`);
    if (cur.xf || cur.cut) { cur.xf = null; cur.cut = null; redraw(); }
    if (m.type === 'area' && m.holes.some(h => h.length && h.length < 3)) toast('Buraco com menos de 3 cantos não é salvo');
    const groups = [...new Set(store.items.map(x => x.group).filter(Boolean))];
    const count = store.items.filter(x => x.type === m.type).length + 1;
    modal('Salvar medição', `
      <p style="margin:0;color:var(--muted)">${esc(describe(m))}</p>
      <label for="fName">Nome</label><input id="fName" value="${esc(m.name || TYPE_LABEL[m.type] + ' ' + count)}">
      <label for="fGroup">Grupo</label><input id="fGroup" list="groupList" value="${esc(m.group)}" placeholder="ex.: Fazenda Boa Vista">
      <datalist id="groupList">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <label>Cor</label><div class="colors" id="fColors">${COLORS.map(c =>
        `<button type="button" data-c="${c}" style="background:${c}" class="${c === m.color ? 'sel' : ''}" aria-label="${c}"></button>`).join('')}</div>
      <label for="fNotes">Observações</label><textarea id="fNotes" rows="3">${esc(m.notes)}</textarea>`,
    [{ label: 'Voltar', cls: 'ghost' }, {
      label: 'Salvar', cls: 'primary', onClick: () => {
        m.name = $('fName').value.trim() || TYPE_LABEL[m.type];
        m.group = $('fGroup').value.trim();
        m.notes = $('fNotes').value.trim();
        const now = new Date().toISOString();
        m.updated = now;
        if (m.type === 'area') m.holes = m.holes.filter(h => h.length >= 3);
        // a original pode ter sido excluída em outro aparelho durante a edição: aí entra como nova
        if (cur.editingId && store.items.some(x => x.id === cur.editingId)) store.items = store.items.map(x => x.id === cur.editingId ? m : x);
        else { m.created = now; store.items.push(m); }
        // peças de um corte: medições novas com o mesmo grupo, cor e observações
        cur.extra.forEach((e, k) => store.items.push({ id: uid(), type: 'area', name: `${m.name} (${k + 2})`, group: m.group, color: m.color,
          notes: m.notes, points: e.points, holes: e.holes, created: now, updated: now }));
        const n = 1 + cur.extra.length;
        persistItems();
        const id = m.id;
        endDraw();
        renderList();
        selectItem(id);
        toast(n > 1 ? `${n} medições salvas` : 'Medição salva');
      }
    }]);
    $('fColors').addEventListener('click', e => {
      const b = e.target.closest('button[data-c]');
      if (!b) return;
      m.color = b.dataset.c;
      $('fColors').querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
      redraw();
    });
  };

  // ---------- GPS ----------
  let watchId = null, lastFix = null, meMarker = null, accCircle = null, follow = false, fixWaiters = [];
  let wakeLock = null;

  function startLocate() {
    if (!('geolocation' in navigator)) { toast('Este aparelho não oferece localização.'); return false; }
    if (watchId != null) return true;
    $('gpsBadge').hidden = false;
    $('gpsBadge').textContent = 'GPS: procurando…';
    watchId = navigator.geolocation.watchPosition(onFix, err => {
      if (err.code === 3 && lastFix) return; // parado: sem posição nova não é falha
      const msg = err.code === 1 ? 'Permissão de localização negada. Libere nas configurações do navegador.'
        : 'Não foi possível obter a localização.';
      toast(msg, 4000);
      $('gpsBadge').textContent = 'GPS: sem sinal';
      if (err.code === 1) stopLocate();
    }, { enableHighAccuracy: true, maximumAge: 0 });
    $('btnLocate').classList.add('active');
    return true;
  }
  function stopLocate() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null; lastFix = null; follow = false;
    if (meMarker) { map.removeLayer(meMarker); map.removeLayer(accCircle); meMarker = accCircle = null; }
    $('btnLocate').classList.remove('active');
    $('gpsBadge').hidden = true;
  }
  function onFix(pos) {
    const ll = [pos.coords.latitude, pos.coords.longitude], acc = pos.coords.accuracy;
    lastFix = { ll, acc, t: pos.timestamp };
    $('gpsBadge').textContent = `GPS ±${Math.round(acc)} m`;
    if (!meMarker) {
      accCircle = L.circle(ll, { radius: acc, color: '#1e88e5', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { icon: L.divIcon({ className: 'me' }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    } else { meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(acc); }
    if (follow) map.setView(ll, Math.max(map.getZoom(), 17));
    const w = fixWaiters; fixWaiters = []; w.forEach(f => f(lastFix));
    if (cur && cur.mode === 'gps') gpsRecord(lastFix);
  }
  function withFix(fn) {
    if (lastFix && Date.now() - lastFix.t < 10000) return fn(lastFix);
    if (!startLocate()) return;
    toast('Aguardando o GPS…');
    fixWaiters.push(fn);
  }

  $('btnLocate').onclick = () => {
    if (watchId != null && lastFix) {
      if (follow) { stopLocate(); toast('Localização desligada'); return; }
      follow = true; map.setView(lastFix.ll, Math.max(map.getZoom(), 17)); toast('Seguindo sua posição · toque de novo para desligar');
      return;
    }
    follow = true;
    startLocate();
  };
  map.on('dragstart', () => { follow = false; });

  $('btnAddGps').onclick = () => withFix(f => {
    if (!cur) return;
    if (f.acc > 50) toast(`Atenção: precisão baixa (±${Math.round(f.acc)} m)`);
    addPoint(f.ll);
    map.panTo(f.ll);
  });

  // Filtro de saltos: descarta a posição cujo passo passa de 3× a média dos últimos 6 (e de 10 m).
  // Depois de 3 descartes seguidos aceita, para não travar quando a pessoa realmente acelerou.
  const jump = { prev: null, steps: [], rejects: 0 };
  function resetJump() { jump.prev = null; jump.steps = []; jump.rejects = 0; }
  function jumpOk(f) {
    if (!f.ll[0] && !f.ll[1]) return false;
    if (jump.prev && f.t - jump.prev.t > 120000) jump.steps = [];
    if (jump.prev) {
      const step = Geo.distance(jump.prev.ll, f.ll);
      if (jump.steps.length >= 3) {
        const mean = jump.steps.reduce((s, x) => s + x, 0) / jump.steps.length;
        if (step > Math.max(3 * mean, 10) && jump.rejects < 3) { jump.rejects++; return false; }
      }
      jump.steps.push(step);
      if (jump.steps.length > 6) jump.steps.shift();
    }
    jump.rejects = 0;
    jump.prev = f;
    return true;
  }
  // distância (m) de p ao segmento a–b, num plano local em torno de a
  function offLine(p, a, b) {
    const k = Math.cos(a[0] * Math.PI / 180), R = 6371008.8 * Math.PI / 180;
    const P = [(p[1] - a[1]) * k * R, (p[0] - a[0]) * R], B = [(b[1] - a[1]) * k * R, (b[0] - a[0]) * R];
    const L2 = B[0] * B[0] + B[1] * B[1];
    const t = L2 ? Math.max(0, Math.min(1, (P[0] * B[0] + P[1] * B[1]) / L2)) : 0;
    return Math.hypot(P[0] - t * B[0], P[1] - t * B[1]);
  }
  // ponto a d metros de p no rumo az (graus), na esfera
  function destPoint(p, az, d) {
    const R = 6371008.8, r = Math.PI / 180, f1 = p[0] * r, l1 = p[1] * r, a = az * r, dd = d / R;
    const f2 = Math.asin(Math.sin(f1) * Math.cos(dd) + Math.cos(f1) * Math.sin(dd) * Math.cos(a));
    const l2 = l1 + Math.atan2(Math.sin(a) * Math.sin(dd) * Math.cos(f1), Math.cos(dd) - Math.sin(f1) * Math.sin(f2));
    return [f2 / r, l2 / r];
  }
  function bearing(a, b) {
    const r = Math.PI / 180, f1 = a[0] * r, f2 = b[0] * r, dl = (b[1] - a[1]) * r;
    return Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) / r;
  }
  // Deslocamento lateral: a antena está a gpsOffset m do que se quer marcar (borda do implemento, a cerca ao lado).
  // O rumo vem do caminho andado (pelo menos 2 m); até lá a posição fica guardada e não marca nada.
  function lateral(f) {
    if (!(S.gpsOffset > 0) || !cur.run) return f;
    const run = cur.run;
    if (!run.raw) { run.raw = f.ll; return null; }
    if (Geo.distance(run.raw, f.ll) >= 2) { run.head = bearing(run.raw, f.ll); run.raw = f.ll; }
    if (run.head == null) return null;
    return Object.assign({}, f, { ll: destPoint(f.ll, run.head + (S.gpsOffSide === 'l' ? -90 : 90), S.gpsOffset) });
  }
  function gpsRecord(f) {
    if (cur.paused || f.acc > S.gpsMaxAcc || !jumpOk(f)) return;
    f = lateral(f);
    if (!f) return;
    const pts = ringPts();
    const last = pts[pts.length - 1];
    if (last && Geo.distance(last, f.ll) < S.gpsMinDist) return;
    // Trecho reto: se o último ponto gravado (e os que ele já substituiu) cabem a menos de gpsStraight m
    // da reta entre o penúltimo e a posição nova, ele é trocado pela nova em vez de somar mais um vértice.
    // Só vale quando os dois últimos vértices ainda são os gravados por este trecho: ponto marcado à mão,
    // arrastado ou desfeito nunca é substituído.
    const run = cur.run, same = (p, q) => !!p && !!q && p[0] === q[0] && p[1] === q[1];
    const prev = pts[pts.length - 2];
    if (run && !same(last, run.b)) { run.a = run.b = null; run.skipped = []; }
    if (S.gpsStraight > 0 && run && run.a && same(prev, run.a)) {
      const cand = run.skipped.concat([last]);
      if (cand.every(p => offLine(p, prev, f.ll) < S.gpsStraight)) {
        snapshot();
        run.skipped = cand;
        pts[pts.length - 1] = f.ll.slice();
        run.b = pts[pts.length - 1].slice();
        cur.sel = pts.length - 1;
        redraw();
        map.panTo(f.ll);
        return;
      }
    }
    cur.sel = pts.length - 1;
    addPoint(f.ll);
    if (run) { run.a = run.b ? run.b : null; run.b = f.ll.slice(); run.skipped = []; }
    map.panTo(f.ll);
  }
  async function requestWake() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignora */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cur && cur.mode === 'gps') requestWake();
  });
  function stopGpsRecording() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  function setMode(mode) {
    if (!cur) return;
    if (mode === 'gps') {
      if (!startLocate()) return;
      cur.mode = 'gps'; follow = true;
      requestWake();
      $('btnMode').textContent = '🚶 GPS';
      $('btnMode').classList.add('on');
      setAim(false);
      setPaused(false);
      toast('Gravação por GPS: caminhe pelo contorno');
    } else {
      if (cur.mode === 'gps') stopGpsRecording();
      cur.mode = 'manual';
      cur.paused = false; cur.run = null;
      $('btnMode').textContent = '✋ Manual';
      $('btnMode').classList.remove('on');
      $('btnPause').hidden = true;
    }
    updateDrawPanel();
  }
  // cada retomada começa um trecho novo: o filtro de saltos e a simplificação de retas não ligam trechos diferentes
  function setPaused(p) {
    cur.paused = p;
    $('btnPause').hidden = false;
    $('btnPause').textContent = p ? '▶ Continuar' : '⏸ Pausar';
    $('btnPause').classList.toggle('on', p);
    if (!p) {
      cur.run = { a: null, b: null, skipped: [] };
      resetJump();
      if (lastFix && Date.now() - lastFix.t < 10000) gpsRecord(lastFix);
    }
    updateDrawPanel();
  }
  $('btnMode').onclick = () => setMode(cur.mode === 'gps' ? 'manual' : 'gps');
  $('btnPause').onclick = () => { if (cur && cur.mode === 'gps') setPaused(!cur.paused); };

  // ---------- Botão de nova medição ----------
  function closeFabMenu() { $('fabMenu').hidden = true; $('fab').textContent = '＋'; }
  $('fab').onclick = () => {
    const open = $('fabMenu').hidden;
    $('fabMenu').hidden = !open;
    $('fab').textContent = open ? '✕' : '＋';
  };
  $('fabMenu').addEventListener('click', e => {
    const b = e.target.closest('button[data-new]');
    if (b) startDraw(b.dataset.new);
  });

  // ---------- Lista ----------
  function renderList() {
    const q = $('listFilter').value.trim().toLowerCase();
    const g = $('groupFilter').value;
    const groups = [...new Set(store.items.map(x => x.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    $('groupFilter').innerHTML = '<option value="">Todos os grupos</option>' +
      groups.map(x => `<option ${x === g ? 'selected' : ''}>${esc(x)}</option>`).join('');
    const items = store.items
      .filter(m => (!g || m.group === g) && (!q || (m.name + ' ' + (m.group || '')).toLowerCase().includes(q)))
      .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    const totalArea = items.filter(m => m.type === 'area').reduce((s, m) => s + Geo.area(m.points), 0);
    $('listSummary').textContent = `${items.length} medição(ões)` + (totalArea ? ` · área total ${fmtArea(totalArea, S.areaUnit)}` : '');
    $('list').innerHTML = items.length ? items.map(m => `
      <li data-id="${m.id}">
        <span class="swatch" style="background:${esc(m.color || TYPE_COLOR[m.type])}"></span>
        <div class="meta"><div class="name">${esc(m.name)}</div>
        <div class="small">${TYPE_LABEL[m.type]}${m.group ? ' · ' + esc(m.group) : ''}</div></div>
        <div class="val">${esc(m.type === 'poi' ? '' : describe(m).split(' · ')[0])}</div>
      </li>`).join('')
      : '<li class="empty">Nenhuma medição ainda.<br>Toque em ＋ no mapa para começar.</li>';
  }
  $('list').addEventListener('click', e => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    $('drawer').hidden = true;
    selectItem(li.dataset.id, true);
  });
  $('btnList').onclick = () => { if (cur) return toast('Termine ou cancele a medição atual'); renderList(); $('drawer').hidden = false; };
  $('btnDrawerClose').onclick = () => { $('drawer').hidden = true; };
  $('listFilter').oninput = renderList;
  $('groupFilter').onchange = renderList;

  // ---------- Exportação / importação ----------
  // ---------- Imagem do mapa e relatório PDF ----------
  const RATIOS = {
    '4:3': { label: '4:3 deitada', w: 4, h: 3 }, '3:4': { label: '3:4 em pé', w: 3, h: 4 }, '1:1': { label: 'Quadrada', w: 1, h: 1 },
    '16:9': { label: '16:9 (tela larga)', w: 16, h: 9 }, '9:16': { label: '9:16 (status, stories)', w: 9, h: 16 },
    a4l: { label: 'A4 deitada', w: Math.SQRT2, h: 1 }, a4p: { label: 'A4 em pé', w: 1, h: Math.SQRT2 }
  };
  const sizeLabel = m => m.type === 'area' ? fmtArea(measure(m).area_m2, S.areaUnit)
    : m.type === 'distance' ? fmtLen(measure(m).length_m, S.lenUnit) : '';
  async function mapImage(items, base, W, H, r, o) {
    const b = BASES[base] || BASES.hybrid;
    const res = await MapImg.render(Object.assign({ items, W, H, r, layers: b.img(), attribution: b.attr,
      labelOf: m => [m.name, sizeLabel(m)], tileZoom: 19 }, o));
    if (res.failed) toast(`${res.failed} de ${res.total} blocos do mapa não carregaram (sem internet?)`, 4000);
    return res.canvas;
  }
  const jpegOf = (canvas, q) => new Promise((ok, fail) => canvas.toBlob(b => b ? ok(b) : fail(new Error('imagem')), 'image/jpeg', q || 0.88));

  async function buildJPG(items, o) {
    const ra = RATIOS[o.ratio] || RATIOS['4:3'], long = o.hi ? 2400 : 1200;
    const W = Math.round(ra.w >= ra.h ? long : long * ra.w / ra.h), H = Math.round(ra.h > ra.w ? long : long * ra.h / ra.w);
    toast('Gerando a imagem…', 20000);
    const c = await mapImage(items, o.base, W, H, long / 800, { names: o.names, sizes: o.sizes, vertices: o.vertices, pad: 50 });
    toast('Imagem pronta');
    return jpegOf(c);
  }

  // latitude ou longitude sozinha, no formato escolhido
  const fmtAxis = (v, lat) => S.coordFmt === 'ddm' || S.coordFmt === 'dms' ? (lat ? fmtDeg(v, 'N', 'S') : fmtDeg(v, 'L', 'O')) : v.toFixed(6);
  function fmtAz(deg) {
    const ts = Math.round(((deg % 360) + 360) % 360 * 3600), d = Math.floor(ts / 3600), mi = Math.floor(ts % 3600 / 60), se = ts % 60;
    return `${d}°${String(mi).padStart(2, '0')}'${String(se).padStart(2, '0')}"`;
  }
  async function buildPDF(items, o, title) {
    const doc = PDFDoc.create(), M = 40, CW = doc.W - 2 * M, BOTTOM = doc.H - 50;
    const when = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const datumLbl = Proj.DATUMS[o.crs] ? Proj.DATUMS[o.crs].label : 'SIRGAS 2000';
    let y = 0;
    const page = () => {
      doc.addPage();
      doc.color([27, 94, 32]).rect(0, 0, doc.W, 6, true);
      doc.font('bold', 9).color([27, 94, 32]).text('Mapeador de Áreas', M, 26).font('normal', 9).color([110, 110, 110]).text(`Relatório · ${when}`, doc.W - M, 26, 'right');
      doc.color([200, 200, 200]).line(M, 33, doc.W - M, 33);
      y = 56;
    };
    const need = h => { if (y + h > BOTTOM) page(); };
    const para = (s, size, bold, rgb, gap) => {
      doc.font(bold ? 'bold' : 'normal', size).color(rgb || [30, 30, 30]);
      doc.wrap(s, CW).forEach(l => { need(size * 1.35); doc.text(l, M, y); y += size * 1.35; });
      y += gap ?? 4;
    };
    const kv = (k, v) => {
      doc.font('normal', 10);
      const lines = doc.wrap(v, CW - 110);
      need(lines.length * 14);
      doc.font('bold', 10).color([90, 90, 90]).text(k, M, y);
      doc.font('normal', 10).color([20, 20, 20]);
      lines.forEach((l, i) => doc.text(l, M + 110, y + i * 14));
      y += lines.length * 14 + 2;
    };
    // tabela com cabeçalho repetido a cada página; cols: [título, largura, alinhamento]
    const table = (cols, rows, size) => {
      const rh = size * 1.6;
      const head = () => {
        doc.color([235, 240, 235]).rect(M, y - size - 3, CW, rh, true);
        doc.font('bold', size).color([40, 40, 40]);
        let x = M + 4;
        cols.forEach(([t, w, al]) => { doc.text(t, al === 'right' ? x + w - 8 : x, y, al); x += w; });
        y += rh;
      };
      need(rh * 2); head();
      rows.forEach((row, ri) => {
        if (y + rh > BOTTOM) { page(); head(); }
        if (row.total) doc.color([30, 30, 30]).line(M, y - size - 2, M + CW, y - size - 2);
        else if (ri % 2) doc.color([248, 248, 248]).rect(M, y - size - 3, CW, rh, true);
        doc.font(row.total ? 'bold' : 'normal', size).color([20, 20, 20]);
        let x = M + 4;
        row.forEach((v, i) => {
          const [, w, al] = cols[i];
          let s = String(v ?? '');
          while (s.length > 1 && doc.width(s) > w - 8) s = s.slice(0, -2) + '…';
          doc.text(s, al === 'right' ? x + w - 8 : x, y, al);
          x += w;
        });
        y += rh;
      });
      y += 6;
    };
    const addMap = async (list, h, opts) => {
      const r = 2.4, c = await mapImage(list, o.base, Math.round(CW * r), Math.round(h * r), r * 0.62, opts);
      const jpg = new Uint8Array(await (await jpegOf(c, 0.85)).arrayBuffer());
      need(h + 8);
      doc.image(jpg, c.width, c.height, M, y, CW, h);
      doc.color([180, 180, 180]).rect(M, y, CW, h);
      y += h + 14;
    };

    page();
    const total = items.filter(m => m.type === 'area').reduce((s, m) => s + measure(m).area_m2, 0);
    if (o.pSum && items.length > 1) {
      para(title === 'medicoes' ? 'Todas as medições' : title.replace(/_/g, ' '), 18, true, [20, 20, 20], 2);
      para(`${items.length} medições · área total ${fmtArea(total, S.areaUnit)} (${otherAreas(total)})`, 10, false, [90, 90, 90], 10);
      if (o.pMap) { toast('Gerando o mapa geral…', 30000); await addMap(items, 330, { names: true, sizes: false, pad: 30 }); }
      table([['Nome', 160, 'left'], ['Grupo', 110, 'left'], ['Tipo', 60, 'left'], ['Área', 95, 'right'], ['Perímetro / compr.', 90, 'right']],
        items.map(m => { const v = measure(m); return [m.name, m.group || '', TYPE_LABEL[m.type],
          m.type === 'area' ? fmtArea(v.area_m2, S.areaUnit) : '', v.length_m != null ? fmtLen(v.length_m, S.lenUnit) : '']; })
          .concat([Object.assign(['Total', '', '', fmtArea(total, S.areaUnit), ''], { total: true })]), 8.5);
    }
    for (let i = 0; i < items.length; i++) {
      const m = items[i], v = measure(m);
      if (i > 0 || (o.pSum && items.length > 1)) page();
      toast(`Gerando o relatório: ${i + 1} de ${items.length}…`, 30000);
      para(m.name, 18, true, [20, 20, 20], 2);
      para([TYPE_LABEL[m.type], m.group].filter(Boolean).join(' · '), 10, false, [90, 90, 90], 8);
      if (o.pMap) await addMap([m], m.type === 'poi' ? 260 : 340, { names: false, sizes: false, vertices: m.type !== 'poi', pad: 34 });
      if (m.type === 'area') {
        kv('Área', `${fmtArea(v.area_m2, S.areaUnit)}  (${otherAreas(v.area_m2)})`);
        kv('Perímetro', fmtLen(v.length_m, S.lenUnit));
        kv('Vértices', String(m.points.length));
        const hs = holesOf(m);
        if (hs.length) kv('Buracos', `${hs.length}, somando ${fmtArea(hs.reduce((t, h) => t + Geo.area(h), 0), S.areaUnit)} (já descontados da área)`);
      } else if (m.type === 'distance') {
        kv('Comprimento', fmtLen(v.length_m, S.lenUnit));
        kv('Pontos', String(m.points.length));
      } else {
        kv('Coordenada', fmtLL(m.points[0]));
        const u = Proj.toUTM(m.points[0], o.crs);
        kv('UTM', `${u.zone}${u.hemisphere} ${datumLbl}  E ${nf(u.easting, 2)}  N ${nf(u.northing, 2)}`);
      }
      if (m.notes) kv('Observações', m.notes);
      y += 8;
      if (o.pCoord && m.type !== 'poi') {
        // UTM no fuso do centro da medição; azimute plano (de quadrícula) e lado geodésico até o próximo vértice
        const cc = L.latLngBounds(m.points).getCenter(), zn = Proj.zoneOf(cc.lng), so = cc.lat < 0;
        const fwd = Proj.utm(o.crs, zn, so).fwd;
        para(`Vértices · UTM ${zn}${so ? 'S' : 'N'} ${datumLbl} · azimute plano, lado geodésico`, 10, true, [27, 94, 32], 6);
        // pre: prefixo do nome do vértice (P no contorno, B1-P no buraco 1)
        const vtable = (ring, closed, pre) => {
          const xy = ring.map(fwd), n = ring.length;
          table([['#', 30, 'left'], ['Latitude', 79, 'left'], ['Longitude', 79, 'left'], ['E (m)', 78, 'right'], ['N (m)', 84, 'right'],
            ['Azimute', 86, 'left'], ['Lado (m)', 79, 'right']],
          ring.map((p, k) => {
            const j = k + 1 < n ? k + 1 : closed ? 0 : -1;
            const az = j < 0 ? '' : fmtAz(Math.atan2(xy[j][0] - xy[k][0], xy[j][1] - xy[k][1]) * 180 / Math.PI);
            return [`${pre}${k + 1}`, fmtAxis(p[0], true), fmtAxis(p[1], false), nf(xy[k][0], 2), nf(xy[k][1], 2), j < 0 ? '' : `${az} → ${pre}${j + 1}`,
              j < 0 ? '' : nf(Geo.distance(p, ring[j]), 2)];
          }), 7.5);
        };
        vtable(m.points, m.type === 'area', 'P');
        holesOf(m).forEach((h, k) => {
          para(`Buraco ${k + 1} · ${fmtArea(Geo.area(h), S.areaUnit)}`, 9.5, true, [27, 94, 32], 4);
          vtable(h, true, `B${k + 1}-P`);
        });
      }
      if (o.pPhoto) {
        // fotos em duas colunas, com legenda
        const ph = await Photos.list(m.id).catch(() => []);
        if (ph.length) { y += 4; para(`Fotos (${ph.length})`, 10, true, [27, 94, 32], 6); }
        const colW = (CW - 12) / 2;
        for (let k = 0; k < ph.length; k += 2) {
          const pair = await Promise.all(ph.slice(k, k + 2).map(async r => {
            const bmp = await createImageBitmap(r.blob);
            const d = { r, w: bmp.width, h: bmp.height, bytes: new Uint8Array(await r.blob.arrayBuffer()) };
            if (bmp.close) bmp.close();
            return d;
          }));
          const hh = Math.max(...pair.map(d => Math.min(colW * d.h / d.w, 300)));
          need(hh + 24);
          pair.forEach((d, j) => {
            let w = colW, h = colW * d.h / d.w;
            if (h > 300) { w = w * 300 / h; h = 300; }
            const x = M + j * (colW + 12);
            doc.image(d.bytes, d.w, d.h, x, y, w, h);
            doc.font('normal', 8).color([70, 70, 70]);
            const cap = [d.r.caption, new Date(d.r.created).toLocaleDateString('pt-BR')].filter(Boolean).join(' · ');
            doc.wrap(cap, colW).slice(0, 2).forEach((l, i) => doc.text(l, x, y + h + 10 + i * 10));
          });
          y += hh + 32;
        }
      }
    }
    doc.eachPage((i, n) => {
      doc.color([200, 200, 200]).line(M, doc.H - 34, doc.W - M, doc.H - 34);
      doc.font('normal', 7.5).color([120, 120, 120])
        .text('Áreas e distâncias geodésicas (elipsoide WGS84 = SIRGAS 2000). A exatidão depende da imagem e do GPS usados.', M, doc.H - 22)
        .text(`${i + 1} / ${n}`, doc.W - M, doc.H - 22, 'right');
    });
    toast('Relatório pronto');
    return doc.build({ title });
  }

  function exportDialog(items, baseName) {
    if (!items.length) return toast('Nada para exportar');
    const safe = (baseName || 'medicoes').replace(/[^\wÀ-ſ -]+/g, '').trim().replace(/\s+/g, '_') || 'medicoes';
    const canShare = !!(navigator.canShare && navigator.share);
    // fuso UTM do centro das medições (o costume quando a área cruza fusos)
    const c = L.latLngBounds(items.flatMap(m => m.points)).getCenter(), zone = Proj.zoneOf(c.lng), south = c.lat < 0;
    const zoneTxt = `${zone}${south ? 'S' : 'N'}`;
    const crsOpts = geo => (geo ? [['wgs84', 'Graus (WGS84 / SIRGAS 2000)']] : [])
      .concat(Object.entries(Proj.DATUMS).map(([k, d]) => [k, `UTM ${d.label}, fuso ${zoneTxt}`]))
      .map(([k, l]) => `<option value="${k}" ${k === (geo ? 'wgs84' : S.datum) ? 'selected' : ''}>${l}</option>`).join('');
    const FMTS = {
      kml: 'KML (Google Earth, QGIS, GPS)', pdf: 'Relatório PDF (A4, com mapa e medidas)', jpg: 'Imagem JPG do mapa',
      kmz: 'KMZ (KML compactado)', gpx: 'GPX (aparelhos GPS, Garmin)',
      shp: 'Shapefile .zip (QGIS, ArcGIS)', dxf: 'DXF (AutoCAD e outros CAD, em UTM)',
      geojson: 'GeoJSON (QGIS, SIG)', csv: 'CSV (Excel, com áreas e coordenadas)'
    };
    const utmConv = datum => Proj.utm(datum, zone, south).fwd;
    const make = async (fmt, o) => {
      const crs = o.crs;
      if (fmt === 'pdf') return { name: safe + '.pdf', type: 'application/pdf', data: await buildPDF(items, o, safe) };
      if (fmt === 'jpg') return { name: safe + '.jpg', type: 'image/jpeg', data: await buildJPG(items, o) };
      if (fmt === 'kml') return { name: safe + '.kml', type: 'application/vnd.google-earth.kml+xml', data: Formats.toKML(items, describe) };
      if (fmt === 'kmz') {
        // as fotos vão em files/ e aparecem no balão de cada medição
        const files = [], byItem = {};
        for (const m of items) {
          const ph = await Photos.list(m.id).catch(() => []);
          byItem[m.id] = ph.map(r => {
            const path = `files/${r.id}.jpg`;
            files.push({ name: path, blob: r.blob });
            return { path, caption: r.caption || '' };
          });
        }
        const entries = [{ name: 'doc.kml', data: Formats.toKML(items, describe, m => byItem[m.id] || []) }];
        for (const f of files) entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) });
        return { name: safe + '.kmz', type: 'application/vnd.google-earth.kmz', data: await Zip.write(entries, 'application/vnd.google-earth.kmz') };
      }
      if (fmt === 'gpx') return { name: safe + '.gpx', type: 'application/gpx+xml', data: Formats.toGPX(items, describe) };
      if (fmt === 'geojson') return { name: safe + '.geojson', type: 'application/geo+json', data: Formats.toGeoJSON(items, measure) };
      if (fmt === 'shp') {
        const geo = crs === 'wgs84';
        const files = Formats.toSHP(items, measure, geo ? p => [p[1], p[0]] : utmConv(crs),
          geo ? Proj.geogWKT('sirgas') : Proj.utmWKT(crs, zone, south), safe);
        return { name: safe + '_shp.zip', type: 'application/zip', data: await Zip.write(files) };
      }
      if (fmt === 'dxf') return { name: `${safe}_UTM${zoneTxt}.dxf`, type: 'application/dxf', data: Formats.toDXF(items, utmConv(crs), describe) };
      const xy = crs === 'wgs84' ? null : { head: `utm_${zoneTxt}_${Proj.DATUMS[crs].label.replace(/\s+/g, '_')}_E_N`, f: utmConv(crs) };
      return { name: safe + '.csv', type: 'text/csv', data: Formats.toCSV(items, measure, xy) };
    };
    modal('Exportar', `
      <label for="fFmt">Formato</label>
      <select id="fFmt">${Object.entries(FMTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <div id="fCrsBox" hidden><label for="fCrs">Sistema de coordenadas</label><select id="fCrs"></select></div>
      <div id="fImgBox" hidden>
        <div id="fJpgBox"><label for="fRatio">Proporção</label><select id="fRatio">${Object.entries(RATIOS).map(([k, r]) => `<option value="${k}">${r.label}</option>`).join('')}</select></div>
        <label for="fMapT">Mapa</label><select id="fMapT">${Object.entries(BASES).map(([k, b]) => `<option value="${k}" ${k === S.layer ? 'selected' : ''}>${b.label}</option>`).join('')}</select>
        <div id="fJpgChk">
          <label class="layer-opt"><input type="checkbox" id="fNames" checked>Nomes</label>
          <label class="layer-opt"><input type="checkbox" id="fSizes" checked>Área e distância</label>
          <label class="layer-opt"><input type="checkbox" id="fVtx">Vértices</label>
          <label class="layer-opt"><input type="checkbox" id="fHi" checked>Alta resolução</label>
        </div>
        <div id="fPdfChk">
          <label class="layer-opt"><input type="checkbox" id="fPMap" checked>Mapa de cada medição</label>
          <label class="layer-opt"><input type="checkbox" id="fPCoord" checked>Tabela de vértices (coordenadas, lados e azimutes)</label>
          <label class="layer-opt"><input type="checkbox" id="fPPhoto" checked>Fotos</label>
          ${items.length > 1 ? '<label class="layer-opt"><input type="checkbox" id="fPSum" checked>Página de resumo com todas</label>' : ''}
        </div>
      </div>
      <p style="color:var(--muted);font-size:13px">${items.length} medição(ões)</p>`,
    [{ label: 'Baixar', cls: canShare ? '' : 'primary', onClick: () => run(download) }]
      .concat(canShare ? [{ label: 'Compartilhar', cls: 'primary', onClick: () => run(share) }] : []));
    // DXF é desenho em metros: só UTM. Os outros aceitam também graus.
    let lastGeo = null;
    const syncCrs = () => {
      const f = $('fFmt').value, need = f === 'shp' || f === 'dxf' || f === 'csv' || f === 'pdf', geo = f !== 'dxf' && f !== 'pdf';
      $('fCrsBox').hidden = !need;
      $('fImgBox').hidden = f !== 'pdf' && f !== 'jpg';
      $('fJpgBox').hidden = $('fJpgChk').hidden = f !== 'jpg';
      $('fPdfChk').hidden = f !== 'pdf';
      if (need && geo !== lastGeo) { $('fCrs').innerHTML = crsOpts(geo); lastGeo = geo; }
    };
    $('fFmt').onchange = syncCrs;
    syncCrs();
    // as opções são lidas na hora do toque: a geração é assíncrona e o modal já terá fechado
    function run(send) {
      const chk = id => !!($(id) && $(id).checked);
      const o = { crs: $('fCrs').value, zone, south, ratio: $('fRatio').value, base: $('fMapT').value, names: chk('fNames'),
        sizes: chk('fSizes'), vertices: chk('fVtx'), hi: chk('fHi'), pMap: chk('fPMap'), pCoord: chk('fPCoord'), pSum: chk('fPSum'), pPhoto: chk('fPPhoto') };
      make($('fFmt').value, o).then(send, err => toast('Não foi possível exportar: ' + err.message, 4000));
    }
  }
  function download(f) {
    const url = URL.createObjectURL(f.data instanceof Blob ? f.data : new Blob([f.data], { type: f.type }));
    const a = document.createElement('a');
    a.href = url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function share(f) {
    const file = new File([f.data], f.name, { type: f.type });
    try {
      if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: f.name });
      else download(f);
    } catch (e) {
      if (e.name !== 'AbortError') download(f);
    }
  }
  $('btnExportAll').onclick = () => {
    const g = $('groupFilter').value;
    exportDialog(store.items.filter(m => !g || m.group === g), g || 'medicoes');
  };
  $('btnImport').onclick = () => $('fileInput').click();

  // Lê os arquivos escolhidos (soltos ou dentro de .zip/.kmz) e devolve { sets: [{ group, items }], notes }
  const extOf = n => ((n.match(/\.([^./\\]+)$/) || [])[1] || '').toLowerCase();
  const stemOf = n => n.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '');
  async function readImport(files) {
    const dec = new TextDecoder();
    const entries = [];
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const e = extOf(f.name);
      if (e === 'zip' || e === 'kmz') {
        const z = await Zip.read(bytes.buffer);
        // no KMZ o KML de dentro (doc.kml) leva o nome do .kmz, que vira o grupo
        Object.keys(z).filter(n => !/(^|\/)(__MACOSX|\.)/.test(n))
          .forEach(n => entries.push({ name: e === 'kmz' && extOf(n) === 'kml' ? stemOf(f.name) + '.kml' : n, bytes: z[n], zip: z }));
      } else entries.push({ name: f.name, bytes });
    }
    const sets = [], notes = [], shps = {};
    for (const en of entries) {
      const e = extOf(en.name);
      if (['shp', 'dbf', 'prj', 'cpg'].includes(e)) {
        const k = en.name.replace(/\.[^.]+$/, '').toLowerCase();
        (shps[k] = shps[k] || { name: stemOf(en.name) })[e] = en.bytes;
      } else if (['kml', 'gpx', 'geojson', 'json'].includes(e)) {
        const text = dec.decode(en.bytes);
        const items = e === 'kml' ? Formats.fromKML(text) : e === 'gpx' ? Formats.fromGPX(text) : Formats.fromGeoJSON(text);
        // fotos citadas no KML: bytes tirados do mesmo ZIP
        if (en.zip) items.forEach(m => (m.photos || []).forEach(ph => { ph.bytes = en.zip[ph.src.replace(/^\.?\//, '')]; }));
        sets.push({ group: stemOf(en.name), items });
      }
    }
    const buf = u => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
    for (const sh of Object.values(shps)) {
      if (!sh.shp) { notes.push(`${sh.name}: falta o arquivo .shp`); continue; }
      let toLL = null;
      if (sh.prj) toLL = Proj.fromPrj(dec.decode(sh.prj));
      else {
        // sem .prj só dá para aceitar coordenadas em graus
        const h = new DataView(buf(sh.shp));
        if ([36, 44, 52, 60].some(o => Math.abs(h.getFloat64(o, true)) > 180)) { notes.push(`${sh.name}: falta o arquivo .prj (sistema de coordenadas)`); continue; }
      }
      const items = Formats.fromSHP(buf(sh.shp), sh.dbf ? buf(sh.dbf) : null, toLL, sh.cpg ? dec.decode(sh.cpg) : '');
      if (items.holes) notes.push(`${sh.name}: ${items.holes} buraco(s) de polígono ignorado(s)`);
      sets.push({ group: sh.name, items });
    }
    return { sets, notes };
  }
  $('fileInput').onchange = async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    try {
      const { sets, notes } = await readImport(files);
      const now = new Date().toISOString();
      const valid = [];
      sets.forEach(({ group, items }) => items.forEach(m => {
        if (m.points.length < { area: 3, distance: 2, poi: 1 }[m.type]) return;
        if (m.type !== 'area') delete m.holes;
        if (!m.points.every(p => isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)) return;
        m.id = uid(); m.created = m.updated = now;
        m.color = m.color || TYPE_COLOR[m.type];
        m.group = m.group || group;
        valid.push(m);
      }));
      if (!valid.length) return toast(['Nenhuma geometria encontrada no arquivo'].concat(notes).join('. '), 5000);
      // fotos (vindas do KMZ) vão para o banco de fotos, fora da medição
      let nPh = 0;
      for (const m of valid) {
        const ph = m.photos || [];
        delete m.photos;
        for (const f of ph) {
          if (!f.bytes) continue;
          try { await Photos.add(m.id, new Blob([f.bytes], { type: 'image/jpeg' }), { caption: f.caption }); nPh++; } catch (err) { /* imagem ilegível */ }
        }
      }
      if (nPh) notes.push(`${nPh} foto(s)`);
      store.items.push(...valid);
      persistItems(); renderSaved(); renderList();
      map.fitBounds(L.latLngBounds(valid.flatMap(m => m.points)), { padding: [40, 40], maxZoom: 18 });
      $('drawer').hidden = true;
      toast([`${valid.length} medição(ões) importada(s)`].concat(notes).join('. '), notes.length ? 5000 : undefined);
    } catch (err) {
      toast('Não foi possível ler o arquivo: ' + err.message, 4000);
    }
  };

  // ---------- Configurações (camadas e unidades) ----------
  function openSettings() {
    const opt = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.label}</option>`).join('');
    modal('Mapa e unidades', `
      ${Object.entries(BASES).map(([k, b]) => `<label class="layer-opt"><input type="radio" name="base" value="${k}" ${k === S.layer ? 'checked' : ''}>${b.label}</label>`).join('')}
      <label class="layer-opt"><input type="checkbox" id="fLabels" ${S.labels ? 'checked' : ''}>Mostrar nomes das medições</label>
      <div class="row2"><div><label for="fAU">Área</label><select id="fAU">${opt(AREA_UNITS, S.areaUnit)}</select></div>
      <div><label for="fLU">Distância</label><select id="fLU">${opt(LEN_UNITS, S.lenUnit)}</select></div></div>
      <div class="row2"><div><label for="fCF">Coordenadas</label><select id="fCF">${opt(COORD_FMTS, S.coordFmt)}</select></div>
      <div><label for="fDT">Datum do UTM</label><select id="fDT">${opt(Proj.DATUMS, S.datum)}</select></div></div>
      <div class="row2"><div><label for="fGD">GPS: marcar a cada (m)</label><input id="fGD" type="number" min="1" max="500" value="${S.gpsMinDist}"></div>
      <div><label for="fGA">GPS: precisão mínima (m)</label><input id="fGA" type="number" min="3" max="200" value="${S.gpsMaxAcc}"></div></div>
      <label for="fGS">GPS: simplificar trechos retos (m; 0 desliga)</label>
      <input id="fGS" type="number" min="0" max="20" step="0.5" value="${S.gpsStraight}">
      <div class="row2"><div><label for="fGO">GPS: deslocamento lateral (m)</label><input id="fGO" type="number" min="0" max="50" step="0.1" value="${S.gpsOffset}"></div>
      <div><label for="fGOS">Lado</label><select id="fGOS"><option value="r" ${S.gpsOffSide !== 'l' ? 'selected' : ''}>à direita</option><option value="l" ${S.gpsOffSide === 'l' ? 'selected' : ''}>à esquerda</option></select></div></div>`,
    [{ label: '⬇ Mapa offline', onClick: () => { applySettings(); openOffline(); return false; } },
      { label: 'Fechar', cls: 'primary', onClick: applySettings }]);
  }
  function applySettings() {
    const base = document.querySelector('input[name=base]:checked').value;
    if (base !== S.layer) setBase(base);
    S.labels = $('fLabels').checked;
    S.areaUnit = $('fAU').value;
    S.lenUnit = $('fLU').value;
    S.gpsMinDist = Math.max(1, +$('fGD').value || defaults.gpsMinDist);
    S.gpsMaxAcc = Math.max(3, +$('fGA').value || defaults.gpsMaxAcc);
    const gs = parseFloat($('fGS').value);
    S.gpsStraight = isFinite(gs) ? Math.min(20, Math.max(0, gs)) : defaults.gpsStraight;
    const go = parseFloat($('fGO').value);
    S.gpsOffset = isFinite(go) ? Math.min(50, Math.max(0, go)) : 0;
    S.gpsOffSide = $('fGOS').value === 'l' ? 'l' : 'r';
    S.coordFmt = COORD_FMTS[$('fCF').value] ? $('fCF').value : 'dd';
    S.datum = Proj.DATUMS[$('fDT').value] ? $('fDT').value : 'sirgas';
    persist(); renderSaved(); renderList();
    if (cur) redraw(); else if (selectedId) selectItem(selectedId);
  }
  $('btnLayers').onclick = openSettings;
  $('btnUnits').onclick = openSettings;

  // ---------- Mapa offline ----------
  const mb = bytes => bytes == null ? '?' : nf(bytes / 1048576, 0) + ' MB';
  function openOffline() {
    const bounds = map.getBounds(), z = Math.round(map.getZoom());
    const base = BASES[S.layer];
    const templates = base.offline || BASES.hybrid.offline;
    const zMin = Math.max(1, Math.min(z, 19) - 4);
    const choices = [];
    for (let zMax = Math.max(zMin, 13); zMax <= 19; zMax++) {
      const n = Offline.count(bounds, zMin, zMax, templates.length);
      choices.push({ zMax, n, ok: n <= Offline.MAX_TILES });
    }
    const usable = choices.filter(c => c.ok);
    const def = usable.length ? usable[usable.length - 1].zMax : null;
    modal('Mapa offline', `
      <p style="margin-top:0">Baixa as imagens da <b>área que está na tela agora</b>, para ver o mapa no campo sem internet.
      Enquadre a fazenda ou a região antes de abrir esta janela.</p>
      ${base.offline ? '' : '<p style="color:var(--muted);font-size:13px">A camada atual não permite download; será baixada a camada Satélite com nomes.</p>'}
      ${def == null ? '<p style="color:var(--danger)">A área na tela é grande demais. Aproxime o mapa e tente de novo.</p>' : `
      <label for="fZ">Nível de detalhe</label>
      <select id="fZ">${choices.map(c => `<option value="${c.zMax}" ${c.ok ? '' : 'disabled'} ${c.zMax === def ? 'selected' : ''}>
        Zoom ${c.zMax}${c.zMax >= 18 ? ' (ver cercas e trilhas)' : c.zMax >= 16 ? ' (ver talhões)' : ''} · ${nf(c.n, 0)} blocos · ~${nf(c.n * 15 / 1024, 0)} MB${c.ok ? '' : ' — grande demais'}</option>`).join('')}
      </select>`}
      <p id="offInfo" style="color:var(--muted);font-size:13px">Verificando o que já está guardado…</p>`,
    [{ label: 'Apagar baixados', cls: 'danger', onClick: () => {
        confirmBox('Apagar mapas baixados', 'Apagar todas as imagens guardadas para uso offline? As medições não são afetadas.', 'Apagar',
          () => Offline.clear().then(() => toast('Mapas offline apagados')), true);
        return false;
      } },
      { label: 'Fechar', cls: 'ghost' }]
      .concat(def == null ? [] : [{ label: 'Baixar', cls: 'primary', onClick: () => {
        const zMax = +$('fZ').value;
        // com o mapa de disponibilidade guardado, o satélite sabe offline onde ampliar o zoom anterior
        startDownload(Offline.tileList(bounds, zMin, zMax, templates).concat(templates.includes(ESRI_SAT)
          ? Offline.blockList(bounds, zMin, Math.min(zMax, 19), ESRI_TILEMAP, TM) : []));
        return false;
      } }]));
    Offline.info().then(i => {
      const el = $('offInfo');
      if (el) el.textContent = `Guardados neste aparelho: ${nf(i.tiles, 0)} blocos · espaço usado pelo app ${mb(i.usage)}` +
        (i.quota ? ` de ${mb(i.quota)} disponíveis` : '');
    });
  }
  async function startDownload(urls) {
    modal('Baixando mapa', `<progress id="dlBar" max="${urls.length}" value="0" style="width:100%"></progress>
      <p id="dlTxt">0 de ${nf(urls.length, 0)}</p>
      <p style="color:var(--muted);font-size:13px">Pode fechar esta janela; o download continua enquanto o app estiver aberto.</p>`,
    [{ label: 'Parar', cls: 'danger', onClick: () => { Offline.stop(); } }, { label: 'Ocultar', cls: 'ghost' }]);
    const r = await Offline.download(urls, (done, total, failed) => {
      if ($('dlBar')) { $('dlBar').value = done; $('dlTxt').textContent = `${nf(done, 0)} de ${nf(total, 0)}` + (failed ? ` · ${failed} falharam` : ''); }
    });
    const msg = r.cancelled ? `Download interrompido: ${nf(r.done, 0)} blocos guardados.`
      : `Mapa guardado: ${nf(r.done - r.failed, 0)} blocos.` + (r.failed ? ` ${r.failed} falharam (sem internet?) — rode de novo para completar.` : '');
    if (!$('modal').hidden && $('dlBar')) modal('Mapa offline', `<p>${msg}</p>`, [{ label: 'OK', cls: 'primary' }]);
    else toast(msg, 5000);
  }

  // ---------- Sincronização ----------
  const fmtTime = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca';
  const KIND_LABEL = { gist: 'GitHub Gist', firebase: 'conta Google' };
  function renderSyncLine(st) {
    const el = $('syncLine');
    if (!st.connected) { el.textContent = '☁ Sincronização desligada — os dados ficam só neste aparelho.'; el.style.color = ''; return; }
    el.style.color = st.error ? 'var(--danger)' : '';
    el.textContent = st.busy ? '☁ Sincronizando…'
      : st.error ? `☁ ${st.error}` : `☁ Sincronizado (${KIND_LABEL[st.kind]}) · ${fmtTime(st.last)}`;
  }
  function openSync() {
    const st = Sync.status();
    if (st.connected) {
      modal('Sincronização', `
        <p style="margin-top:0">Conectado por <b>${KIND_LABEL[st.kind]}</b>${st.account ? ` como <b>${esc(st.account)}</b>` : ''}.</p>
        <p>Última sincronização: ${fmtTime(st.last)}</p>
        ${st.error ? `<p style="color:var(--danger)">${esc(st.error)}</p>` : ''}
        <p style="color:var(--muted);font-size:13px">Sincroniza sozinho ao salvar, ao abrir o app e a cada 5 minutos.</p>`,
      [{ label: 'Desconectar', cls: 'danger', onClick: () => {
          confirmBox('Desconectar', 'Parar de sincronizar este aparelho? As medições continuam aqui e na nuvem.', 'Desconectar',
            () => Sync.disconnect().then(() => toast('Sincronização desligada')), true);
          return false;
        } },
        { label: 'Sincronizar agora', cls: 'primary', onClick: () => { Sync.now(); toast('Sincronizando…'); } }]);
      return;
    }
    const fbOk = Sync.firebaseAvailable();
    modal('Sincronizar aparelhos', `
      <p style="margin-top:0">Conecte <b>todos os seus aparelhos</b> à mesma conta. As medições de cada um se juntam
      e passam a aparecer em todos.</p>
      <button type="button" class="tool primary choice" id="sGoogle" ${fbOk ? '' : 'disabled'}>Entrar com Google</button>
      ${fbOk ? '' : '<p style="color:var(--muted);font-size:13px">Login Google ainda não foi ativado neste site.</p>'}
      <label for="sTok" style="margin-top:16px">Ou: token do GitHub (permissão “gist”)</label>
      <input id="sTok" type="password" autocomplete="off" spellcheck="false" placeholder="ghp_…">
      <button type="button" class="tool choice" id="sGist">Conectar com GitHub</button>`,
    [{ label: 'Fechar', cls: 'ghost' }]);
    $('sGoogle').onclick = () => connectSync('firebase');
    $('sGist').onclick = () => {
      const t = $('sTok').value.trim();
      if (!t) return toast('Cole o token do GitHub');
      connectSync('gist', t);
    };
  }
  async function connectSync(kind, token) {
    modal('Conectando…', '<p>Aguarde, juntando as medições deste aparelho com as da nuvem…</p>', []);
    try {
      const st = await Sync.connect(kind, token);
      closeModal();
      toast(st.error ? 'Conectado, mas: ' + st.error : 'Sincronização ligada', 4000);
    } catch (e) {
      modal('Não foi possível conectar', `<p>${esc(e.message || e)}</p>`,
        [{ label: 'Voltar', cls: 'primary', onClick: () => { openSync(); return false; } }]);
    }
  }
  $('btnSync').onclick = openSync;

  function applyRemote(items, deleted) {
    store.items = items;
    store.deleted = deleted;
    Photos.prune(deleted.map(d => d.id)).catch(() => {});
    persist();
    renderSaved(); renderList();
    if (selectedId) { if (items.some(x => x.id === selectedId)) selectItem(selectedId); else { selectedId = null; showInfo(false); } }
  }

  // ---------- Indicador de conexão ----------
  function renderNet() { $('netBadge').hidden = navigator.onLine; }
  window.addEventListener('online', renderNet);
  window.addEventListener('offline', renderNet);
  renderNet();

  // ---------- Busca ----------
  let searchMarker = null;
  $('searchForm').onsubmit = async e => {
    e.preventDefault();
    const q = $('searchInput').value.trim();
    if (!q) return;
    $('searchInput').blur();
    const m = q.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
    let ll = null, label = q;
    if (m) {
      const a = parseFloat(m[1].replace(',', '.')), b = parseFloat(m[2].replace(',', '.'));
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) ll = [a, b];
    }
    const dms = !ll && (parseDMSPair(q) || parseUTM(q));
    if (dms) ll = dms;
    if (!ll) {
      try {
        const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=pt-BR&q=' + encodeURIComponent(q));
        const j = await r.json();
        if (j[0]) { ll = [+j[0].lat, +j[0].lon]; label = j[0].display_name; }
      } catch (err) { /* sem rede */ }
    }
    if (!ll) return toast('Lugar não encontrado');
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker(ll).addTo(map).bindPopup(esc(label)).openPopup();
    map.setView(ll, m || dms ? 17 : 14);
  };

  // ---------- Início ----------
  renderSaved();
  renderList();
  Sync.init({
    getLocal: () => ({ items: store.items, deleted: store.deleted }),
    applyLocal: applyRemote,
    getCfg: () => { try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); } catch (e) { return {}; } },
    setCfg: c => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(c)); } catch (e) { /* sem armazenamento */ } },
    onStatus: renderSyncLine
  });
  renderSyncLine(Sync.status());
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
