// GPS externo (receptor GNSS) lendo NMEA 0183.
// Conexões: Bluetooth LE (Web Bluetooth; serviço UART da Nordic ou o FFE0 dos módulos HM-10) e porta serial
// (Web Serial: USB e Bluetooth clássico SPP onde o Chrome oferece). Só no Chrome/Edge; o iPhone não tem nenhuma das duas.
// Cada GGA vira uma posição { lat, lng, acc, quality, sats, hdop, alt, t } entregue a onFix.
// Precisão: σ do GST quando o receptor manda; sem GST, estimativa a partir do HDOP e do tipo de correção.
(function (root) {
  'use strict';
  const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e', NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  const HM10 = 0xffe0, HM10_CH = 0xffe1;
  const SPP = '00001101-0000-1000-8000-00805f9b34fb';
  const QUALITY = { 0: 'sem posição', 1: 'GPS', 2: 'DGPS', 3: 'PPS', 4: 'RTK fixo', 5: 'RTK flutuante', 6: 'estimada', 7: 'manual', 8: 'simulação' };

  // "ddmm.mmmm" + hemisfério → graus decimais
  function dm(v, h) {
    if (!v) return NaN;
    const x = parseFloat(v), d = Math.floor(x / 100), r = d + (x - d * 100) / 60;
    return /[SW]/i.test(h) ? -r : r;
  }
  function checksumOk(line) {
    const star = line.lastIndexOf('*');
    if (star < 0) return true; // sem checksum: aceita
    let c = 0;
    for (let i = 1; i < star; i++) c ^= line.charCodeAt(i);
    return c === parseInt(line.slice(star + 1, star + 3), 16);
  }

  const state = { gst: null, gstT: 0, rmc: null };
  // devolve a posição quando a linha é um GGA válido; GST e RMC só atualizam o estado
  function parseLine(raw) {
    const line = raw.trim();
    if (!/^\$[A-Z]{2}[A-Z]{3},/.test(line) || !checksumOk(line)) return null;
    const f = line.replace(/\*[0-9A-Fa-f]{2}$/, '').split(',');
    const type = f[0].slice(3);
    if (type === 'GST') {
      const sLat = parseFloat(f[6]), sLon = parseFloat(f[7]);
      if (isFinite(sLat) && isFinite(sLon)) { state.gst = Math.hypot(sLat, sLon); state.gstT = Date.now(); }
      return null;
    }
    if (type === 'RMC') { state.rmc = { ok: f[2] === 'A', speed: parseFloat(f[7]) * 0.514444, course: parseFloat(f[8]) }; return null; }
    if (type !== 'GGA') return null;
    const quality = parseInt(f[6], 10) || 0;
    const lat = dm(f[2], f[3]), lng = dm(f[4], f[5]);
    if (!quality || !isFinite(lat) || !isFinite(lng)) return { noFix: true, quality, sats: parseInt(f[7], 10) || 0 };
    const hdop = parseFloat(f[8]), sats = parseInt(f[7], 10) || 0, alt = parseFloat(f[9]);
    let acc, est = false;
    if (state.gst != null && Date.now() - state.gstT < 3000) acc = state.gst;
    else {
      est = true;
      const h = isFinite(hdop) ? hdop : 2;
      acc = quality === 4 ? 0.05 : quality === 5 ? 0.5 : quality === 2 ? h * 1.5 : h * 4;
    }
    return { lat, lng, acc, est, quality, qualityText: QUALITY[quality] || String(quality), sats, hdop, alt, t: Date.now() };
  }

  let buf = '', onFix = () => {}, onStatus = () => {}, conn = null;
  function feed(text) {
    buf += text;
    let k;
    while ((k = buf.search(/\r?\n/)) >= 0) {
      const line = buf.slice(0, k);
      buf = buf.slice(k + (buf[k] === '\r' ? 2 : 1));
      const fx = parseLine(line);
      if (fx && !fx.noFix) onFix(fx);
      else if (fx && fx.noFix) onStatus({ state: 'nofix', sats: fx.sats });
    }
    if (buf.length > 4096) buf = buf.slice(-512); // lixo sem quebra de linha
  }
  const dec = new TextDecoder();

  async function connectBLE() {
    const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [NUS, HM10] });
    onStatus({ state: 'connecting', name: dev.name });
    const gatt = await dev.gatt.connect();
    let ch;
    try { ch = await (await gatt.getPrimaryService(NUS)).getCharacteristic(NUS_TX); }
    catch (e) { ch = await (await gatt.getPrimaryService(HM10)).getCharacteristic(HM10_CH); }
    ch.addEventListener('characteristicvaluechanged', e => feed(dec.decode(e.target.value, { stream: true })));
    await ch.startNotifications();
    dev.addEventListener('gattserverdisconnected', () => { if (conn && conn.dev === dev) { conn = null; onStatus({ state: 'off', lost: true }); } });
    conn = { kind: 'ble', name: dev.name || 'receptor Bluetooth', dev, close: () => { try { dev.gatt.disconnect(); } catch (e) { /* já caiu */ } } };
    onStatus({ state: 'on', name: conn.name, kind: 'ble' });
  }
  async function connectSerial(baud) {
    // Bluetooth clássico (SPP) aparece na lista junto com as portas USB, onde o Chrome oferece
    let port;
    try { port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP] }); }
    catch (e) { if (e.name === 'NotFoundError') throw e; port = await navigator.serial.requestPort(); }
    await port.open({ baudRate: baud || 9600 });
    const reader = port.readable.getReader();
    let stop = false;
    conn = { kind: 'serial', name: 'porta serial', port, close: async () => { stop = true; try { await reader.cancel(); await port.close(); } catch (e) { /* já fechada */ } } };
    onStatus({ state: 'on', name: conn.name, kind: 'serial' });
    (async () => {
      try {
        while (!stop) {
          const { value, done } = await reader.read();
          if (done) break;
          feed(dec.decode(value, { stream: true }));
        }
      } catch (e) { /* cabo solto, aparelho desligado */ }
      if (conn && conn.port === port) { conn = null; onStatus({ state: 'off', lost: !stop }); }
    })();
  }
  async function disconnect() {
    const c = conn;
    conn = null;
    if (c) await c.close();
    onStatus({ state: 'off' });
  }
  root.ExtGPS = {
    hasBLE: () => !!(navigator.bluetooth && navigator.bluetooth.requestDevice),
    hasSerial: () => !!(navigator.serial && navigator.serial.requestPort),
    connectBLE, connectSerial, disconnect, feed, parseLine,
    connected: () => !!conn, name: () => conn && conn.name,
    on: (fix, status) => { onFix = fix; onStatus = status; },
    // teste: liga uma "conexão" falsa que só recebe o que for passado em feed()
    simulate: () => { conn = { kind: 'sim', name: 'simulador', close: () => {} }; onStatus({ state: 'on', name: 'simulador', kind: 'sim' }); },
    _reset: () => { state.gst = null; state.gstT = 0; buf = ''; }
  };
})(this);
