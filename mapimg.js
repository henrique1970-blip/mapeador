// Imagem do mapa com as medições, desenhada num canvas fora da tela (para o JPG e o relatório PDF).
// Os blocos do mapa vêm de funções (z, x, y) → { img, sx, sy, sw } (recorte do bloco; ancestral ampliado quando preciso),
// então funciona com o cache do service worker e sem internet nas áreas já vistas ou baixadas.
(function (root) {
  'use strict';
  const T = 256, MAXLAT = 85.0511287798;
  const wx = (lng, z) => (lng + 180) / 360 * T * 2 ** z;
  const wy = (lat, z) => {
    const s = Math.sin(Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * T * 2 ** z;
  };

  async function pool(tasks, n) {
    let i = 0;
    await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) await tasks[i++](); }));
  }
  function hexRgb(h, a) {
    const v = parseInt((h || '#ffeb3b').slice(1), 16);
    return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`;
  }

  // o: { items, W, H, pad, layers: [fn], maxZoom, minZoom, names, sizes, vertices, labelOf(m) → [nome, medida],
  //      r (escala de traço e fonte), attribution, bg }
  async function render(o) {
    const r = o.r || 1, W = o.W, H = o.H, pad = (o.pad ?? 40) * r;
    const pts = o.items.flatMap(m => m.points);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = o.bg || '#d9d9d9';
    ctx.fillRect(0, 0, W, H);
    // zoom fracionário que enquadra tudo; um ponto só fica no zoom 17
    const x0 = Math.min(...pts.map(p => wx(p[1], 0))), x1 = Math.max(...pts.map(p => wx(p[1], 0)));
    const y0 = Math.min(...pts.map(p => wy(p[0], 0))), y1 = Math.max(...pts.map(p => wy(p[0], 0)));
    let zf = Math.min(Math.log2((W - 2 * pad) / Math.max(x1 - x0, 1e-9)), Math.log2((H - 2 * pad) / Math.max(y1 - y0, 1e-9)));
    zf = Math.max(o.minZoom ?? 2, Math.min(zf, o.maxZoom ?? 19));
    const zt = Math.max(0, Math.min(Math.ceil(zf - 0.25), o.tileZoom ?? 19)); // bloco no máximo 25% ampliado
    const k = 2 ** (zf - zt), cx = (x0 + x1) / 2 * 2 ** zt, cy = (y0 + y1) / 2 * 2 ** zt;
    const n = 2 ** zt, ts = T * k;
    const tx0 = Math.floor((cx - W / 2 / k) / T), tx1 = Math.floor((cx + W / 2 / k) / T);
    const ty0 = Math.max(0, Math.floor((cy - H / 2 / k) / T)), ty1 = Math.min(n - 1, Math.floor((cy + H / 2 / k) / T));
    let failed = 0, total = 0;
    for (const layer of o.layers) {
      const jobs = [];
      for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
        const x = ((tx % n) + n) % n;
        const dx = (tx * T - cx) * k + W / 2, dy = (ty * T - cy) * k + H / 2;
        total++;
        jobs.push(async () => {
          try {
            const t = await layer(zt, x, ty);
            if (t) ctx.drawImage(t.img, t.sx, t.sy, t.sw, t.sw, Math.floor(dx), Math.floor(dy), Math.ceil(ts) + 1, Math.ceil(ts) + 1);
          } catch (e) { failed++; }
        });
      }
      await pool(jobs, 8); // camada por camada: os nomes ficam por cima da imagem
    }
    const px = p => [(wx(p[1], zt) - cx) * k + W / 2, (wy(p[0], zt) - cy) * k + H / 2];

    // medições
    ctx.lineJoin = ctx.lineCap = 'round';
    o.items.forEach(m => {
      const q = m.points.map(px);
      if (m.type === 'poi') return;
      ctx.beginPath();
      q.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      if (m.type === 'area') { ctx.closePath(); ctx.fillStyle = hexRgb(m.color, 0.22); ctx.fill(); }
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 5 * r; ctx.stroke();
      ctx.strokeStyle = m.color || '#ffeb3b'; ctx.lineWidth = 2.6 * r; ctx.stroke();
      if (o.vertices) q.forEach(p => {
        ctx.beginPath(); ctx.arc(p[0], p[1], 3.2 * r, 0, 7);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.2 * r; ctx.strokeStyle = '#000'; ctx.stroke();
      });
    });
    o.items.filter(m => m.type === 'poi').forEach(m => {
      const [x, y] = px(m.points[0]);
      ctx.beginPath(); ctx.arc(x, y, 7 * r, 0, 7);
      ctx.fillStyle = m.color || '#e53935'; ctx.fill(); ctx.lineWidth = 2.4 * r; ctx.strokeStyle = '#fff'; ctx.stroke();
    });
    // rótulos: centro do polígono, meio da linha, acima do ponto
    const font = (b, s) => `${b ? 'bold ' : ''}${s * r}px Roboto, "Segoe UI", Arial, sans-serif`;
    const label = (s, x, y, b, size) => {
      ctx.font = font(b, size); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5 * r; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(s, x, y);
      ctx.fillStyle = '#fff'; ctx.fillText(s, x, y);
    };
    if (o.names || o.sizes) o.items.forEach(m => {
      const q = m.points.map(px);
      let at;
      if (m.type === 'poi') at = [q[0][0], q[0][1] - 20 * r];
      else if (m.type === 'distance') { const i = Math.floor((q.length - 1) / 2); at = [(q[i][0] + q[i + 1][0]) / 2, (q[i][1] + q[i + 1][1]) / 2 - 12 * r]; }
      else at = centroid(q);
      const [name, size] = o.labelOf(m);
      const lines = [o.names && name, o.sizes && size].filter(Boolean);
      lines.forEach((s, i) => label(s, at[0], at[1] + (i - (lines.length - 1) / 2) * 17 * r, i === 0 && o.names, i === 0 && o.names ? 14 : 12.5));
    });

    // escala, norte e atribuição
    const latC = (y0 + y1) / 2;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * latC / T))) * 180 / Math.PI;
    const mpp = 40075016.686 * Math.cos(lat * Math.PI / 180) / (T * 2 ** zf);
    const target = mpp * W / 5, pow = 10 ** Math.floor(Math.log10(target));
    const len = [1, 2, 5, 10].map(f => f * pow).filter(v => v <= target).pop() || pow;
    const bw = len / mpp, bx = 14 * r, by = H - 16 * r;
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(bx - 6 * r, by - 24 * r, bw + 12 * r, 32 * r);
    ctx.fillStyle = '#000'; ctx.fillRect(bx, by - 4 * r, bw, 4 * r);
    ctx.fillRect(bx, by - 9 * r, 1.5 * r, 9 * r); ctx.fillRect(bx + bw - 1.5 * r, by - 9 * r, 1.5 * r, 9 * r);
    ctx.font = font(true, 11); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, bx + bw / 2, by - 10 * r);
    const ax = W - 26 * r, ay = 18 * r;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + 10 * r, ay + 26 * r); ctx.lineTo(ax, ay + 20 * r); ctx.lineTo(ax - 10 * r, ay + 26 * r); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.5 * r; ctx.strokeStyle = '#000'; ctx.stroke();
    label('N', ax, ay + 38 * r, true, 12);
    if (o.attribution) {
      ctx.font = font(false, 9.5); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      const w = ctx.measureText(o.attribution).width;
      ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(W - w - 10 * r, H - 15 * r, w + 10 * r, 15 * r);
      ctx.fillStyle = '#333'; ctx.fillText(o.attribution, W - 5 * r, H - 2 * r);
    }
    return { canvas: c, failed, total, zoom: zf };
  }
  // centroide de área do polígono em pixels (cai na média dos vértices se for degenerado)
  function centroid(q) {
    let a = 0, x = 0, y = 0;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      const f = q[j][0] * q[i][1] - q[i][0] * q[j][1];
      a += f; x += (q[j][0] + q[i][0]) * f; y += (q[j][1] + q[i][1]) * f;
    }
    if (Math.abs(a) < 1e-6) return q.reduce((s, p) => [s[0] + p[0] / q.length, s[1] + p[1] / q.length], [0, 0]);
    return [x / (3 * a), y / (3 * a)];
  }
  root.MapImg = { render };
})(this);
