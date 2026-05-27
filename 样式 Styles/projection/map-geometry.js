// map-geometry.js — seam cutting, spike breaking, boundary, and ring/line
// rendering geometry, ported from research/maps-projections/scripts/
// (cut_pieces, the SPIKE break, coast_outline artifact drops, boundary).
// DOM-free: every function returns plain {X,Y} point arrays; world-map.js does
// the canvas drawing. Built on window.PROJ.
//
// The domain (a,b) fed to cutPieces is the BASE-projection input: for vertical
// framings (a,b)=(φ,λ) from the rotation; for horizontal (a,b)=(lat, lamrel).
// `b` is the seam coordinate (±180 is the cut). Cutting happens in domain space
// BEFORE projection, exactly like the Python.

(function (root) {
  'use strict';
  var PROJ = root.PROJ;

  // Split parallel arrays (A,B) wherever |ΔB|>180, inserting the exact B=±180
  // crossing (B to the edge, A linearly). If closed, rejoin head+tail (a ring's
  // start is arbitrary). Returns [{a:[],b:[]}].
  function cutPieces(A, B, closed) {
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

  // Break a projected polyline wherever a segment exceeds `spike` screen units
  // (pole-arc crossings). Drops the jump segment and any isolated point flanked
  // by two jumps — the fixed draw_lines behaviour. Returns [{X:[],Y:[]}].
  function spikeBreak(X, Y, spike) {
    var out = [], sx = [X[0]], sy = [Y[0]], i;
    for (i = 1; i < X.length; i++) {
      if (Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]) > spike) {
        if (sx.length >= 2) out.push({ X: sx, Y: sy });
        sx = [X[i]]; sy = [Y[i]];
      } else { sx.push(X[i]); sy.push(Y[i]); }
    }
    if (sx.length >= 2) out.push({ X: sx, Y: sy });
    return out;
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
  // (±180° cut, ±90° pole enclosure), the projection seam, and pole-arc spikes.
  function ringOutlineArcs(coord, projId, lon, lat, spike) {
    var n = lat.length, X = [], Y = [], seam = [], i, pr;
    for (i = 0; i < n; i++) { pr = PROJ.project(coord, projId, lat[i], lon[i]); X.push(pr.x); Y.push(pr.y); seam.push(pr.seam); }
    var arcs = [], cur = [0];
    for (i = 0; i < n - 1; i++) {
      var anti = Math.abs(lon[i]) >= 180 && Math.abs(lon[i + 1]) >= 180 && lon[i] * lon[i + 1] > 0;
      var pole = Math.abs(lat[i]) >= 90 && Math.abs(lat[i + 1]) >= 90;
      var seamx = Math.abs(seam[i + 1] - seam[i]) > 180;
      var jump = Math.hypot(X[i + 1] - X[i], Y[i + 1] - Y[i]) > spike;
      if (anti || pole || seamx || jump) { if (cur.length > 1) arcs.push(cur); cur = [i + 1]; }
      else cur.push(i + 1);
    }
    if (cur.length > 1) arcs.push(cur);
    return arcs.map(function (idx) {
      var xs = [], ys = [];
      for (var k = 0; k < idx.length; k++) { xs.push(X[idx[k]]); ys.push(Y[idx[k]]); }
      return { X: xs, Y: ys };
    });
  }

  // An open polyline (graticule line or great-circle arc) as parallel lat[],lon[]:
  // seam-cut + project + spike-break. Returns [{X,Y}].
  function lineSegs(coord, projId, lat, lon, spike) {
    var A = [], B = [], i, d;
    for (i = 0; i < lat.length; i++) { d = PROJ.toDomain(coord, lat[i], lon[i]); A.push(d[0]); B.push(d[1]); }
    var pieces = cutPieces(A, B, false), out = [];
    for (var p = 0; p < pieces.length; p++) {
      var pa = pieces[p].a, pb = pieces[p].b;
      if (pa.length < 2) continue;
      var xy = _projDomainArr(coord, projId, pa, pb);
      var subs = spikeBreak(xy.X, xy.Y, spike);
      for (var k = 0; k < subs.length; k++) out.push(subs[k]);
    }
    return out;
  }

  // A thin BAND between two parallel geographic edges (edge A, edge B, same length, indexed by
  // the same parameter), filled as a ladder of small quads. Unlike ringFillPolys it does NOT
  // close along the map boundary — a band is a strip, not a blob — so it can never fill the map
  // interior. A cell that wraps across the seam projects with its corners on OPPOSITE map edges,
  // so its projected bounding box explodes past maxJump → drop it (a hairline on the seam).
  // Each cell is cut at the seam in DOMAIN space (b = the seam coord; ±180 is the cut): a cell that
  // straddles the seam is split into a main piece (b∈[−180,180]) plus the overflow, which is shifted
  // ±360 so it lands on the OPPOSITE map edge — exactly where the band continues. This is what makes
  // a belt that crosses the projection seam meet the edge cleanly (and wrap to the other side) instead
  // of being dropped, which left a flat stub short of the seam. Every emitted piece is normalized to
  // ONE winding so the draw step's single nonzero-winding union stays hole-free at the side↔cap
  // corners. (maxJump is no longer needed — kept for signature compatibility.)
  function bandFillPolys(coord, projId, lonA, latA, lonB, latB, maxJump) {
    var n = latA.length, polys = [], i, d, aA = [], bA = [], aB = [], bB = [];
    for (i = 0; i < n; i++) { d = PROJ.toDomain(coord, latA[i], lonA[i]); aA.push(d[0]); bA.push(d[1]); d = PROJ.toDomain(coord, latB[i], lonB[i]); aB.push(d[0]); bB.push(d[1]); }
    function unwrap(ref, b) { while (b - ref > 180) b -= 360; while (b - ref < -180) b += 360; return b; }
    function clipB(poly, below, lim) {                               // keep b≤lim (below) or b≥lim; insert the b=lim crossing (a interpolated linearly)
      var out = [], m = poly.length, j;
      for (j = 0; j < m; j++) {
        var cur = poly[j], nxt = poly[(j + 1) % m];
        var ci = below ? cur[1] <= lim : cur[1] >= lim, ni = below ? nxt[1] <= lim : nxt[1] >= lim;
        if (ci) out.push(cur);
        if (ci !== ni) { var t = (lim - cur[1]) / (nxt[1] - cur[1]); out.push([cur[0] + t * (nxt[0] - cur[0]), lim]); }
      }
      return out;
    }
    function emit(poly, shift) {                                     // project a domain polygon (b shifted ±360 for the wrapped copy) with normalized winding
      if (poly.length < 3) return;
      var X = [], Y = [], s, k;
      for (k = 0; k < poly.length; k++) { s = PROJ.projectDomain(coord, projId, poly[k][0], poly[k][1] + (shift || 0)); X.push(s[0]); Y.push(s[1]); }
      var area2 = (X[1] - X[0]) * (Y[2] - Y[0]) - (X[2] - X[0]) * (Y[1] - Y[0]);
      if (area2 < 0) { X.reverse(); Y.reverse(); }
      polys.push({ X: X, Y: Y });
    }
    for (i = 0; i < n - 1; i++) {
      var q0 = bA[i], q1 = unwrap(q0, bB[i]), q2 = unwrap(q1, bB[i + 1]), q3 = unwrap(q2, bA[i + 1]);
      var quad = [[aA[i], q0], [aB[i], q1], [aB[i + 1], q2], [aA[i + 1], q3]];
      var lo = Math.min(q0, q1, q2, q3), hi = Math.max(q0, q1, q2, q3);
      if (lo >= -180 && hi <= 180) { emit(quad, 0); continue; }      // wholly inside one panel — no seam cut
      emit(clipB(clipB(quad, true, 180), false, -180), 0);           // main panel [−180,180]
      if (hi > 180) emit(clipB(quad, false, 180), -360);             // overflow past +180 → wraps to the left edge
      if (lo < -180) emit(clipB(quad, true, -180), 360);             // overflow past −180 → wraps to the right edge
    }
    return polys;
  }

  root.MAPGEO = {
    cutPieces: cutPieces, spikeBreak: spikeBreak, boundary: boundary,
    ringFillPolys: ringFillPolys, ringOutlineArcs: ringOutlineArcs, lineSegs: lineSegs,
    bandFillPolys: bandFillPolys
  };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
