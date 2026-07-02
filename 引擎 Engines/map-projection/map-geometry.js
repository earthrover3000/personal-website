// map-geometry.js — seam + pole cutting, boundary, and ring/line rendering
// geometry. Originally ported from validated Python prototypes; the Python
// originals no longer exist in ./scripts/, so THIS FILE is now the reference
// implementation. DOM-free: every function returns plain {X,Y} point arrays;
// world-map.js does the canvas drawing. Built on window.PROJ.
//
// The domain (a,b) fed to cutPieces is the BASE-projection input: for vertical
// framings (a,b)=(φ,λ) from the rotation; for horizontal (a,b)=(lat, lamrel).
// `b` is the seam coordinate (±180 is the cut). This projection family has TWO
// cut loci, both handled exactly, in domain space, BEFORE projection:
//   · the seam b=±180 (the lens edge) — cut with the exact crossing point;
//   · the domain poles a=±90, which project to ARCS (not points) in the
//     polyconic/Winkel kernels — a path across a pole tears on the map, so it
//     is cut with both cut-ends placed ON the pole arc (poleCut mode, lines
//     only). This replaced the old screen-space spikeBreak heuristic (drop any
//     projected segment > 4% of the lens span), whose failure modes were gaps
//     in stretched-but-legitimate segments and missed sub-threshold tears.

