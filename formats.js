// Conversão de medições para/de KML, GeoJSON e CSV.
// Medição: { id, type: 'area'|'distance'|'poi', name, group, color, notes, points: [[lat,lng],...], created, updated }
(function (root) {
  'use strict';

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }
  // KML usa aabbggrr
  function kmlColor(hex, alpha) {
    const h = (hex || '#ffeb3b').replace('#', '');
    return alpha + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
  }
  function coordStr(points, close) {
    const pts = close ? points.concat([points[0]]) : points;
    return pts.map(p => `${p[1].toFixed(8)},${p[0].toFixed(8)},0`).join(' ');
  }

  function toKML(items, describe) {
    const styles = [], marks = [];
    items.forEach((m, i) => {
      const sid = 's' + i;
      styles.push(`<Style id="${sid}"><LineStyle><color>${kmlColor(m.color, 'ff')}</color><width>3</width></LineStyle>` +
        `<PolyStyle><color>${kmlColor(m.color, '55')}</color></PolyStyle>` +
        `<IconStyle><color>${kmlColor(m.color, 'ff')}</color></IconStyle></Style>`);
      const desc = [describe ? describe(m) : '', m.group ? 'Grupo: ' + m.group : '', m.notes || ''].filter(Boolean).join('\n');
      let geom;
      if (m.type === 'area') {
        geom = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordStr(m.points, true)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      } else if (m.type === 'distance') {
        geom = `<LineString><tessellate>1</tessellate><coordinates>${coordStr(m.points, false)}</coordinates></LineString>`;
      } else {
        geom = `<Point><coordinates>${coordStr(m.points.slice(0, 1), false)}</coordinates></Point>`;
      }
      marks.push(`<Placemark><name>${esc(m.name)}</name><description>${esc(desc)}</description>` +
        `<styleUrl>#${sid}</styleUrl>` +
        `<ExtendedData><Data name="grupo"><value>${esc(m.group)}</value></Data>` +
        `<Data name="tipo"><value>${m.type}</value></Data></ExtendedData>${geom}</Placemark>`);
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>` +
      `<name>Mapeador de Áreas</name>${styles.join('')}${marks.join('')}</Document></kml>`;
  }

  function toGeoJSON(items, measure) {
    return JSON.stringify({
      type: 'FeatureCollection',
      features: items.map(m => {
        const ll = m.points.map(p => [p[1], p[0]]);
        let geometry;
        if (m.type === 'area') geometry = { type: 'Polygon', coordinates: [ll.concat([ll[0]])] };
        else if (m.type === 'distance') geometry = { type: 'LineString', coordinates: ll };
        else geometry = { type: 'Point', coordinates: ll[0] };
        return {
          type: 'Feature', geometry,
          properties: Object.assign({ name: m.name, group: m.group || '', type: m.type, color: m.color, notes: m.notes || '' },
            measure ? measure(m) : {})
        };
      })
    }, null, 1);
  }

  // xy: coordenadas em outro sistema ({ head: 'utm_23S_sirgas_2000_E_N', f: p => [E, N] }); sem ele, lat lng
  function toCSV(items, measure, xy) {
    const rows = [['nome', 'grupo', 'tipo', 'area_m2', 'area_ha', 'perimetro_ou_comprimento_m', 'vertices', xy ? xy.head : 'lat_lng']];
    const fmt = xy ? p => xy.f(p).map(v => v.toFixed(3)).join(' ') : p => `${p[0].toFixed(7)} ${p[1].toFixed(7)}`;
    items.forEach(m => {
      const v = measure(m);
      rows.push([m.name, m.group || '', m.type, v.area_m2 ?? '', v.area_ha ?? '', v.length_m ?? '', m.points.length,
        m.points.map(fmt).join('; ')]);
    });
    return '﻿' + rows.map(r => r.map(c => {
      const s = String(c);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';')).join('\r\n');
  }

  // ---------- Importação ----------
  function parseCoords(text) {
    return text.trim().split(/\s+/).map(t => t.split(',').map(Number))
      .filter(c => c.length >= 2 && isFinite(c[0]) && isFinite(c[1]))
      .map(c => [c[1], c[0]]);
  }
  function dropClosing(pts) {
    if (pts.length > 1) {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) return pts.slice(0, -1);
    }
    return pts;
  }

  function fromKML(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('KML inválido');
    const out = [];
    const byTag = (el, tag) => Array.from(el.getElementsByTagNameNS('*', tag));
    byTag(doc, 'Placemark').forEach((pm, i) => {
      const nameEl = byTag(pm, 'name')[0];
      const descEl = byTag(pm, 'description')[0];
      const base = { name: nameEl ? nameEl.textContent.trim() : 'Importado ' + (i + 1), notes: descEl ? descEl.textContent.trim() : '' };
      byTag(pm, 'Data').forEach(d => {
        if (d.getAttribute('name') === 'grupo') base.group = (byTag(d, 'value')[0] || {}).textContent || '';
      });
      byTag(pm, 'Polygon').forEach(pg => {
        const outer = byTag(pg, 'outerBoundaryIs')[0] || pg;
        const c = byTag(outer, 'coordinates')[0];
        if (c) out.push(Object.assign({ type: 'area', points: dropClosing(parseCoords(c.textContent)) }, base));
      });
      byTag(pm, 'LineString').forEach(ls => {
        const c = byTag(ls, 'coordinates')[0];
        if (c) out.push(Object.assign({ type: 'distance', points: parseCoords(c.textContent) }, base));
      });
      byTag(pm, 'Point').forEach(pt => {
        const c = byTag(pt, 'coordinates')[0];
        if (c) out.push(Object.assign({ type: 'poi', points: parseCoords(c.textContent).slice(0, 1) }, base));
      });
    });
    return out;
  }

  function fromGeoJSON(text) {
    const gj = JSON.parse(text);
    const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', geometry: gj, properties: {} }];
    const out = [];
    const ll = c => [c[1], c[0]];
    feats.forEach((f, i) => {
      const p = f.properties || {};
      const base = { name: p.name || p.nome || 'Importado ' + (i + 1), group: p.group || p.grupo || '', notes: p.notes || '' };
      if (p.color) base.color = p.color;
      const g = f.geometry;
      if (!g) return;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      polys.forEach(poly => out.push(Object.assign({ type: 'area', points: dropClosing(poly[0].map(ll)) }, base)));
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      lines.forEach(line => out.push(Object.assign({ type: 'distance', points: line.map(ll) }, base)));
      const pts = g.type === 'Point' ? [g.coordinates] : g.type === 'MultiPoint' ? g.coordinates : [];
      pts.forEach(pt => out.push(Object.assign({ type: 'poi', points: [ll(pt)] }, base)));
    });
    return out;
  }

  // ---------- GPX ----------
  const sameP = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  function fromGPX(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX inválido');
    const byTag = (el, tag) => Array.from(el.getElementsByTagNameNS('*', tag));
    const child = (el, tag) => Array.from(el.children).find(c => c.localName === tag);
    const txt = (el, tag) => { const c = child(el, tag); return c ? c.textContent.trim() : ''; };
    const pt = el => [parseFloat(el.getAttribute('lat')), parseFloat(el.getAttribute('lon'))];
    const ok = p => isFinite(p[0]) && isFinite(p[1]);
    const out = [];
    let n = 0;
    const base = el => ({ name: txt(el, 'name') || 'Importado ' + (++n), notes: txt(el, 'desc') || txt(el, 'cmt') });
    // trilha fechada (o primeiro ponto repetido no fim) vira área, que é como o GPX guarda polígonos
    const line = (b, pts) => {
      pts = pts.filter(ok);
      if (pts.length >= 4 && sameP(pts[0], pts[pts.length - 1])) out.push(Object.assign({ type: 'area', points: pts.slice(0, -1) }, b));
      else out.push(Object.assign({ type: 'distance', points: pts }, b));
    };
    byTag(doc, 'wpt').forEach(w => { const p = pt(w); if (ok(p)) out.push(Object.assign({ type: 'poi', points: [p] }, base(w))); });
    byTag(doc, 'rte').forEach(r => line(base(r), byTag(r, 'rtept').map(pt)));
    byTag(doc, 'trk').forEach(t => {
      const b = base(t), segs = byTag(t, 'trkseg');
      segs.forEach((s, i) => line(segs.length > 1 ? Object.assign({}, b, { name: `${b.name} (${i + 1})` }) : b, byTag(s, 'trkpt').map(pt)));
    });
    return out;
  }
  function toGPX(items, describe) {
    const ll = p => `lat="${p[0].toFixed(8)}" lon="${p[1].toFixed(8)}"`;
    const meta = m => `<name>${esc(m.name)}</name><desc>${esc([describe ? describe(m) : '', m.group ? 'Grupo: ' + m.group : '', m.notes || ''].filter(Boolean).join('\n'))}</desc>`;
    const wpts = items.filter(m => m.type === 'poi').map(m => `<wpt ${ll(m.points[0])}>${meta(m)}</wpt>`);
    const trks = items.filter(m => m.type !== 'poi').map(m => {
      const pts = m.type === 'area' ? m.points.concat([m.points[0]]) : m.points;
      return `<trk>${meta(m)}<trkseg>${pts.map(p => `<trkpt ${ll(p)}/>`).join('')}</trkseg></trk>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Mapeador de Áreas" xmlns="http://www.topografix.com/GPX/1/1">` +
      wpts.join('') + trks.join('') + '</gpx>';
  }

  // ---------- Shapefile ----------
  // Leitura: shp (geometria) + dbf (atributos) + prj (sistema) + cpg (codificação).
  // toLL converte [x, y] do arquivo em [lat, lng]; sem .prj, o arquivo precisa estar em graus.
  function fromSHP(shpBuf, dbfBuf, toLL, cpg) {
    const dv = new DataView(shpBuf);
    if (dv.getInt32(0, false) !== 9994) throw new Error('arquivo .shp inválido');
    const recs = dbfBuf ? readDBF(dbfBuf, cpg) : [];
    const conv = toLL || (xy => [xy[1], xy[0]]);
    const out = [];
    let p = 100, i = 0, skipped = 0;
    while (p + 12 <= shpBuf.byteLength) {
      const len = dv.getInt32(p + 4, false) * 2;
      const type = dv.getInt32(p + 8, true);
      const r = p + 8;
      const attrs = recs[i] || {};
      const base = attrBase(attrs, i);
      const read = (o, n) => { const a = []; for (let k = 0; k < n; k++) a.push(conv([dv.getFloat64(o + k * 16, true), dv.getFloat64(o + k * 16 + 8, true)])); return a; };
      const kind = type % 10; // 1 ponto, 3 linha, 5 polígono, 8 multiponto (Z = +10, M = +20)
      if (kind === 1) out.push(Object.assign({ type: 'poi', points: read(r + 4, 1) }, base));
      else if (kind === 8) {
        const np = dv.getInt32(r + 36, true);
        read(r + 40, np).forEach(pt => out.push(Object.assign({ type: 'poi', points: [pt] }, base)));
      } else if (kind === 3 || kind === 5) {
        const nParts = dv.getInt32(r + 36, true), nPts = dv.getInt32(r + 40, true);
        const idx = []; for (let k = 0; k < nParts; k++) idx.push(dv.getInt32(r + 44 + k * 4, true));
        const all = read(r + 44 + nParts * 4, nPts);
        const parts = idx.map((s, k) => all.slice(s, k + 1 < nParts ? idx[k + 1] : nPts));
        // polígono: anel horário é contorno, anti-horário é buraco (o app ainda não tem buracos)
        const rings = kind === 5 ? parts.filter(ring => { const outer = signedArea(ring) < 0; if (!outer) skipped++; return outer; }) : parts;
        rings.forEach((pts, k) => {
          const b = rings.length > 1 ? Object.assign({}, base, { name: `${base.name} (${k + 1})` }) : base;
          out.push(Object.assign({ type: kind === 5 ? 'area' : 'distance', points: kind === 5 ? dropClosing(pts) : pts }, b));
        });
      }
      p += 8 + len; i++;
    }
    out.holes = skipped;
    return out;
  }
  // área com sinal em [lat,lng]: negativa = horário visto com o norte para cima (x = lng)
  function signedArea(ring) {
    let s = 0;
    for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) s += (ring[j][1] * ring[k][0] - ring[k][1] * ring[j][0]);
    return s / 2;
  }
  const NAME_FIELDS = /^(nome|name|denomina|descricao|descrição|desc|label|titulo|id)/i;
  const GROUP_FIELDS = /^(grupo|group|layer|camada)$/i;
  function attrBase(attrs, i) {
    const keys = Object.keys(attrs);
    const nk = keys.find(k => /^(nome|name)$/i.test(k)) || keys.find(k => NAME_FIELDS.test(k) && String(attrs[k]).trim());
    const gk = keys.find(k => GROUP_FIELDS.test(k));
    const base = { name: (nk && String(attrs[nk]).trim()) || 'Importado ' + (i + 1) };
    if (gk && String(attrs[gk]).trim()) base.group = String(attrs[gk]).trim();
    if (/^#[0-9a-f]{6}$/i.test(attrs.COR || attrs.cor || '')) base.color = attrs.COR || attrs.cor;
    const skip = new Set([nk, gk, 'COR', 'cor', 'TIPO', 'AREA_HA', 'AREA_M2', 'PERIM_M']);
    const notes = String(attrs.NOTAS || attrs.notas || '').trim();
    const extra = keys.filter(k => !skip.has(k) && !/^notas$/i.test(k) && String(attrs[k]).trim() !== '').map(k => `${k}: ${String(attrs[k]).trim()}`);
    base.notes = [notes, ...extra].filter(Boolean).join('\n');
    return base;
  }
  function readDBF(buf, cpg) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const n = dv.getUint32(4, true), hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true);
    const enc = /utf-?8/i.test(cpg || '') ? 'utf-8' : cpg && /1252|latin|8859/i.test(cpg) ? 'windows-1252' : null;
    const dec = bytes => {
      if (enc) return new TextDecoder(enc).decode(bytes);
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
    };
    const fields = [];
    for (let o = 32; o < hlen - 1 && u8[o] !== 0x0D; o += 32) {
      fields.push({ name: dec(u8.subarray(o, o + 11)).replace(/\0[\s\S]*$/, '').trim(), type: String.fromCharCode(u8[o + 11]), len: u8[o + 16] });
    }
    const recs = [];
    for (let r = 0; r < n; r++) {
      let o = hlen + r * rlen + 1;
      const rec = {};
      fields.forEach(f => {
        const s = dec(u8.subarray(o, o + f.len)).trim();
        rec[f.name] = (f.type === 'N' || f.type === 'F') && s !== '' && isFinite(+s) ? +s : s;
        o += f.len;
      });
      recs.push(rec);
    }
    return recs;
  }

  // Gravação: um conjunto de arquivos por tipo (áreas, linhas, pontos).
  // proj: [lat,lng] → [x, y]; prj: texto do .prj. Devolve [{ name, data }].
  const DBF_FIELDS = [['NOME', 'C', 80, 0], ['GRUPO', 'C', 50, 0], ['TIPO', 'C', 10, 0], ['AREA_HA', 'N', 18, 4],
    ['AREA_M2', 'N', 18, 2], ['PERIM_M', 'N', 18, 2], ['COR', 'C', 7, 0], ['NOTAS', 'C', 254, 0]];
  function toSHP(items, measure, proj, prj, baseName) {
    const files = [];
    [['area', 5, '_areas'], ['distance', 3, '_linhas'], ['poi', 1, '_pontos']].forEach(([t, shpType, suf]) => {
      const list = items.filter(m => m.type === t);
      if (!list.length) return;
      const geoms = list.map(m => {
        let pts = m.points.map(proj);
        if (t === 'area') {
          // contorno no sentido horário, fechado
          if (signedArea(pts.map(q => [q[1], q[0]])) > 0) pts = pts.slice().reverse();
          pts = pts.concat([pts[0]]);
        }
        return pts;
      });
      const name = baseName + suf;
      const [shp, shx] = writeSHP(geoms, shpType);
      files.push({ name: name + '.shp', data: shp }, { name: name + '.shx', data: shx },
        { name: name + '.dbf', data: writeDBF(list.map(m => {
          const v = measure(m);
          return { NOME: m.name, GRUPO: m.group || '', TIPO: { area: 'area', distance: 'linha', poi: 'ponto' }[t],
            AREA_HA: v.area_ha, AREA_M2: v.area_m2, PERIM_M: v.length_m, COR: m.color || '', NOTAS: m.notes || '' };
        })) },
        { name: name + '.prj', data: prj }, { name: name + '.cpg', data: 'UTF-8' });
    });
    return files;
  }
  function bbox(pts) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    pts.forEach(p => { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); });
    return b;
  }
  function writeSHP(geoms, type) {
    const sizes = geoms.map(g => type === 1 ? 20 : 44 + 4 + g.length * 16);
    const shpLen = 100 + sizes.reduce((s, c) => s + 8 + c, 0), shxLen = 100 + geoms.length * 8;
    const shp = new DataView(new ArrayBuffer(shpLen)), shx = new DataView(new ArrayBuffer(shxLen));
    const all = bbox(geoms.flat());
    [[shp, shpLen], [shx, shxLen]].forEach(([h, len]) => {
      h.setInt32(0, 9994, false); h.setInt32(24, len / 2, false); h.setInt32(28, 1000, true); h.setInt32(32, type, true);
      all.forEach((v, k) => h.setFloat64(36 + k * 8, v, true));
    });
    let o = 100;
    geoms.forEach((g, i) => {
      shx.setInt32(100 + i * 8, o / 2, false); shx.setInt32(104 + i * 8, sizes[i] / 2, false);
      shp.setInt32(o, i + 1, false); shp.setInt32(o + 4, sizes[i] / 2, false);
      const r = o + 8;
      shp.setInt32(r, type, true);
      if (type === 1) { shp.setFloat64(r + 4, g[0][0], true); shp.setFloat64(r + 12, g[0][1], true); }
      else {
        bbox(g).forEach((v, k) => shp.setFloat64(r + 4 + k * 8, v, true));
        shp.setInt32(r + 36, 1, true); shp.setInt32(r + 40, g.length, true); shp.setInt32(r + 44, 0, true);
        g.forEach((q, k) => { shp.setFloat64(r + 48 + k * 16, q[0], true); shp.setFloat64(r + 56 + k * 16, q[1], true); });
      }
      o += 8 + sizes[i];
    });
    return [new Uint8Array(shp.buffer), new Uint8Array(shx.buffer)];
  }
  function writeDBF(recs) {
    const enc = new TextEncoder();
    const rlen = 1 + DBF_FIELDS.reduce((s, f) => s + f[2], 0), hlen = 32 + DBF_FIELDS.length * 32 + 1;
    const u8 = new Uint8Array(hlen + recs.length * rlen + 1), dv = new DataView(u8.buffer);
    const d = new Date();
    u8[0] = 0x03; u8[1] = d.getFullYear() - 1900; u8[2] = d.getMonth() + 1; u8[3] = d.getDate();
    dv.setUint32(4, recs.length, true); dv.setUint16(8, hlen, true); dv.setUint16(10, rlen, true);
    DBF_FIELDS.forEach(([name, type, len, dec], k) => {
      const o = 32 + k * 32;
      u8.set(enc.encode(name), o); u8[o + 11] = type.charCodeAt(0); u8[o + 16] = len; u8[o + 17] = dec;
    });
    u8[hlen - 1] = 0x0D;
    // texto cortado no limite do campo sem partir um caractere UTF-8 no meio
    const fit = (s, len) => {
      let b = enc.encode(s);
      if (b.length > len) { let e = len; while (e > 0 && (b[e] & 0xC0) === 0x80) e--; b = b.subarray(0, e); }
      return b;
    };
    recs.forEach((r, i) => {
      let o = hlen + i * rlen;
      u8.fill(0x20, o, o + rlen);
      o++;
      DBF_FIELDS.forEach(([name, type, len, dec]) => {
        const v = r[name];
        if (type === 'N') { if (v != null && isFinite(v)) u8.set(enc.encode(Number(v).toFixed(dec).padStart(len).slice(-len)), o); }
        else u8.set(fit(String(v ?? '').replace(/[\r\n]+/g, ' '), len), o);
        o += len;
      });
    });
    u8[u8.length - 1] = 0x1A;
    return u8;
  }

  // ---------- DXF (R12, abre em qualquer CAD) ----------
  // proj: [lat,lng] → [E, N] em metros. Camadas pelo grupo; nome de cada medição como texto.
  function toDXF(items, proj, describe) {
    const out = [];
    const g = (code, v) => out.push(String(code), String(v));
    // R12 é ANSI: grava em Windows-1252 (acentos do português) e o resto como \U+XXXX
    const t = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e\xa0-\xff]/g, c => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
    const layerOf = m => (m.group || 'MEDICOES').replace(/[<>/\\":;?*|=,`]/g, '_').slice(0, 64) || 'MEDICOES';
    const geoms = items.map(m => m.points.map(proj));
    const b = bbox(geoms.flat());
    const h = Math.max(1, Math.min(50, Math.max(b[2] - b[0], b[3] - b[1]) / 80)); // altura do texto
    const layers = [...new Set(items.map(layerOf))];
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252');
    g(9, '$EXTMIN'); g(10, b[0]); g(20, b[1]); g(30, 0);
    g(9, '$EXTMAX'); g(10, b[2]); g(20, b[3]); g(30, 0);
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
    layers.forEach((l, i) => { g(0, 'LAYER'); g(2, t(l)); g(70, 0); g(62, (i % 6) + 1); g(6, 'CONTINUOUS'); });
    g(0, 'ENDTAB'); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    items.forEach((m, i) => {
      const pts = geoms[i], layer = t(layerOf(m));
      if (m.type === 'poi') { g(0, 'POINT'); g(8, layer); g(10, pts[0][0].toFixed(3)); g(20, pts[0][1].toFixed(3)); g(30, 0); }
      else {
        g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, m.type === 'area' ? 1 : 0);
        pts.forEach(p => { g(0, 'VERTEX'); g(8, layer); g(10, p[0].toFixed(3)); g(20, p[1].toFixed(3)); g(30, 0); });
        g(0, 'SEQEND'); g(8, layer);
      }
      // rótulo: no ponto, no meio da linha ou no centro do polígono
      const at = m.type === 'poi' ? [pts[0][0] + h * 0.6, pts[0][1] + h * 0.6]
        : m.type === 'distance' ? pts[Math.floor(pts.length / 2)]
          : pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
      const label = [m.name, describe ? describe(m) : ''].filter(Boolean);
      label.forEach((s, k) => { g(0, 'TEXT'); g(8, layer); g(10, at[0].toFixed(3)); g(20, (at[1] - k * h * 1.4).toFixed(3)); g(30, 0); g(40, (k ? h * 0.7 : h).toFixed(2)); g(1, t(s)); });
    });
    g(0, 'ENDSEC'); g(0, 'EOF');
    return Uint8Array.from(out.join('\r\n') + '\r\n', c => c.charCodeAt(0));
  }

  root.Formats = { toKML, toGeoJSON, toCSV, toGPX, toSHP, toDXF, fromKML, fromGeoJSON, fromGPX, fromSHP };
})(this);
