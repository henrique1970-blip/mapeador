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
  const defaults = { areaUnit: 'ha', lenUnit: 'm', layer: 'hybrid', labels: true, gpsMinDist: 5, gpsMaxAcc: 25, view: null };
  let store = { items: [], settings: Object.assign({}, defaults) };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      store.items = Array.isArray(s.items) ? s.items : [];
      store.settings = Object.assign({}, defaults, s.settings || {});
    }
  } catch (e) { /* sem armazenamento: segue em memória */ }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { toast('Não foi possível salvar neste aparelho. Exporte suas medições.'); }
  }
  const S = store.settings;

  function measure(m) {
    if (m.type === 'area') {
      const a = Geo.area(m.points);
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
    const p = m.points[0];
    return `${p[0].toFixed(6)}, ${p[1].toFixed(6)}`;
  }
  function utmText(p) {
    const u = Geo.toUTM(p[0], p[1]);
    return `UTM ${u.zone}${u.hemisphere}  E ${nf(u.easting, 1)}  N ${nf(u.northing, 1)}`;
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
  const sat = () => L.tileLayer(esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 21, attribution: esriAttr });
  const BASES = {
    hybrid: { label: 'Satélite com nomes', make: () => L.layerGroup([sat(),
      L.tileLayer(esri + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 21 }),
      L.tileLayer(esri + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 21 })]) },
    sat: { label: 'Satélite', make: sat },
    osm: { label: 'Ruas (OpenStreetMap)', make: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxNativeZoom: 19, maxZoom: 21, attribution: '© colaboradores do OpenStreetMap' }) },
    topo: { label: 'Topográfico (OpenTopoMap)', make: () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      { maxNativeZoom: 17, maxZoom: 21, subdomains: 'abc', attribution: '© OpenStreetMap, SRTM · estilo © OpenTopoMap (CC-BY-SA)' }) }
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
    if (m.type === 'area') return L.polygon(m.points, { color: c, weight: sel ? 5 : 3, fillOpacity: sel ? 0.35 : 0.22 });
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
      $('infoSub').textContent = `${otherAreas(v.area_m2)} · perímetro ${fmtLen(v.length_m, S.lenUnit)} · ${m.points.length} vértices`;
    } else if (m.type === 'distance') {
      $('infoValue').textContent = fmtLen(measure(m).length_m, S.lenUnit);
      $('infoSub').textContent = `${m.points.length} pontos`;
    } else {
      const p = m.points[0];
      $('infoValue').textContent = `${p[0].toFixed(6)}, ${p[1].toFixed(6)}`;
      $('infoSub').textContent = utmText(p);
    }
    $('infoNotes').textContent = m.notes || '';
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
      persist(); selectedId = null; showInfo(false); renderSaved(); renderList();
      toast('Medição excluída');
    }, true);
  };
  $('btnInfoEdit').onclick = () => {
    const m = store.items.find(x => x.id === selectedId);
    if (m) startDraw(m.type, m);
  };
  $('btnInfoShare').onclick = () => {
    const m = store.items.find(x => x.id === selectedId);
    if (m) exportDialog([m], m.name);
  };

  // ---------- Desenho / edição ----------
  let cur = null; // { item, editingId, history, sel, mode, dirty }

  function startDraw(type, existing) {
    closeFabMenu();
    showInfo(false);
    selectedId = null;
    const item = existing
      ? JSON.parse(JSON.stringify(existing))
      : { id: uid(), type, name: '', group: '', color: TYPE_COLOR[type], notes: '', points: [] };
    cur = { item, editingId: existing ? existing.id : null, history: [], sel: item.points.length - 1, mode: 'manual', dirty: false };
    map.doubleClickZoom.disable();
    $('fabWrap').hidden = true;
    $('drawPanel').hidden = false;
    $('drawKind').textContent = (existing ? 'Editando · ' : 'Nova ') + TYPE_LABEL[type].toLowerCase();
    $('btnMode').hidden = type === 'poi';
    $('btnDelVertex').hidden = type === 'poi';
    setMode('manual');
    renderSaved();
    redraw();
    if (existing) fitItem(existing);
  }
  function endDraw() {
    if (cur && cur.mode === 'gps') stopGpsRecording();
    cur = null;
    editLayer.clearLayers();
    map.doubleClickZoom.enable();
    $('drawPanel').hidden = true;
    $('fabWrap').hidden = false;
    renderSaved();
  }
  function snapshot() {
    cur.history.push({ points: cur.item.points.map(p => p.slice()), sel: cur.sel });
    if (cur.history.length > 200) cur.history.shift();
    cur.dirty = true;
  }
  function addPoint(latlng) {
    snapshot();
    const p = [latlng[0], latlng[1]];
    if (cur.item.type === 'poi') { cur.item.points = [p]; cur.sel = 0; }
    else {
      const at = (cur.sel == null || cur.sel < 0) ? cur.item.points.length : cur.sel + 1;
      cur.item.points.splice(at, 0, p);
      cur.sel = at;
    }
    redraw();
  }

  const vtxIcon = (sel, first) => L.divIcon({ className: 'vtx' + (sel ? ' sel' : '') + (first ? ' first' : '') });
  const midIcon = L.divIcon({ className: 'mid' });

  function redraw() {
    editLayer.clearLayers();
    const m = cur.item, pts = m.points, c = m.color || TYPE_COLOR[m.type];
    let shape = null;
    if (m.type === 'area' && pts.length >= 2) {
      shape = (pts.length >= 3 ? L.polygon(pts, { color: c, weight: 3, fillOpacity: 0.25, interactive: false })
        : L.polyline(pts, { color: c, weight: 3, interactive: false })).addTo(editLayer);
    } else if (m.type === 'distance' && pts.length >= 2) {
      shape = L.polyline(pts, { color: c, weight: 4, interactive: false }).addTo(editLayer);
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
      mk.on('drag', e => { if (inserted) { pts[i + 1] = [e.latlng.lat, e.latlng.lng]; if (shape) shape.setLatLngs(pts); updateDrawPanel(); } });
      mk.on('dragend', redraw);
      mk.addTo(editLayer);
    }
    pts.forEach((p, i) => {
      const mk = L.marker(p, { icon: vtxIcon(i === cur.sel, i === 0 && pts.length > 1), draggable: true, zIndexOffset: 100 });
      mk.on('click', e => { L.DomEvent.stop(e); cur.sel = i; redraw(); });
      mk.on('dragstart', () => { snapshot(); cur.sel = i; });
      mk.on('drag', e => { pts[i] = [e.latlng.lat, e.latlng.lng]; if (shape) shape.setLatLngs(pts); updateDrawPanel(); });
      mk.on('dragend', redraw);
      mk.addTo(editLayer);
    });
    updateDrawPanel();
  }

  function updateDrawPanel() {
    const m = cur.item, pts = m.points;
    let val = '—', sub = '';
    if (m.type === 'area') {
      const a = pts.length >= 3 ? Geo.area(pts) : 0;
      const per = Geo.length(pts, pts.length >= 3);
      if (pts.length >= 3) { val = fmtArea(a, S.areaUnit); sub = `${otherAreas(a)} · perímetro ${fmtLen(per, S.lenUnit)}`; }
      else sub = pts.length ? `${pts.length} vértice(s) — faltam ${3 - pts.length}` : '';
    } else if (m.type === 'distance') {
      if (pts.length >= 2) { val = fmtLen(Geo.length(pts, false), S.lenUnit); sub = `${pts.length} pontos`; }
      else sub = pts.length ? 'Marque o próximo ponto' : '';
    } else if (pts.length) {
      val = `${pts[0][0].toFixed(6)}, ${pts[0][1].toFixed(6)}`;
      sub = utmText(pts[0]);
    }
    $('drawValue').textContent = val;
    $('drawSub').textContent = sub;
    const sp = pts[cur.sel];
    const vi = $('vertexInfo');
    if (sp && m.type !== 'poi') {
      vi.hidden = false;
      vi.textContent = `Vértice ${cur.sel + 1}: ${sp[0].toFixed(6)}, ${sp[1].toFixed(6)}\n${utmText(sp)}`;
      vi.style.whiteSpace = 'pre-wrap';
    } else vi.hidden = true;
    $('btnUndo').disabled = !cur.history.length;
    $('btnDelVertex').disabled = !sp;
    let hint;
    if (cur.mode === 'gps') hint = `Caminhe pelo contorno. Um ponto é marcado a cada ${S.gpsMinDist} m, com precisão de até ${S.gpsMaxAcc} m.`;
    else if (m.type === 'poi') hint = 'Toque no mapa ou use “📍 Aqui” para marcar o ponto. Arraste para ajustar.';
    else hint = 'Toque no mapa para marcar. Arraste um vértice para ajustar; toque no ponto do meio de um lado para inserir.';
    $('drawHint').textContent = hint;
  }

  map.on('click', e => {
    if (!cur || cur.mode === 'gps') return;
    addPoint([e.latlng.lat, e.latlng.lng]);
  });

  function undo() {
    if (!cur || !cur.history.length) return;
    const h = cur.history.pop();
    cur.item.points = h.points; cur.sel = h.sel;
    redraw();
  }
  function deleteVertex() {
    if (!cur || cur.item.points[cur.sel] == null) return;
    snapshot();
    cur.item.points.splice(cur.sel, 1);
    cur.sel = Math.min(cur.sel, cur.item.points.length - 1);
    redraw();
  }
  $('btnUndo').onclick = undo;
  $('btnDelVertex').onclick = deleteVertex;
  document.addEventListener('keydown', e => {
    if (!cur || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || !$('modal').hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteVertex(); }
  });

  $('btnCancel').onclick = () => {
    if (!cur.dirty) return endDraw();
    confirmBox('Descartar', 'Descartar as alterações desta medição?', 'Descartar', endDraw, true);
  };

  $('btnSave').onclick = () => {
    const m = cur.item, need = { area: 3, distance: 2, poi: 1 }[m.type];
    if (m.points.length < need) return toast(`Marque pelo menos ${need} ponto(s).`);
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
        if (cur.editingId) store.items = store.items.map(x => x.id === cur.editingId ? m : x);
        else { m.created = now; store.items.push(m); }
        persist();
        const id = m.id;
        endDraw();
        renderList();
        selectItem(id);
        toast('Medição salva');
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

  function gpsRecord(f) {
    if (f.acc > S.gpsMaxAcc) return;
    const pts = cur.item.points;
    const last = pts[pts.length - 1];
    if (last && Geo.distance(last, f.ll) < S.gpsMinDist) return;
    cur.sel = pts.length - 1;
    addPoint(f.ll);
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
      $('btnMode').textContent = '🚶 GPS ligado';
      $('btnMode').classList.add('on');
      toast('Gravação por GPS: caminhe pelo contorno');
      if (lastFix) gpsRecord(lastFix);
    } else {
      if (cur.mode === 'gps') stopGpsRecording();
      cur.mode = 'manual';
      $('btnMode').textContent = '✋ Manual';
      $('btnMode').classList.remove('on');
    }
    updateDrawPanel();
  }
  $('btnMode').onclick = () => setMode(cur.mode === 'gps' ? 'manual' : 'gps');

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
  function exportDialog(items, baseName) {
    if (!items.length) return toast('Nada para exportar');
    const safe = (baseName || 'medicoes').replace(/[^\wÀ-ſ -]+/g, '').trim().replace(/\s+/g, '_') || 'medicoes';
    const canShare = !!(navigator.canShare && navigator.share);
    const make = fmt => {
      if (fmt === 'kml') return { name: safe + '.kml', type: 'application/vnd.google-earth.kml+xml', data: Formats.toKML(items, describe) };
      if (fmt === 'geojson') return { name: safe + '.geojson', type: 'application/geo+json', data: Formats.toGeoJSON(items, measure) };
      return { name: safe + '.csv', type: 'text/csv', data: Formats.toCSV(items, measure) };
    };
    modal('Exportar', `
      <label for="fFmt">Formato</label>
      <select id="fFmt">
        <option value="kml">KML (Google Earth, QGIS, GPS)</option>
        <option value="geojson">GeoJSON (QGIS, SIG)</option>
        <option value="csv">CSV (Excel, com áreas e coordenadas)</option>
      </select>
      <p style="color:var(--muted);font-size:13px">${items.length} medição(ões)</p>`,
    [{ label: 'Baixar', cls: canShare ? '' : 'primary', onClick: () => download(make($('fFmt').value)) }]
      .concat(canShare ? [{ label: 'Compartilhar', cls: 'primary', onClick: () => share(make($('fFmt').value)) }] : []));
  }
  function download(f) {
    const url = URL.createObjectURL(new Blob([f.data], { type: f.type }));
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
  $('fileInput').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const isKml = /\.kml$/i.test(file.name) || /^\s*<\?xml|<kml/i.test(text);
      const got = isKml ? Formats.fromKML(text) : Formats.fromGeoJSON(text);
      const valid = got.filter(m => m.points.length >= ({ area: 3, distance: 2, poi: 1 }[m.type]));
      if (!valid.length) return toast('Nenhuma geometria encontrada no arquivo');
      const now = new Date().toISOString();
      valid.forEach(m => {
        m.id = uid(); m.created = m.updated = now;
        m.color = m.color || TYPE_COLOR[m.type];
        m.group = m.group || file.name.replace(/\.[^.]+$/, '');
      });
      store.items.push(...valid);
      persist(); renderSaved(); renderList();
      map.fitBounds(L.latLngBounds(valid.flatMap(m => m.points)), { padding: [40, 40], maxZoom: 18 });
      $('drawer').hidden = true;
      toast(`${valid.length} medição(ões) importada(s)`);
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
      <div class="row2"><div><label for="fGD">GPS: marcar a cada (m)</label><input id="fGD" type="number" min="1" max="500" value="${S.gpsMinDist}"></div>
      <div><label for="fGA">GPS: precisão mínima (m)</label><input id="fGA" type="number" min="3" max="200" value="${S.gpsMaxAcc}"></div></div>`,
    [{ label: 'Fechar', cls: 'primary', onClick: () => {
      const base = document.querySelector('input[name=base]:checked').value;
      if (base !== S.layer) setBase(base);
      S.labels = $('fLabels').checked;
      S.areaUnit = $('fAU').value;
      S.lenUnit = $('fLU').value;
      S.gpsMinDist = Math.max(1, +$('fGD').value || defaults.gpsMinDist);
      S.gpsMaxAcc = Math.max(3, +$('fGA').value || defaults.gpsMaxAcc);
      persist(); renderSaved(); renderList();
      if (cur) redraw(); else if (selectedId) selectItem(selectedId);
    } }]);
  }
  $('btnLayers').onclick = openSettings;
  $('btnUnits').onclick = openSettings;

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
    map.setView(ll, m ? 17 : 14);
  };

  // ---------- Início ----------
  renderSaved();
  renderList();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
