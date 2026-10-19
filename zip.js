// ZIP mínimo para KMZ e Shapefile: lê (armazenado ou deflate) e grava, sem biblioteca.
// A descompressão usa o DecompressionStream do navegador (Chrome 80+, Safari 16.4+).
(function (root) {
  'use strict';
  const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function pipe(u8, stream) {
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());
  }

  // ArrayBuffer → { 'caminho/nome': Uint8Array }
  async function read(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('arquivo ZIP inválido');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP corrompido');
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const nameBytes = u8.subarray(p + 46, p + 46 + nlen);
      const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'windows-1252').decode(nameBytes);
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const data = u8.subarray(start, start + csize);
      if (method === 0) out[name] = data;
      else if (method === 8) out[name] = await pipe(data, new DecompressionStream('deflate-raw'));
      // outros métodos (bzip2, lzma) ficam de fora
    }
    return out;
  }

  // [{ name, data: string|Uint8Array }] → Blob
  async function write(files, type) {
    const enc = new TextEncoder(), parts = [], central = [];
    const canDeflate = typeof CompressionStream !== 'undefined';
    let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const name = enc.encode(f.name);
      const crc = crc32(raw);
      let body = raw, method = 0;
      if (canDeflate && raw.length > 64) {
        const z = await pipe(raw, new CompressionStream('deflate-raw'));
        if (z.length < raw.length) { body = z; method = 8; }
      }
      const head = (sig, extra) => {
        const h = new DataView(new ArrayBuffer(extra ? 46 : 30));
        let i = 0;
        h.setUint32(i, sig, true); i += 4;
        if (extra) { h.setUint16(i, 20, true); i += 2; }
        h.setUint16(i, 20, true); h.setUint16(i + 2, 0x800, true); h.setUint16(i + 4, method, true);
        h.setUint16(i + 6, time, true); h.setUint16(i + 8, date, true); h.setUint32(i + 10, crc, true);
        h.setUint32(i + 14, body.length, true); h.setUint32(i + 18, raw.length, true); h.setUint16(i + 22, name.length, true);
        if (extra) h.setUint32(42, offset, true);
        return new Uint8Array(h.buffer);
      };
      const local = head(0x04034b50, false);
      parts.push(local, name, body);
      central.push(head(0x02014b50, true), name);
      offset += local.length + name.length + body.length;
    }
    const cdSize = central.reduce((s, a) => s + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: type || 'application/zip' });
  }

  root.Zip = { read, write, crc32 };
})(this);
