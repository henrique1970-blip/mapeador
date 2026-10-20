// Link de compartilhamento sem servidor: as medições vão comprimidas no próprio endereço, depois do "#".
// O trecho depois do "#" não é enviado a servidor nenhum ao abrir o link; só o navegador de quem abre lê.
// Formato: #c=<base64url(deflate-raw(JSON))>, com as coordenadas no algoritmo de polilinha (precisão 1e-7 grau ≈ 1 cm).
(function (root) {
  'use strict';
  const P = 1e7;
  function encPath(pts) {
    let out = '', pl = 0, pg = 0;
    // aritmética comum em vez de operadores de bits: com 1e7, 180° passa do limite de 32 bits
    const one = v => {
      v = v < 0 ? -v * 2 - 1 : v * 2;
      let s = '';
      while (v >= 32) { s += String.fromCharCode(32 + (v % 32) + 63); v = Math.floor(v / 32); }
      return s + String.fromCharCode(v + 63);
    };
    pts.forEach(p => {
      const la = Math.round(p[0] * P), lg = Math.round(p[1] * P);
      out += one(la - pl) + one(lg - pg);
      pl = la; pg = lg;
    });
    return out;
  }
  function decPath(s) {
    const out = [];
    let i = 0, la = 0, lg = 0;
    const one = () => {
      let r = 0, f = 1, b;
      do { b = s.charCodeAt(i++) - 63; r += (b & 0x1f) * f; f *= 32; } while (b >= 0x20);
      return r % 2 ? -(r + 1) / 2 : r / 2;
    };
    while (i < s.length) { la += one(); lg += one(); out.push([la / P, lg / P]); }
    return out;
  }
  const T = { area: 'a', distance: 'd', poi: 'p' }, TI = { a: 'area', d: 'distance', p: 'poi' };
  const b64u = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const pipe = async (u8, st) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(st)).arrayBuffer());

  async function encode(items) {
    const j = { v: 1, i: items.map(m => {
      const o = { n: m.name, t: T[m.type], p: encPath(m.points) };
      if (m.group) o.g = m.group;
      if (m.color) o.c = m.color;
      if (m.notes) o.o = m.notes;
      const hs = m.type === 'area' && Array.isArray(m.holes) ? m.holes.filter(h => h.length >= 3) : [];
      if (hs.length) o.h = hs.map(encPath);
      return o;
    }) };
    return b64u(await pipe(new TextEncoder().encode(JSON.stringify(j)), new CompressionStream('deflate-raw')));
  }
  async function decode(code) {
    const j = JSON.parse(new TextDecoder().decode(await pipe(unb64u(code), new DecompressionStream('deflate-raw'))));
    if (!j || j.v !== 1 || !Array.isArray(j.i)) throw new Error('link de versão desconhecida');
    return j.i.filter(o => TI[o.t]).map(o => {
      const m = { type: TI[o.t], name: String(o.n || 'Compartilhada'), group: String(o.g || ''), color: o.c, notes: String(o.o || ''), points: decPath(String(o.p || '')) };
      if (m.type === 'area') m.holes = (o.h || []).map(h => decPath(String(h))).filter(h => h.length >= 3);
      return m;
    }).filter(m => m.points.length && m.points.every(p => Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180));
  }
  root.ShareLink = { encode, decode, encPath, decPath };
})(this);
