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

  function toCSV(items, measure) {
    const rows = [['nome', 'grupo', 'tipo', 'area_m2', 'area_ha', 'perimetro_ou_comprimento_m', 'vertices', 'lat_lng']];
    items.forEach(m => {
      const v = measure(m);
      rows.push([m.name, m.group || '', m.type, v.area_m2 ?? '', v.area_ha ?? '', v.length_m ?? '', m.points.length,
        m.points.map(p => `${p[0].toFixed(7)} ${p[1].toFixed(7)}`).join('; ')]);
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

  root.Formats = { toKML, toGeoJSON, toCSV, fromKML, fromGeoJSON };
})(this);
