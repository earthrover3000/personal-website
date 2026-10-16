// projection.js — projection kernels, ported faithfully from the validated
// Python kernel in ./scripts/ (base_projection.py). All numeric parameters
// come from window.PROJECTION_CONFIG (generated from config.yaml), so there
// are no hard-coded projection constants here — change the YAML, not this file.
//
// Exposes window.PROJ. Works in the browser and in Node (for the numeric
// self-test against Python): it attaches to `self`/`globalThis` and reads
// PROJECTION_CONFIG from the same root.
//
// Conventions (matching the Python):
//   - pBase (Hǎo polyconic) natively returns [north, east]; equalEarth and
//     mercator return [east, north]. baseProject() NORMALISES all to [east, north].
//   - Vertical (N/S) framings: oblique rotation then PORTRAIT screen
//     (screenX = -north, screenY = east).  Horizontal (E/W): central-meridian
//     shift then LANDSCAPE screen (screenX = east, screenY = north).

(function (root) {
  'use strict';
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var EARTH_RADIUS_KM = 6378.137;   // Web-Mercator sphere (WGS84 semi-major axis); the radius EPSG:3857 / Leaflet assume
  var MERCATOR_MAXLAT = 85.0511;    // the standard Web-Mercator latitude cutoff: beyond this, Mercator can't reach — the "hole" the limit overlay marks on other framings
  function clamp1(x) { return x < -1 ? -1 : (x > 1 ? 1 : x); }

  function cfg() { return root.PROJECTION_CONFIG; }
  function projById(id) { return cfg().projections.filter(function (p) { return p.id === id; })[0]; }
  function coordById(id) { return cfg().coordinates.filter(function (c) { return c.id === id; })[0]; }

  // ---- base projections -----------------------------------------------------
  // Eq (1)-(6) constants for Hǎo's equal-difference polyconic (the `polyconic` kind). Fixed
  // published formula, not exposed in config.yaml. Keep in sync with base_projection.py.
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

  // Equal Earth (Šavrič, Patterson & Jenny 2019, "The Equal Earth map projection",
  // Int. J. Geographical Information Science 33(3)). Equal-AREA pseudocylindrical: the
  // parametric latitude θ = asin(√3/2·sin φ) is run through a fitted odd polynomial in the
  // vertical, and the horizontal is that polynomial's derivative — which is exactly what makes
  // the Jacobian constant, so every country covers the pixels its ground area deserves. The four
  // A-coefficients ARE the projection (they were least-squares fitted to look like Robinson while
  // staying equal-area), so like the polyconic's Eq (1)-(6) constants they live here, not in
  // config.yaml. Poles are a line 0.5925 × the equator, so — as with the polyconic —
  // map-geometry.js's poleCut applies. Returns [east, north].
  var EQUAL_EARTH = { A1: 1.340264, A2: -0.081106, A3: 0.000893, A4: 0.003796 };
  function equalEarth(phiDeg, lamDeg) {
    var E = EQUAL_EARTH;
    var th = Math.asin(clamp1(Math.sqrt(3) / 2 * Math.sin(phiDeg * D2R)));
    var t2 = th * th, t6 = t2 * t2 * t2, t8 = t6 * t2;
    var dydt = E.A1 + 3 * E.A2 * t2 + 7 * E.A3 * t6 + 9 * E.A4 * t8;          // d(north)/dθ — the equal-area denominator
    return [2 * Math.sqrt(3) * (lamDeg * D2R) * Math.cos(th) / (3 * dydt),
            th * (E.A1 + E.A2 * t2 + E.A3 * t6 + E.A4 * t8)];
  }

  // Web (spherical) Mercator. Latitude clamped to ±85.0511° (the standard web-map cutoff). Returns [east, north].
  function mercator(phiDeg, lamDeg) {
    var lat = Math.max(-MERCATOR_MAXLAT, Math.min(MERCATOR_MAXLAT, phiDeg)) * D2R;
    return [lamDeg * D2R, Math.log(Math.tan(Math.PI / 4 + lat / 2))];
  }

  // Adams "World in a Square II" (O. S. Adams 1929, US C&GS Special Publication 153): CONFORMAL,
  // the whole sphere inside a square, with the four corners as its only singular points. Ported
  // line for line from PROJ's adams.cpp (mode ADAMS_WS2, after Evenden's libproj4), including its
  // Chebyshev fit of the elliptic integral F(φ | k²=½), good to ~1e-7. In normal aspect the poles
  // are two opposite corners, (0°, ±180°) the other two, and the edge is the cut along λ = ±180° —
  // the same seam convention map-geometry.js already cuts on. Its own use here is Spilhaus (an
  // oblique aspect, see the `oblique` framing below). Returns [east, north].
  var ADAMS_C0 = 2.19174570831038;
  var ADAMS_C = [-8.58691003636495e-07, 2.02692115653689e-07, 3.12960480765314e-05,
                 5.30394739921063e-05, -0.0012804644680613, -0.00575574836830288, 0.0914203033408211];
  var RSQRT2 = Math.SQRT1_2;
  function ellInt5(phi) {                                    // F(φ | m=½), even Chebyshev series × φ (Clenshaw)
    var y = phi * 2 / Math.PI; y = 2 * y * y - 1;
    var y2 = 2 * y, d1 = 0, d2 = 0, t, i;
    for (i = 0; i < ADAMS_C.length; i++) { t = d1; d1 = y2 * d1 - d2 + ADAMS_C[i]; d2 = t; }
    return phi * (y * d1 - d2 + 0.5 * ADAMS_C0);
  }
  function adamsWs2(phiDeg, lamDeg) {
    var spp = Math.tan(0.5 * phiDeg * D2R);
    var a = Math.cos(Math.asin(clamp1(spp))) * Math.sin(0.5 * lamDeg * D2R);
    var sm = (spp + a) < 0, sn = (spp - a) < 0;
    var b = Math.acos(clamp1(spp)); a = Math.acos(clamp1(a));
    var m = Math.asin(clamp1(Math.sqrt(1 + Math.min(0, Math.cos(a + b))))); if (sm) m = -m;
    var n = Math.asin(clamp1(Math.sqrt(Math.abs(1 - Math.max(0, Math.cos(a - b)))))); if (sn) n = -n;
    var x = ellInt5(m), y = ellInt5(n);
    return [RSQRT2 * (x - y), RSQRT2 * (x + y)];              // the square, turned 45° so its sides run with the axes
  }

  // Lagrange (1779) — the CONFORMAL whole world in a circle (Lambert's construction with n = ½:
  // squash the longitudes by n, then map the conformal plane into a disc). Formula as in Snyder's
  // Album of Map Projections (1989) and d3-geo-projection's geoLagrange(0.5). The poles are the two
  // singular points, at the top and bottom of the rim, and the rim is the cut along λ = ±180° —
  // the same domain edge as Adams II, which is why "Spilhaus (round)" is simply THIS projection in
  // the Spilhaus framing: same cuts, same singular points, a disc instead of a square. Radius 2.
  // Returns [east, north].
  var LAGRANGE_N = 0.5;
  function lagrange(phiDeg, lamDeg) {
    if (Math.abs(Math.abs(phiDeg) - 90) < 1e-9) return [0, phiDeg < 0 ? -2 : 2];
    var sp = Math.sin(phiDeg * D2R), l = lamDeg * D2R * LAGRANGE_N;
    var v = Math.pow((1 + sp) / (1 - sp), LAGRANGE_N / 2), c = 0.5 * (v + 1 / v) + Math.cos(l);
    return [2 * Math.sin(l) / c, (v - 1 / v) / c];
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
    var g0 = mercatorDiscGeom(centre, radiusKm);
    var lat = [], lon = [], i, t, g;
    for (i = 0; i <= n; i++) {                                       // <= n closes the loop (i=n repeats i=0)
      t = 2 * Math.PI * i / n;
      g = mercatorInverse(g0.x + g0.r * Math.cos(t), g0.y + g0.r * Math.sin(t));
      lat.push(g[0]); lon.push(g[1]);
    }
    return { lat: lat, lon: lon };
  }

  // The disc's geometry IN the normalized Mercator plane: centre (x,y) = mercator(centre) and
  // radius r = radiusKm / (EARTH_RADIUS_KM · cos φ0). The ONE place that formula lives — shared
  // by mercatorDisc (the drawn outline), mercatorDiscContains (the membership gate) and
  // world-map.js's crop framing, so all three always describe the same circle.
  function mercatorDiscGeom(centre, radiusKm) {
    var c = mercator(centre.lat, centre.lon);
    return { x: c[0], y: c[1], r: radiusKm / (EARTH_RADIUS_KM * Math.cos(centre.lat * D2R)) };
  }

  // TRUE iff (lat,lon) lies inside the SAME Mercator-plane disc mercatorDisc() outlines — plane
  // (chordal) distance in the normalized Mercator plane, NOT haversine, so the gate agrees exactly
  // with the drawn circle (the flight-popover close-up gate's contract). Δλ is wrapped to ±180° so
  // a disc straddling the antimeridian still contains its far side (any real disc spans < 360°).
  // Latitudes beyond ±MERCATOR_MAXLAT are always OUTSIDE: mercator() would clamp them onto the
  // cutoff line, which could fake containment near the rim of a high-latitude disc — a point Web
  // Mercator cannot show is never "inside a Mercator crop".
  function mercatorDiscContains(centre, radiusKm, lat, lon) {
    if (lat < -MERCATOR_MAXLAT || lat > MERCATOR_MAXLAT) return false;
    var g = mercatorDiscGeom(centre, radiusKm);
    var dx = wrap180(lon - centre.lon) * D2R;                       // Mercator x is just λ in radians → wrapped Δλ
    var dy = mercator(lat, lon)[1] - g.y;
    return dx * dx + dy * dy <= g.r * g.r;
  }

  // Normalise any base projection to [east, north].
  function baseProject(projId, phiDeg, lamDeg) {
    var p = projById(projId);
    if (p.kind === 'equalearth') return equalEarth(phiDeg, lamDeg);
    if (p.kind === 'mercator') return mercator(phiDeg, lamDeg);
    if (p.kind === 'polyconic') { var ne = pBase(phiDeg, lamDeg, POLYCONIC); return [ne[1], ne[0]]; }
    if (p.kind === 'adams2') return adamsWs2(phiDeg, lamDeg);
    if (p.kind === 'lagrange') return lagrange(phiDeg, lamDeg);
    throw new Error('unknown projection kind: ' + p.kind);
  }

  // ---- three-angle oblique framing (kind 'oblique') ---------------------------
  // The vertical framings fix the third angle: their generalized pole always sits on the equator
  // 90° west of the centre, so north stays up through the middle. A projection that is not
  // symmetric about its centre — a square — needs that angle free as well, because twisting the
  // globe about the centre then moves where the cuts and corners fall, which turning the finished
  // image does not. This is that framing: centre {lat, lon}, the azimuth of the base projection's
  // north at the centre, and `rot`, a turn of the finished plane. Formulas are Snyder (1987) 5-7 and
  // 5-8b as PROJ's spilhaus.cpp writes them, spherical (PROJ's +R form), so the named defaults
  // reproduce +proj=spilhaus exactly. Any projection can sit in it; config.yaml pins one to a
  // projection through that projection's `aspect`.
  function obliqueParams(c) {
    if (c._ob) return c._ob;
    var phi0 = c.centre.lat * D2R, azi = (c.azimuth || 0) * D2R, rot = (c.rot || 0) * D2R;
    var sa = -Math.cos(phi0) * Math.cos(azi);
    return (c._ob = {
      sa: sa, ca: Math.sqrt(1 - sa * sa),
      lam0: c.centre.lon * D2R + Math.atan2(Math.tan(azi), -Math.sin(phi0)),   // PROJ's lon_0 + λ₀
      beta: Math.PI + Math.atan2(-Math.sin(azi), -Math.tan(phi0)),
      cr: Math.cos(rot), sr: Math.sin(rot)
    });
  }
  function obliqueToDomain(c, latDeg, lonDeg) {                // geographic -> base-projection (φ, λ), deg
    var q = obliqueParams(c), p = latDeg * D2R, dl = lonDeg * D2R - q.lam0;
    var cp = Math.cos(p), sp = Math.sin(p), cl = Math.cos(dl), sl = Math.sin(dl);
    var phi = Math.asin(clamp1(q.sa * sp - q.ca * cp * cl));                        // Snyder 5-7
    var lam = q.beta + Math.atan2(cp * sl, q.sa * cp * cl + q.ca * sp);              // Snyder 5-8b
    return [R2D * phi, wrap180(R2D * lam)];
  }
  function obliqueFromDomain(c, aDeg, bDeg) {                  // base-projection (φ, λ) -> geographic [lat, lon], deg
    var q = obliqueParams(c), p = aDeg * D2R, l = bDeg * D2R - q.beta;
    var cp = Math.cos(p), sp = Math.sin(p), cl = Math.cos(l), sl = Math.sin(l);
    var lat = Math.asin(clamp1(q.sa * sp + q.ca * cp * cl));
    var lon = q.lam0 + Math.atan2(cp * sl, q.sa * cp * cl - q.ca * sp);
    return [R2D * lat, wrap180(R2D * lon)];
  }

  // The framing a projection carries with it (config `aspect`), or null for the ordinary ones that
  // take whichever framing the user picks. One object per projection, so its cached params persist.
  var _aspects = {};
  function aspectCoord(projId) {
    var p = projById(projId);
    if (!p || !p.aspect) return null;
    if (!_aspects[projId]) {
      var a = p.aspect;
      _aspects[projId] = { id: projId, label: p.label, kind: 'oblique', centre: { lat: a.lat, lon: a.lon },
                           azimuth: a.azimuth || 0, rot: a.rot || 0 };
    }
    return _aspects[projId];
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
    if (coord.kind === 'oblique') return obliqueToDomain(coord, latDeg, lonDeg);      // [φ, λ]
    return [latDeg, wrap180(lonDeg - centralOf(coord))];                              // [lat, lamrel]
  }
  // fromDomain: the inverse — a domain point [a,b] back to geographic [lat, lon]. Lets a caller
  // build curves that are fixed in the DOMAIN (a domain parallel, the central axis) for any framing.
  function fromDomain(coord, a, b) {
    if (coord.kind === 'oblique') return obliqueFromDomain(coord, a, b);
    if (coord.kind === 'vertical') {                                                  // geo = Mᵀ · gen
      var M = coord.centre._M || (coord.centre._M = rotFromCentre(coord.centre));
      var p = a * D2R, l = b * D2R, g = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
      var x = M[0][0] * g[0] + M[1][0] * g[1] + M[2][0] * g[2], y = M[0][1] * g[0] + M[1][1] * g[1] + M[2][1] * g[2],
          z = M[0][2] * g[0] + M[1][2] * g[1] + M[2][2] * g[2];
      return [R2D * Math.asin(clamp1(z)), R2D * Math.atan2(y, x)];
    }
    return [a, wrap180(b + centralOf(coord))];
  }
  // projectDomain: base-projection input [a,b] -> screen [x, y] with orientation.
  function projectDomain(coord, projId, a, b) {
    var en = baseProject(projId, a, b);                     // [east, north]
    if (coord.kind === 'vertical') return [-en[1], en[0]];  // portrait: screenX=-north, screenY=east
    if (coord.kind === 'oblique') {                         // PROJ spilhaus.cpp's output turn, verbatim (k₀ = 1)
      var q = obliqueParams(coord);
      return [-(en[0] * q.cr + en[1] * q.sr), -(-en[0] * q.sr + en[1] * q.cr)];
    }
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
    EARTH_RADIUS_KM: EARTH_RADIUS_KM, MERCATOR_MAXLAT: MERCATOR_MAXLAT,
    pBase: pBase, equalEarth: equalEarth, adamsWs2: adamsWs2, lagrange: lagrange, baseProject: baseProject, aspectCoord: aspectCoord,
    fromDomain: fromDomain,
    mercator: mercator, mercatorInverse: mercatorInverse, mercatorDisc: mercatorDisc,
    mercatorDiscGeom: mercatorDiscGeom, mercatorDiscContains: mercatorDiscContains,
    genCoords: genCoords, wrap180: wrap180, greatCircle: greatCircle,
    rotFromCentre: rotFromCentre, centralOf: centralOf,
    toDomain: toDomain, projectDomain: projectDomain, project: project,
    centreForStraightLine: centreForStraightLine
  };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