(function (root) {
  'use strict';
  var PROJ = root.PROJ;

  // Split parallel arrays (A,B) wherever |ΔB|>180, inserting the exact B=±180
  // crossing (B to the edge, A linearly). If closed, rejoin head+tail (a ring's
  // start is arbitrary). With poleCut (open lines only), ALSO split where
  // unwrapped |ΔB| ∈ (90,180]: with dense sampling, consecutive points can only
  // differ that much in b when the path crosses a domain pole (legitimate
  // |ΔB| ≈ step/cos(a) reaches 90° only within ~step° of the pole, and our
  // lines sample every ~0.36°), and the pole projects to an ARC — so the piece
  // is ended ON the arc at the incoming b and resumed ON the arc at the
  // outgoing b, ≤ one sample step from the true crossing. Returns [{a:[],b:[]}].
  function cutPieces(A, B, closed, poleCut) {
    var pieces = [], a = [], b = [], i;
    for (i = 0; i < B.length; i++) {
      if (b.length) {
        var dl = B[i] - b[b.length - 1];
        if (Math.abs(dl) > 180) {
          var edge = dl > 0 ? -180 : 180;
          var l1 = dl > 0 ? B[i] - 360 : B[i] + 360;
          var t = (edge - b[b.length - 1]) / (l1 - b[b.length - 1]);
          var ac = a[a.length - 1] + t * (A[i] - a[a.length - 1]);
          a.push(ac); b.push(edge);
          pieces.push({ a: a, b: b });
          a = [-0 + ac]; b = [-edge];
          a.push(A[i]); b.push(B[i]);
          continue;
        }
        if (poleCut && Math.abs(dl) > 90) {
          var sp = (a[a.length - 1] + A[i] >= 0) ? 90 : -90;   // which pole, from the flanking a values
          a.push(sp); b.push(b[b.length - 1]);                  // end ON the pole arc at the incoming b
          pieces.push({ a: a, b: b });
          a = [sp, A[i]]; b = [B[i], B[i]];                     // resume ON the arc at the outgoing b
          continue;
        }
      }
      a.push(A[i]); b.push(B[i]);
    }
    if (a.length >= 2) pieces.push({ a: a, b: b });
    if (closed && pieces.length >= 2) {
      var tail = pieces.pop(), head = pieces.shift();
      pieces.push({ a: tail.a.concat(head.a.slice(1)), b: tail.b.concat(head.b.slice(1)) });
    }
    return pieces;
  }

  // The map outline (ocean lens). Domain frame is the same for both kinds:
  // a∈[-90,90] (the non-seam coord), b∈[-180,180] (the seam coord).
  function boundary(coord, projId, n) {
    n = n || 400;
    var a = [], b = [], i, t, s, X = [], Y = [];
    for (i = 0; i < n; i++) { a.push(-90 + 180 * i / (n - 1)); b.push(180); }
    for (i = 0; i < 2 * n; i++) { a.push(90); b.push(180 - 360 * i / (2 * n - 1)); }
    for (i = 0; i < n; i++) { a.push(90 - 180 * i / (n - 1)); b.push(-180); }
    for (i = 0; i < 2 * n; i++) { a.push(-90); b.push(-180 + 360 * i / (2 * n - 1)); }
    for (i = 0; i < a.length; i++) { s = PROJ.projectDomain(coord, projId, a[i], b[i]); X.push(s[0]); Y.push(s[1]); }
    return { X: X, Y: Y };
  }

  function _projDomainArr(coord, projId, A, B) {
    var X = [], Y = [], s;
    for (var j = 0; j < A.length; j++) { s = PROJ.projectDomain(coord, projId, A[j], B[j]); X.push(s[0]); Y.push(s[1]); }
    return { X: X, Y: Y };
  }

  // A coastline ring's FILL polygons: seam-cut + (for seam pieces) closed along
  // the map boundary. ring = parallel lon[],lat[]. Returns [{X,Y}] to fill.
  function ringFillPolys(coord, projId, lon, lat) {
    var A = [], B = [], i, d;
    for (i = 0; i < lat.length; i++) { d = PROJ.toDomain(coord, lat[i], lon[i]); A.push(d[0]); B.push(d[1]); }
    var pieces = cutPieces(A, B, true), seam = pieces.length > 1, polys = [];
    for (var p = 0; p < pieces.length; p++) {
      var pa = pieces[p].a, pb = pieces[p].b;
      if (pa.length < 3) continue;
      if (seam) {
        var edge = Math.abs(pb[pb.length - 1]) > Math.abs(pb[0]) ? pb[pb.length - 1] : pb[0];
        var ca = pa.slice(), cb = pb.slice(), j;
        for (j = 0; j < 120; j++) { ca.push(pa[pa.length - 1] + (pa[0] - pa[pa.length - 1]) * j / 119); cb.push(edge); }
        polys.push(_projDomainArr(coord, projId, ca, cb));
      } else {
        polys.push(_projDomainArr(coord, projId, pa, pb));
      }
    }
    return polys;
  }

  // A coastline ring's OUTLINE arcs: drops Natural Earth's artificial edges
  // (±180° cut, ±90° pole enclosure), the projection seam, and domain-pole
  // tears (unwrapped |Δb| > 90 — the same domain-space rule as cutPieces'
  // poleCut; NE segments are dense enough that a legitimate pair can't differ
  // that much in b away from a pole).
  function ringOutlineArcs(coord, projId, lon, lat) {
    var n = lat.length, X = [], Y = [], seam = [], i, pr;
    for (i = 0; i < n; i++) { pr = PROJ.project(coord, projId, lat[i], lon[i]); X.push(pr.x); Y.push(pr.y); seam.push(pr.seam); }
    var arcs = [], cur = [0];
    for (i = 0; i < n - 1; i++) {
      var anti = Math.abs(lon[i]) >= 180 && Math.abs(lon[i + 1]) >= 180 && lon[i] * lon[i + 1] > 0;
      var pole = Math.abs(lat[i]) >= 90 && Math.abs(lat[i + 1]) >= 90;
      var db = Math.abs(seam[i + 1] - seam[i]);
      var seamx = db > 180;
      var polex = Math.min(db, 360 - db) > 90;
      if (anti || pole || seamx || polex) { if (cur.length > 1) arcs.push(cur); cur = [i + 1]; }
      else cur.push(i + 1);
    }
    if (cur.length > 1) arcs.push(cur);
    return arcs.map(function (idx) {
      var xs = [], ys = [];
      for (var k = 0; k < idx.length; k++) { xs.push(X[idx[k]]); ys.push(Y[idx[k]]); }
      return { X: xs, Y: ys };
    });
  }

  // Densify a piece's near-pole sweeps: within a piece, a segment whose |Δb|
  // exceeds MAXB° is a legitimate pass CLOSE to a domain pole (true crossings,
  // |Δb|>90, were already cut) — its projected image hugs the pole arc, so
  // subdivide linearly in domain space to follow that curve instead of drawing
  // a chord across it. Error vs the true path is bounded by the sagitta of one
  // ~0.36° sample arc — invisible. Cost is negligible: only near-pole segments
  // qualify.
  var DENSIFY_MAXB = 5;
  function densifyPiece(pa, pb) {
    var qa = [pa[0]], qb = [pb[0]], i, k, n, db;
    for (i = 1; i < pa.length; i++) {
      db = Math.abs(pb[i] - pb[i - 1]);
      n = db > DENSIFY_MAXB ? Math.ceil(db / DENSIFY_MAXB) : 1;
      for (k = 1; k <= n; k++) { qa.push(pa[i - 1] + (pa[i] - pa[i - 1]) * k / n); qb.push(pb[i - 1] + (pb[i] - pb[i - 1]) * k / n); }
    }
    return { a: qa, b: qb };
  }

  // An open polyline (graticule line or great-circle arc) as parallel lat[],lon[]:
  // seam-cut + pole-cut (both exact, in domain space) + near-pole densify +
  // project. Returns [{X,Y}].
  function lineSegs(coord, projId, lat, lon) {
    var A = [], B = [], i, d;
    for (i = 0; i < lat.length; i++) { d = PROJ.toDomain(coord, lat[i], lon[i]); A.push(d[0]); B.push(d[1]); }
    var pieces = cutPieces(A, B, false, true), out = [];
    for (var p = 0; p < pieces.length; p++) {
      if (pieces[p].a.length < 2) continue;
      var dp = densifyPiece(pieces[p].a, pieces[p].b);
      out.push(_projDomainArr(coord, projId, dp.a, dp.b));
    }
    return out;
  }

  // ---- shared domain-polygon helpers (bandFillPolys + gridFillPolys) ----
  // b-continuity: bring b within ±180 of ref so a path's b coordinate is smooth
  // across the raw wrap180 output.
  function unwrapB(ref, b) { while (b - ref > 180) b -= 360; while (b - ref < -180) b += 360; return b; }
  // Half-plane clip on b: keep b≤lim (below) or b≥lim; insert the b=lim
  // crossing (a interpolated linearly). Sutherland–Hodgman, one plane.
  function clipB(poly, below, lim) {
    var out = [], m = poly.length, j;
    for (j = 0; j < m; j++) {
      var cur = poly[j], nxt = poly[(j + 1) % m];
      var ci = below ? cur[1] <= lim : cur[1] >= lim, ni = below ? nxt[1] <= lim : nxt[1] >= lim;
      if (ci) out.push(cur);
      if (ci !== ni) { var t = (lim - cur[1]) / (nxt[1] - cur[1]); out.push([cur[0] + t * (nxt[0] - cur[0]), lim]); }
    }
    return out;
  }
  // Project a domain polygon (b shifted ±360 for wrapped copies) and append it
  // with normalized winding, so the draw step's single nonzero-winding union
  // stays hole-free. Full shoelace (not first-3-points) — long subdivided edges
  // make the first three vertices collinear, where a 3-point area is ambiguous.
  function emitDomainPoly(coord, projId, poly, shift, out) {
    if (poly.length < 3) return;
    var X = [], Y = [], s, k, k2, area2 = 0;
    for (k = 0; k < poly.length; k++) { s = PROJ.projectDomain(coord, projId, poly[k][0], poly[k][1] + (shift || 0)); X.push(s[0]); Y.push(s[1]); }
    for (k = 0; k < X.length; k++) { k2 = (k + 1) % X.length; area2 += X[k] * Y[k2] - X[k2] * Y[k]; }
    if (area2 < 0) { X.reverse(); Y.reverse(); }
    out.push({ X: X, Y: Y });
  }
  // Emit a domain polygon with per-polygon seam handling: wholly inside one
  // panel → direct; straddling ±180 → clip the main panel plus the overflow
  // shifted ∓360 so it lands on the OPPOSITE map edge — exactly where the
  // surface continues. This per-polygon cut needs NO closure heuristics (the
  // polygon is already closed in domain space), which is what makes cell/quad
  // rendering immune to the seam artifacts that global ring closure suffers.
  function emitSeamCut(coord, projId, poly, out) {
    var lo = Infinity, hi = -Infinity, i;
    for (i = 0; i < poly.length; i++) { if (poly[i][1] < lo) lo = poly[i][1]; if (poly[i][1] > hi) hi = poly[i][1]; }
    if (lo >= -180 && hi <= 180) { emitDomainPoly(coord, projId, poly, 0, out); return; }
    emitDomainPoly(coord, projId, clipB(clipB(poly, true, 180), false, -180), 0, out);   // main panel [−180,180]
    if (hi > 180) emitDomainPoly(coord, projId, clipB(poly, false, 180), -360, out);     // overflow past +180 → wraps to the left edge
    if (lo < -180) emitDomainPoly(coord, projId, clipB(poly, true, -180), 360, out);     // overflow past −180 → wraps to the right edge
  }

  // A thin BAND between two parallel geographic edges (edge A, edge B, same length, indexed by
  // the same parameter), filled as a ladder of small quads. Unlike ringFillPolys it does NOT
  // close along the map boundary — a band is a strip, not a blob — so it can never fill the map
  // interior. Each cell is cut at the seam in DOMAIN space via emitSeamCut. This is what makes
  // a belt that crosses the projection seam meet the edge cleanly (and wrap to the other side)
  // instead of being dropped. (maxJump is no longer needed — kept for signature compatibility.)
  function bandFillPolys(coord, projId, lonA, latA, lonB, latB, maxJump) {
    var n = latA.length, polys = [], i, d, aA = [], bA = [], aB = [], bB = [];
    for (i = 0; i < n; i++) { d = PROJ.toDomain(coord, latA[i], lonA[i]); aA.push(d[0]); bA.push(d[1]); d = PROJ.toDomain(coord, latB[i], lonB[i]); aB.push(d[0]); bB.push(d[1]); }
    for (i = 0; i < n - 1; i++) {
      var q0 = bA[i], q1 = unwrapB(q0, bB[i]), q2 = unwrapB(q1, bB[i + 1]), q3 = unwrapB(q2, bA[i + 1]);
      emitSeamCut(coord, projId, [[aA[i], q0], [aB[i], q1], [aB[i + 1], q2], [aA[i + 1], q3]], polys);
    }
    return polys;
  }

  // The polar CAP poleward of a constant domain-a edge (|a| = aEdge, side by
  // `sign`), as fill polygons. Exact in domain space — the edge parallel swept
  // across the full b range, closed along the pole arc a=±90 — so it needs no
  // ring reprojection and no seam closure. This is the correct construction
  // for any cap that encircles a DOMAIN pole (e.g. the oblique Mercator
  // clamp's ±85.05° caps), where ringFillPolys' closure heuristic mis-fills.
  function domainCapPolys(coord, projId, aEdge, sign, n) {
    n = n || 240;
    var poly = [], i;
    for (i = 0; i <= n; i++) poly.push([sign * aEdge, -180 + 360 * i / n]);   // cap boundary, west→east
    for (i = n; i >= 0; i--) poly.push([sign * 90, -180 + 360 * i / n]);      // back along the pole arc
    var out = [];
    emitDomainPoly(coord, projId, poly, 0, out);
    return out;
  }

  // Terrain band-index grid (WORLD_TERRAIN_GRID.{fine,coarse}) → per-code fill
  // polygons: { code: [{X,Y}, …] }. Each RLE run is one lat-strip rectangle in
  // geographic space, forward-warped into the projection with per-polygon seam
  // handling (emitSeamCut) — no global topology, so no closure artifacts on any
  // framing. Grid layout (see scripts/make_terrain_grid.py): row 0 = north,
  // rows[r] = flat [code,count,…] runs, cell (r,c) spans
  // lat [90−(r+1)·180/h, 90−r·180/h] × lon [−180+c·360/w, −180+(c+1)·360/w].
  function gridFillPolys(coord, projId, grid) {
    var w = grid.w, h = grid.h, rows = grid.rows;
    var dLat = 180 / h, dLon = 360 / w;
    var MAXSTEP = 2;                                   // max °lon per sampled edge segment — long runs curve with the projection instead of drawing domain chords
    var byCode = {};

    // One run rectangle → domain polygon (subdivided top/bottom edges, b
    // unwrapped along the path). Returns false when the polygon spans >180° of
    // b — i.e. it contains (or grazes) a domain pole — so the caller can split.
    function runPoly(lat0, lat1, lon0, lon1, out) {
      var n = Math.max(1, Math.ceil((lon1 - lon0) / MAXSTEP));
      var poly = [], prevB = null, i, t, d, b;
      function pt(lat, lonT) {
        d = PROJ.toDomain(coord, lat, lonT);
        b = prevB == null ? d[1] : unwrapB(prevB, d[1]);
        prevB = b;
        poly.push([d[0], b]);
      }
      for (i = 0; i <= n; i++) pt(lat1, lon0 + (lon1 - lon0) * i / n);   // north edge, west→east
      for (i = n; i >= 0; i--) pt(lat0, lon0 + (lon1 - lon0) * i / n);   // south edge, east→west
      var lo = Infinity, hi = -Infinity;
      for (i = 0; i < poly.length; i++) { if (poly[i][1] < lo) lo = poly[i][1]; if (poly[i][1] > hi) hi = poly[i][1]; }
      if (hi - lo > 180) return false;                                   // domain pole inside — caller handles
      emitSeamCut(coord, projId, poly, out);
      return true;
    }

    // A cell that contains a domain pole: its domain image is (nearly) the full
    // polar cap poleward of the cell's edge, so emit exactly that — the a-edge
    // swept across b, closed along the pole arc a=±90. Over-paint is bounded by
    // the cell size (~dLat°) around the pole point; at 0.25° that is sub-pixel
    // at default zoom.
    function capPoly(lat0, lat1, lon0, lon1, out) {
      var d = PROJ.toDomain(coord, (lat0 + lat1) / 2, (lon0 + lon1) / 2);
      var sgn = d[0] >= 0 ? 1 : -1, aEdge = 90, i, c;
      var corners = [[lat0, lon0], [lat0, lon1], [lat1, lon0], [lat1, lon1]];
      for (i = 0; i < 4; i++) { c = PROJ.toDomain(coord, corners[i][0], corners[i][1]); if (Math.abs(c[0]) < aEdge) aEdge = Math.abs(c[0]); }
      var poly = [], N = 90;
      for (i = 0; i <= N; i++) poly.push([sgn * aEdge, -180 + 360 * i / N]);   // cap boundary, west→east
      for (i = N; i >= 0; i--) poly.push([sgn * 90, -180 + 360 * i / N]);      // back along the pole arc
      emitDomainPoly(coord, projId, poly, 0, out);
    }

    var r, i, x, code, count, lat0, lat1, lon0, lon1, out, cc, l0;
    for (r = 0; r < h; r++) {
      lat1 = 90 - r * dLat; lat0 = lat1 - dLat;
      var run = rows[r]; x = 0;
      for (i = 0; i < run.length; i += 2) {
        code = run[i]; count = run[i + 1];
        lon0 = -180 + x * dLon; lon1 = -180 + (x + count) * dLon;
        x += count;
        out = byCode[code] || (byCode[code] = []);
        if (!runPoly(lat0, lat1, lon0, lon1, out)) {
          for (cc = 0; cc < count; cc++) {                                // split the pole-spanning run into single cells
            l0 = lon0 + cc * dLon;
            if (!runPoly(lat0, lat1, l0, l0 + dLon, out)) capPoly(lat0, lat1, l0, l0 + dLon, out);
          }
        }
      }
    }
    return byCode;
  }

  root.MAPGEO = {
    cutPieces: cutPieces, boundary: boundary,
    ringFillPolys: ringFillPolys, ringOutlineArcs: ringOutlineArcs, lineSegs: lineSegs,
    bandFillPolys: bandFillPolys, gridFillPolys: gridFillPolys, domainCapPolys: domainCapPolys
  };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
