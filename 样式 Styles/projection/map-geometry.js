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
  // The test is on PROJECTED size, not longitude range, so pole-cap cells (whose longitude is
  // degenerate at the pole) are kept — they project to a tidy little patch. Returns [{X,Y}].
  function bandFillPolys(coord, projId, lonA, latA, lonB, latB, maxJump) {
    var n = latA.length, AX = [], AY = [], BX = [], BY = [], polys = [], i, pr;
    for (i = 0; i < n; i++) { pr = PROJ.project(coord, projId, latA[i], lonA[i]); AX.push(pr.x); AY.push(pr.y); pr = PROJ.project(coord, projId, latB[i], lonB[i]); BX.push(pr.x); BY.push(pr.y); }
    for (i = 0; i < n - 1; i++) {
      var X = [AX[i], BX[i], BX[i + 1], AX[i + 1]], Y = [AY[i], BY[i], BY[i + 1], AY[i + 1]];
      var dx = Math.max(X[0], X[1], X[2], X[3]) - Math.min(X[0], X[1], X[2], X[3]);
      var dy = Math.max(Y[0], Y[1], Y[2], Y[3]) - Math.min(Y[0], Y[1], Y[2], Y[3]);
      if (Math.max(dx, dy) > maxJump) continue;                      // seam wrap: corners on opposite map edges → drop
      polys.push({ X: X, Y: Y });
    }
    return polys;
  }

  root.MAPGEO = {
    cutPieces: cutPieces, spikeBreak: spikeBreak, boundary: boundary,
    ringFillPolys: ringFillPolys, ringOutlineArcs: ringOutlineArcs, lineSegs: lineSegs,
    bandFillPolys: bandFillPolys
  };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
