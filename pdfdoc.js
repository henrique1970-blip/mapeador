// Gerador de PDF mínimo, sem biblioteca: páginas A4, texto em Helvetica (WinAnsi, cobre o português),
// linhas, retângulos e imagens JPEG. Unidades em pontos (1/72"), origem no canto de CIMA (convertido na escrita).
(function (root) {
  'use strict';
  // larguras AFM (1/1000 em) dos códigos WinAnsi 32–255
  const W = {
    F1: '278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500',
    F2: '278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556'
  };
  const WIDTHS = { F1: W.F1.split(',').map(Number), F2: W.F2.split(',').map(Number) };
  // Unicode → WinAnsi nas posições 0x80–0x9F; o resto até 0xFF é igual ao Latin-1
  const CP = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
    0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94,
    0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E,
    0x0178: 0x9F, 0x2032: 0x27, 0x2033: 0x22, 0x2212: 0x2D, 0x00A0: 0x20, 0x2192: 0xBB };
  function codes(s) {
    const out = [];
    for (const ch of String(s ?? '')) {
      const u = ch.codePointAt(0);
      out.push(u >= 32 && u < 127 ? u : CP[u] != null ? CP[u] : u >= 0xA0 && u <= 0xFF ? u : 0x3F);
    }
    return out;
  }
  const A4 = [595.28, 841.89];

  function Doc() {
    const pages = [], images = [];
    let cur = null, font = 'F1', size = 10;
    const num = v => (Math.round(v * 100) / 100).toString();
    const api = {
      W: A4[0], H: A4[1],
      addPage() { cur = []; pages.push(cur); return api; },
      font(f, s) { font = f === 'bold' ? 'F2' : 'F1'; if (s) size = s; return api; },
      color(rgb) { cur.push(`${rgb.map(v => num(v / 255)).join(' ')} rg ${rgb.map(v => num(v / 255)).join(' ')} RG`); return api; },
      width(s, f, sz) { const w = WIDTHS[f === 'bold' ? 'F2' : f === 'normal' ? 'F1' : font]; return codes(s).reduce((t, c) => t + w[c - 32], 0) * (sz || size) / 1000; },
      // texto com a linha de base em y (medido de cima); align 'left' | 'right' | 'center'
      text(s, x, y, align) {
        const w = align ? api.width(s) : 0;
        const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
        const esc = codes(s).map(c => c === 0x28 || c === 0x29 || c === 0x5C ? '\\' + String.fromCharCode(c) : c < 128 ? String.fromCharCode(c) : '\\' + c.toString(8)).join('');
        cur.push(`BT /${font} ${num(size)} Tf ${num(x0)} ${num(A4[1] - y)} Td (${esc}) Tj ET`);
        return api;
      },
      // quebra em linhas que cabem em maxW (por palavra; palavra longa demais é cortada)
      wrap(s, maxW) {
        const lines = [];
        String(s ?? '').split(/\n/).forEach(par => {
          let line = '';
          par.split(/\s+/).filter(Boolean).forEach(w => {
            const t = line ? line + ' ' + w : w;
            if (api.width(t) <= maxW) { line = t; return; }
            if (line) lines.push(line);
            line = w;
            while (api.width(line) > maxW && line.length > 1) {
              let k = line.length - 1;
              while (k > 1 && api.width(line.slice(0, k)) > maxW) k--;
              lines.push(line.slice(0, k)); line = line.slice(k);
            }
          });
          lines.push(line);
        });
        return lines;
      },
      line(x1, y1, x2, y2, lw) { cur.push(`${num(lw || 0.5)} w ${num(x1)} ${num(A4[1] - y1)} m ${num(x2)} ${num(A4[1] - y2)} l S`); return api; },
      rect(x, y, w, h, fill) { cur.push(`${num(x)} ${num(A4[1] - y - h)} ${num(w)} ${num(h)} re ${fill ? 'f' : 'S'}`); return api; },
      // jpeg: Uint8Array com o arquivo JPEG; pw×ph: tamanho em pixels
      image(jpeg, pw, ph, x, y, w, h) {
        images.push({ jpeg, pw, ph }); (cur.img = cur.img || []).push(images.length);
        cur.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(A4[1] - y - h)} cm /Im${images.length} Do Q`);
        return api;
      },
      pageCount: () => pages.length,
      // escreve em cada página (rodapé "N / total", por exemplo) antes de fechar
      eachPage(fn) { const keep = cur; pages.forEach((p, i) => { cur = p; fn(i, pages.length); }); cur = keep; return api; },
      build(meta) {
        const enc = new TextEncoder(), chunks = [], offs = [];
        let len = 0;
        const push = b => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); len += u.length; };
        const objs = []; // [conteúdo string | {dict, stream}]
        const ref = n => `${n} 0 R`;
        // 1 catálogo, 2 árvore de páginas, 3–4 fontes, depois imagens, depois páginas+conteúdos
        const nImg0 = 5, nPage0 = nImg0 + images.length;
        objs.push(`<< /Type /Catalog /Pages ${ref(2)} >>`);
        objs.push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => ref(nPage0 + i * 2)).join(' ')}] >>`);
        objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        images.forEach(im => objs.push({ dict: `/Type /XObject /Subtype /Image /Width ${im.pw} /Height ${im.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, stream: im.jpeg }));
        const xo = p => (p.img || []).map(n => `/Im${n} ${ref(nImg0 + n - 1)}`).join(' ');
        pages.forEach((p, i) => {
          objs.push(`<< /Type /Page /Parent ${ref(2)} /MediaBox [0 0 ${A4[0]} ${A4[1]}] /Resources << /Font << /F1 ${ref(3)} /F2 ${ref(4)} >>` +
            (p.img ? ` /XObject << ${xo(p)} >>` : '') + ` >> /Contents ${ref(nPage0 + i * 2 + 1)} >>`);
          objs.push({ dict: '', stream: enc.encode(p.join('\n')) });
        });
        const info = meta ? `<< /Producer (Mapeador de Areas) /Title (${codes(meta.title || '').filter(c => c < 128 && c !== 0x28 && c !== 0x29 && c !== 0x5C).map(c => String.fromCharCode(c)).join('')}) >>` : null;
        if (info) objs.push(info);
        push('%PDF-1.4\n%');
        push(new Uint8Array([0xE2, 0xE3, 0xCF, 0xD3, 0x0A])); // marca de arquivo binário
        objs.forEach((o, i) => {
          offs.push(len);
          if (typeof o === 'string') push(`${i + 1} 0 obj\n${o}\nendobj\n`);
          else { push(`${i + 1} 0 obj\n<< ${o.dict} /Length ${o.stream.length} >>\nstream\n`); push(o.stream); push('\nendstream\nendobj\n'); }
        });
        const xref = len;
        push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
        push(`trailer\n<< /Size ${objs.length + 1} /Root ${ref(1)}${info ? ' /Info ' + ref(objs.length) : ''} >>\nstartxref\n${xref}\n%%EOF\n`);
        return new Blob(chunks, { type: 'application/pdf' });
      }
    };
    return api;
  }
  root.PDFDoc = { create: Doc, A4 };
})(this);
