// Sistemas de coordenadas usados no Brasil, sobre o proj4js.
// Pontos do app são [lat, lng] em WGS84 (na prática igual ao SIRGAS 2000, diferença de centímetros).
// Parâmetros de transformação para o SIRGAS 2000: IBGE, R.PR 1/2005.
(function (root) {
  'use strict';
  const DATUMS = {
    sirgas: { label: 'SIRGAS 2000', ellps: 'GRS80', towgs84: '0,0,0,0,0,0,0' },
    sad69: { label: 'SAD69', ellps: 'aust_SA', towgs84: '-67.35,3.88,-38.22,0,0,0,0' },
    ca: { label: 'Córrego Alegre', ellps: 'intl', towgs84: '-205.57,168.77,-4.12,0,0,0,0' }
  };
  // datum de .prj sem TOWGS84: o proj4 ignoraria a mudança de datum (erro de ~60 m no SAD69)
  const WKT_DATUMS = [
    [/south_american_1969|sad[_ ]?69/i, DATUMS.sad69.towgs84],
    [/corrego_alegre|córrego_alegre/i, DATUMS.ca.towgs84]
  ];

  const zoneOf = lng => Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1));
  function utmDef(datum, zone, south) {
    const d = DATUMS[datum] || DATUMS.sirgas;
    return `+proj=utm +zone=${zone}${south ? ' +south' : ''} +ellps=${d.ellps} +towgs84=${d.towgs84} +units=m +no_defs`;
  }
  // conversor [lat,lng] WGS84 → [E, N] no UTM do datum
  function utm(datum, zone, south) {
    const c = proj4('WGS84', utmDef(datum, zone, south));
    return { fwd: p => c.forward([p[1], p[0]]), inv: xy => { const g = c.inverse(xy); return [g[1], g[0]]; } };
  }
  function toUTM(p, datum) {
    const zone = zoneOf(p[1]), south = p[0] < 0;
    const [e, n] = utm(datum, zone, south).fwd(p);
    return { zone, hemisphere: south ? 'S' : 'N', easting: e, northing: n };
  }
  function fromUTM(zone, south, e, n, datum) { return utm(datum, zone, south).inv([e, n]); }

  // WKT do ESRI (.prj) para o sistema escolhido na exportação
  const SPHEROIDS = {
    sirgas: 'SPHEROID["GRS_1980",6378137.0,298.257222101]',
    sad69: 'SPHEROID["GRS_1967_Truncated",6378160.0,298.25]',
    ca: 'SPHEROID["International_1924",6378388.0,297.0]'
  };
  const GCS = { sirgas: ['GCS_SIRGAS_2000', 'D_SIRGAS_2000'], sad69: ['GCS_South_American_1969', 'D_South_American_1969'],
    ca: ['GCS_Corrego_Alegre', 'D_Corrego_Alegre'] };
  function geogWKT(datum) {
    if (!datum) return 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
    const [g, d] = GCS[datum];
    return `GEOGCS["${g}",DATUM["${d}",${SPHEROIDS[datum]}],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`;
  }
  function utmWKT(datum, zone, south) {
    const name = { sirgas: 'SIRGAS_2000', sad69: 'SAD_1969', ca: 'Corrego_Alegre' }[datum];
    return `PROJCS["${name}_UTM_Zone_${zone}${south ? 'S' : 'N'}",${geogWKT(datum)},PROJECTION["Transverse_Mercator"],` +
      `PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",${south ? 10000000 : 0}.0],` +
      `PARAMETER["Central_Meridian",${zone * 6 - 183}.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;
  }

  // .prj → função [x, y] do arquivo → [lat, lng] WGS84. Sem .prj: só aceita graus.
  function fromPrj(wkt) {
    if (!wkt || !wkt.trim()) return null;
    let w = wkt.trim();
    if (!/TOWGS84/i.test(w)) {
      const hit = WKT_DATUMS.find(([re]) => re.test(w));
      if (hit) w = w.replace(/(SPHEROID\[[^\]]*\])/i, `$1,TOWGS84[${hit[1]}]`);
    }
    const c = proj4(w, 'WGS84');
    return xy => { const g = c.forward([xy[0], xy[1]]); return [g[1], g[0]]; };
  }

  root.Proj = { DATUMS, zoneOf, utm, toUTM, fromUTM, fromPrj, geogWKT, utmWKT };
})(this);
