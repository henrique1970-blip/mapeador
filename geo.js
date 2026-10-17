// Cálculos geodésicos no elipsoide WGS84 — sem dependências.
// Área: projeção na esfera autálica (preserva área do elipsoide) + excesso esférico.
// Distância: Vincenty (inversa), com recuo para haversine se não convergir.
(function (root) {
  'use strict';
  const A = 6378137;
  const F = 1 / 298.257223563;
  const B = A * (1 - F);
  const E2 = F * (2 - F);
  const E = Math.sqrt(E2);
  const RAD = Math.PI / 180;

  function q(phi) {
    const s = Math.sin(phi);
    return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
  }
  const QP = q(Math.PI / 2);
  const RQ = A * Math.sqrt(QP / 2); // raio autálico ≈ 6 371 007,2 m

  function authalicLat(phi) {
    return Math.asin(Math.max(-1, Math.min(1, q(phi) / QP)));
  }

  // pts: [[lat, lng], ...] — anel aberto ou fechado. Retorna m².
  function area(pts) {
    const ring = openRing(pts);
    const n = ring.length;
    if (n < 3) return 0;
    let total = 0;
    let prev = ring[n - 1];
    let prevTan = Math.tan((Math.PI / 2 - authalicLat(prev[0] * RAD)) / 2);
    let prevLng = prev[1] * RAD;
    for (let i = 0; i < n; i++) {
      const tan = Math.tan((Math.PI / 2 - authalicLat(ring[i][0] * RAD)) / 2);
      const lng = ring[i][1] * RAD;
      const dl = lng - prevLng;
      const t = tan * prevTan; // triângulo polar entre a aresta e o polo
      total += 2 * Math.atan2(t * Math.sin(dl), 1 + t * Math.cos(dl));
      prevTan = tan;
      prevLng = lng;
    }
    return Math.abs(total * RQ * RQ);
  }

  function openRing(pts) {
    if (pts.length > 1) {
      const a = pts[0], b = pts[pts.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) return pts.slice(0, -1);
    }
    return pts;
  }

  // Distância geodésica entre dois pontos [lat, lng], em metros.
  function distance(p1, p2) {
    const L = (p2[1] - p1[1]) * RAD;
    const U1 = Math.atan((1 - F) * Math.tan(p1[0] * RAD));
    const U2 = Math.atan((1 - F) * Math.tan(p2[0] * RAD));
    const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
    const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
    let lambda = L, lambdaP, iter = 0;
    let sinSigma, cosSigma, sigma, cosSqAlpha, cos2SigmaM;
    do {
      const sinLambda = Math.sin(lambda), cosLambda = Math.cos(lambda);
      sinSigma = Math.sqrt((cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2);
      if (sinSigma === 0) return 0;
      cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
      sigma = Math.atan2(sinSigma, cosSigma);
      const sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
      cosSqAlpha = 1 - sinAlpha * sinAlpha;
      cos2SigmaM = cosSqAlpha !== 0 ? cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha : 0;
      const C = F / 16 * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
      lambdaP = lambda;
      lambda = L + (1 - C) * F * sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    } while (Math.abs(lambda - lambdaP) > 1e-12 && ++iter < 200);
    if (iter >= 200) return haversine(p1, p2); // pontos quase antípodas
    const uSq = cosSqAlpha * (A * A - B * B) / (B * B);
    const AA = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const BB = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const deltaSigma = BB * sinSigma * (cos2SigmaM + BB / 4 * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
      BB / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    return B * AA * (sigma - deltaSigma);
  }

  function haversine(p1, p2) {
    const dLat = (p2[0] - p1[0]) * RAD, dLng = (p2[1] - p1[1]) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1[0] * RAD) * Math.cos(p2[0] * RAD) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
  }

  function length(pts, closed) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += distance(pts[i - 1], pts[i]);
    if (closed && pts.length > 2) d += distance(pts[pts.length - 1], pts[0]);
    return d;
  }

  // Lat/lng WGS84 → UTM (série de Krüger, precisão sub-milimétrica dentro da zona).
  function toUTM(lat, lng) {
    const zone = Math.floor((lng + 180) / 6) + 1;
    const lng0 = ((zone - 1) * 6 - 180 + 3) * RAD;
    const k0 = 0.9996;
    const n = F / (2 - F);
    const AA = A / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
    const alpha = [
      n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16,
      13 * n * n / 48 - 3 * n ** 3 / 5,
      61 * n ** 3 / 240
    ];
    const phi = lat * RAD, dl = lng * RAD - lng0;
    const t = Math.sinh(Math.atanh(Math.sin(phi)) - (2 * Math.sqrt(n) / (1 + n)) *
      Math.atanh((2 * Math.sqrt(n) / (1 + n)) * Math.sin(phi)));
    const xi = Math.atan2(t, Math.cos(dl));
    const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
    let x = eta, y = xi;
    for (let j = 1; j <= 3; j++) {
      x += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
      y += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    }
    const easting = 500000 + k0 * AA * x;
    let northing = k0 * AA * y;
    if (lat < 0) northing += 10000000;
    const bands = 'CDEFGHJKLMNPQRSTUVWX';
    const band = bands[Math.max(0, Math.min(19, Math.floor((lat + 80) / 8)))];
    return { zone, band, hemisphere: lat < 0 ? 'S' : 'N', easting, northing };
  }

  const api = { area, distance, length, toUTM, authalicRadius: RQ };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Geo = api;
})(this);
