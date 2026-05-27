// projection.js — projection kernels, ported faithfully from the validated
// Python pipeline in research/maps-projections/scripts/. All numeric parameters
// come from window.PROJECTION_CONFIG (generated from projections.yaml), so there
// are no hard-coded projection constants here — change the YAML, not this file.
//
// Exposes window.PROJ. Works in the browser and in Node (for the numeric
// self-test against Python): it attaches to `self`/`globalThis` and reads
// PROJECTION_CONFIG from the same root.
//
// Conventions (matching the Python):
//   - pBase (Hǎo polyconic) natively returns [north, east]; winkel returns
//     [east, north]. baseProject() NORMALISES both to [east, north].
//   - Vertical (N/S) framings: oblique rotation then PORTRAIT screen
//     (screenX = -north, screenY = east).  Horizontal (E/W): central-meridian
//     shift then LANDSCAPE screen (screenX = east, screenY = north).

(function (root) {
  'use strict';
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var EARTH_RADIUS_KM = 6378.137;   // Web-Mercator sphere (WGS84 semi-major axis); the radius EPSG:3857 / Leaflet assume
  function clamp1(x) { return x < -1 ? -1 : (x > 1 ? 1 : x); }

  function cfg() { return root.PROJECTION_CONFIG; }
  function projById(id) { return cfg().projections.filter(function (p) { return p.id === id; })[0]; }
  function coordById(id) { return cfg().coordinates.filter(function (c) { return c.id === id; })[0]; }

  // ---- base projections -----------------------------------------------------
  // Eq (1)-(6) constants for Hǎo's equal-difference polyconic (the `polyconic` kind). Fixed
  // published formula, not exposed in projections.yaml. Keep in sync with base_projection.py.
  var POLYCONIC = { b: 1.1, c: 0.02893726, x0: { lin: 1.1068, cub: 0.000005, den: 3.3 },
                    xn: [0.505942, -2.447552e-05, 1.164925e-09], yn: { R: 49.5, k: 1.625, offset: 0.5 } };
  // Hǎo equal-difference polyconic, Eq (1)-(6). Returns [north, east].
  function pBase(phiDeg, lamDeg, co) {
    var phi = phiDeg, lam = lamDeg;
    var x0 = (co.x0.lin / co.x0.den) * phi + (co.x0.cub / co.x0.den) * phi * phi * phi;   // Eq (1)
    var xn = co.xn[0] * phi + co.xn[1] * phi * phi * phi + co.xn[2] * Math.pow(phi, 5);   // Eq (2)
    var yn = Math.sqrt(Math.max(co.yn.R * co.yn.R - co.yn.k * xn * xn, 0)) + co.yn.offset; // Eq (3)
    var f = co.b * (1 - co.c * Math.abs(lam) * D2R) * (lam / 180);                        // longitude factor (|λ| ⇒ symmetric about central meridian)
    var dxn = xn - x0;
    if (Math.abs(dxn) < 1e-9) return [x0, yn * f];           // φ=0: ρ→∞, straight (Eq 6)
    var rho = (yn * yn + dxn * dxn) / (2 * dxn);             // Eq (4) ρ
    var delta = Math.asin(clamp1(yn / rho)) * f;            // Eq (4) δπ * f
    return [x0 + rho * (1 - Math.cos(delta)), rho * Math.sin(delta)];   // Eq (5)/(6) -> [north, east]
  }

  // Winkel Tripel: mean of Aitoff and the equirectangular. Returns [east, north].
  function winkel(phiDeg, lamDeg) {
    var phi = phiDeg * D2R, lam = lamDeg * D2R;
    var p1 = Math.acos(2 / Math.PI);
    var a = Math.acos(clamp1(Math.cos(phi) * Math.cos(lam / 2)));
    var sinca = Math.abs(a) < 1e-12 ? 1.0 : Math.sin(a) / a;
    return [0.5 * (lam * Math.cos(p1) + 2 * Math.cos(phi) * Math.sin(lam / 2) / sinca),
            0.5 * (phi + Math.sin(phi) / sinca)];
  }

  // Web (spherical) Mercator. Latitude clamped to ±85.0511° (the standard web-map cutoff). Returns [east, north].
  function mercator(phiDeg, lamDeg) {
    var lat = Math.max(-85.0511, Math.min(85.0511, phiDeg)) * D2R;
    return [lamDeg * D2R, Math.log(Math.tan(Math.PI / 4 + lat / 2))];
  }

  // Inverse of mercator(): normalized plane [x=east(λ rad), y=north] -> geographic [latDeg, lonDeg].
  function mercatorInverse(x, y) {
    return [R2D * (2 * Math.atan(Math.exp(y)) - Math.PI / 2), R2D * x];
  }

  // The boundary loop of the Web-Mercator DISC the Region Map Explorer crops for a {lat,lon}
  // centre at a given ground radius (km). The on-screen crop is a CSS-circle clip of a fixed-zoom
  // Leaflet view, which is an isotropic linear scaling of EPSG:3857 — so it is EXACTLY a circle in
  // the Mercator plane. Working the page's computeZoom() through (the pixel size cancels), that
  // circle is centred at mercator(centre) with normalized-plane radius
  //     r = radiusKm / (EARTH_RADIUS_KM · cos φ0).
  // We sample the circle and invert back to geographic coords, so the caller can project the loop
  // onto ANY framing (e.g. draw the Hǎo image of the exact Mercator crop). NB the image on a
  // non-conformal projection is generally NOT a circle. Returns {lat:[], lon:[]}, closed
  // (last point == first). Shape mirrors greatCircle() so consumers treat both the same way.
  function mercatorDisc(centre, radiusKm, n) {
    n = n || 256;
    var c = mercator(centre.lat, centre.lon);                       // [x0 = λ rad, y0]
    var r = radiusKm / (EARTH_RADIUS_KM * Math.cos(centre.lat * D2R));
    var lat = [], lon = [], i, t, g;
    for (i = 0; i <= n; i++) {                                       // <= n closes the loop (i=n repeats i=0)
      t = 2 * Math.PI * i / n;
      g = mercatorInverse(c[0] + r * Math.cos(t), c[1] + r * Math.sin(t));
      lat.push(g[0]); lon.push(g[1]);
    }
    return { lat: lat, lon: lon };
  }

  // Normalise any base projection to [east, north].
  function baseProject(projId, phiDeg, lamDeg) {
    var p = projById(projId);
    if (p.kind === 'winkel') return winkel(phiDeg, lamDeg);
    if (p.kind === 'mercator') return mercator(phiDeg, lamDeg);
    if (p.kind === 'polyconic') { var ne = pBase(phiDeg, lamDeg, POLYCONIC); return [ne[1], ne[0]]; }
    throw new Error('unknown projection kind: ' + p.kind);
  }

  // ---- Stage-1 oblique rotation (vertical framings), Eq (7)-(10) -------------
  function vecBL(Bdeg, Ldeg) { var B = Bdeg * D2R, L = Ldeg * D2R, cB = Math.cos(B); return [cB * Math.cos(L), cB * Math.sin(L), Math.sin(B)]; }
  function mv(M, v) { return [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
                              M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
                              M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]]; }
  // geographic→generalized rotation M from the map centre (Eq 7-8): rows are the generalized
  // basis — +X = the centre, +Z = the pole at (0°, lon−90°) (orthogonal to centre), +Y = Z×X.
  function rotFromCentre(c) {
    var vc = vecBL(c.lat, c.lon), vp = vecBL(0, c.lon - 90);
    var vy = [vp[1] * vc[2] - vp[2] * vc[1], vp[2] * vc[0] - vp[0] * vc[2], vp[0] * vc[1] - vp[1] * vc[0]];
    return [vc, vy, vp];
  }

  // geographic (lat,lon) -> generalized (φ,λ) deg, via Eq (9),(8),(10).
  function genCoords(latDeg, lonDeg, centre) {
    var L = lonDeg * D2R, B = latDeg * D2R;
    var V = [Math.cos(B) * Math.cos(L), Math.cos(B) * Math.sin(L), Math.sin(B)];
    var Vp = mv(centre._M || (centre._M = rotFromCentre(centre)), V);       // build M once per framing, then cache
    return [R2D * Math.atan2(Vp[2], Math.hypot(Vp[0], Vp[1])), R2D * Math.atan2(Vp[1], Vp[0])]; // [φ, λ]
  }

  function wrap180(x) { return ((x + 180) % 360 + 360) % 360 - 180; }  // signed-mod parity with NumPy

  // ---- great circle (slerp) -> {lat:[], lon:[]} -----------------------------
  function greatCircle(a, b, n) {
    n = n || 500;
    var la1 = a[0] * D2R, lo1 = a[1] * D2R, la2 = b[0] * D2R, lo2 = b[1] * D2R;
    var A = [Math.cos(la1) * Math.cos(lo1), Math.cos(la1) * Math.sin(lo1), Math.sin(la1)];
    var B = [Math.cos(la2) * Math.cos(lo2), Math.cos(la2) * Math.sin(lo2), Math.sin(la2)];
    var om = Math.acos(clamp1(A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
    var sinOm = Math.sin(om), lat = [], lon = [];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1), V;
      if (Math.abs(sinOm) < 1e-9) {            // identical or antipodal endpoints: degenerate fallback
        V = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
        var L = Math.hypot(V[0], V[1], V[2]) || 1; V = [V[0] / L, V[1] / L, V[2] / L];
      } else {
        var s0 = Math.sin((1 - t) * om) / sinOm, s1 = Math.sin(t * om) / sinOm;
        V = [s0 * A[0] + s1 * B[0], s0 * A[1] + s1 * B[1], s0 * A[2] + s1 * B[2]];
      }
      lat.push(R2D * Math.asin(clamp1(V[2]))); lon.push(R2D * Math.atan2(V[1], V[0]));
    }
    return { lat: lat, lon: lon };
  }

  // ---- domain / orientation split (so geometry can cut BEFORE projecting) ----
  // toDomain: (lat,lon) -> the base-projection input [a, b]. b is the "seam"
  // coordinate (generalized λ for vertical, central-relative lon for horizontal).
  function centralOf(coord) { return coord.central != null ? coord.central : wrap180(coord.seam + 180); }  // central meridian = antipode of the seam
  function toDomain(coord, latDeg, lonDeg) {
    if (coord.kind === 'vertical') return genCoords(latDeg, lonDeg, coord.centre);   // [φ, λ]
    return [latDeg, wrap180(lonDeg - centralOf(coord))];                              // [lat, lamrel]
  }
  // projectDomain: base-projection input [a,b] -> screen [x, y] with orientation.
  function projectDomain(coord, projId, a, b) {
    var en = baseProject(projId, a, b);                     // [east, north]
    if (coord.kind === 'vertical') return [-en[1], en[0]];  // portrait: screenX=-north, screenY=east
    return [en[0], en[1]];                                  // landscape: screenX=east, screenY=north
  }
  // convenience per-point projector: (lat,lon) -> {x, y, seam}.
  function project(coord, projId, latDeg, lonDeg) {
    var d = toDomain(coord, latDeg, lonDeg);
    var s = projectDomain(coord, projId, d[0], d[1]);
    return { x: s[0], y: s[1], seam: d[1] };
  }

  // The (vertical-kind) framing centre {lat,lon} at which the great circle through A=[lat,lon] and
  // B=[lat,lon] becomes the central meridian (gen-λ=0) — the only straight line in this polyconic —
  // so the route draws with zero curvature down the middle of the lens. NB it runs HORIZONTALLY in
  // this map's orientation (the central meridian is the lens's short/horizontal axis; the
  // perpendicular axis is a curved parallel, so there is no straight vertical option). The route's
  // great-circle pole pins the generalized y-axis, giving φc = 90∓pole_lat, λc = pole_lon∓180.
  // Returns the "front" centre (route through the middle, not the seam); null if A,B are identical
  // or antipodal (no unique great circle).
  function centreForStraightLine(A, B) {
    var va = vecBL(A[0], A[1]), vb = vecBL(B[0], B[1]);
    var n = [va[1] * vb[2] - va[2] * vb[1], va[2] * vb[0] - va[0] * vb[2], va[0] * vb[1] - va[1] * vb[0]];
    var L = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (L < 1e-9) return null;
    n = [n[0] / L, n[1] / L, n[2] / L];
    var poleLat = R2D * Math.asin(clamp1(n[2])), poleLon = R2D * Math.atan2(n[1], n[0]);
    var cands = [{ lat: 90 - poleLat, lon: wrap180(poleLon - 180) }, { lat: 90 + poleLat, lon: wrap180(poleLon) }];
    for (var i = 0; i < 2; i++) { var c = cands[i]; if (c.lat < -90 || c.lat > 90) continue;
      if (Math.abs(wrap180(genCoords(A[0], A[1], { lat: c.lat, lon: c.lon })[1])) < 1) return c; }  // A on gen-λ≈0 → down the MIDDLE (not the seam)
    for (var j = 0; j < 2; j++) { if (cands[j].lat >= -90 && cands[j].lat <= 90) return cands[j]; }
    return null;
  }

  root.PROJ = {
    cfg: cfg, projById: projById, coordById: coordById,
    EARTH_RADIUS_KM: EARTH_RADIUS_KM,
    pBase: pBase, winkel: winkel, baseProject: baseProject,
    mercator: mercator, mercatorInverse: mercatorInverse, mercatorDisc: mercatorDisc,
    genCoords: genCoords, wrap180: wrap180, greatCircle: greatCircle,
    rotFromCentre: rotFromCentre, centralOf: centralOf,
    toDomain: toDomain, projectDomain: projectDomain, project: project,
    centreForStraightLine: centreForStraightLine
  };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
