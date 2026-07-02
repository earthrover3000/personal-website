// terrain-worker.js — bakes the terrain textures OFF the main thread.
//
// world-map.js posts {key, quality, coord, projId, detail, pal}; this worker
// warps the WORLD_TERRAIN_GRID cells through the projection (gridFillPolys),
// rasterizes the depth/elevation bands into two OffscreenCanvases — bathy with
// the lens clip baked in, topo with the land-mask clip — and transfers the
// resulting ImageBitmaps back. The main thread then draws each enabled layer
// with a single drawImage per frame, so toggling terrain and dragging never
// block on geometry or rasterization work.
//
// projection.js / map-geometry.js are worker-safe by construction (they attach
// to `self`); projection-config.js is the build-generated PROJECTION_CONFIG;
// coastline.js provides the land mask; terrain-grid.js the band-index cells.
'use strict';
importScripts('projection-config.js', 'projection.js', 'map-geometry.js', 'terrain-grid.js', 'coastline.js');

var PROJ = self.PROJ, MAPGEO = self.MAPGEO;

// Bin lower bounds — MUST match world-map.js and scripts/make_terrain_grid.py.
var DEPTH_BOUNDS = [0, 200, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
var LAND_BOUNDS = [0, 500, 1000, 2000, 3000, 4000, 5000];
var TERRAIN_LAND_BASE = 16;

// One-slot caches: theme flips and the coarse→fine upgrade reuse the same
// framing, so the expensive warps are keyed on everything EXCEPT palette.
var _coastKey = '', _coast = null, _bnd = null;
var _cellsKey = '', _cells = null;

function frameKey(q) { return JSON.stringify(q.coord) + '|' + q.projId; }

function coastAndBoundary(q) {
  var k = frameKey(q) + '|' + q.detail;
  if (_coastKey !== k) {
    var rings = self.WORLD_COASTLINE[q.detail] || self.WORLD_COASTLINE.fine;
    var coast = [];
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i].ring, ln = [], lt = [];
      for (var j = 0; j < r.length; j++) { ln.push(r[j][0]); lt.push(r[j][1]); }
      var polys = MAPGEO.ringFillPolys(q.coord, q.projId, ln, lt);
      for (var p = 0; p < polys.length; p++) coast.push(polys[p]);
    }
    _coast = coast; _bnd = MAPGEO.boundary(q.coord, q.projId); _coastKey = k;
  }
  return { coast: _coast, b: _bnd };
}

function cells(q) {
  var k = frameKey(q) + '|' + q.quality;
  if (_cellsKey !== k) { _cells = MAPGEO.gridFillPolys(q.coord, q.projId, self.WORLD_TERRAIN_GRID[q.quality]); _cellsKey = k; }
  return _cells;
}

self.onmessage = function (ev) {
  var q = ev.data;
  var cb = coastAndBoundary(q), b = cb.b, coast = cb.coast;
  var byCode = cells(q);
  var codes = [], gc;
  for (gc in byCode) codes.push(+gc);
  codes.sort(function (x, y) { return x - y; });                     // ascending = shallow→deep, then low→high land

  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, i;
  for (i = 0; i < b.X.length; i++) {
    if (b.X[i] < minX) minX = b.X[i]; if (b.X[i] > maxX) maxX = b.X[i];
    if (b.Y[i] < minY) minY = b.Y[i]; if (b.Y[i] > maxY) maxY = b.Y[i];
  }
  var spanX = maxX - minX, spanY = maxY - minY;
  var K = 2048, m = 0.01 * Math.max(spanX, spanY);
  var bx0 = minX - m, by1 = maxY + m;
  var sx = spanX + 2 * m, sy = spanY + 2 * m;
  var ts = K / Math.max(sx, sy);
  if (q.window) {                                                    // zoom overlay: bake only the requested projected window, at the requested resolution
    bx0 = q.window.bx0; by1 = q.window.by1; sx = q.window.sx; sy = q.window.sy; ts = q.window.ts;
    var cap = 4096 / Math.max(sx * ts, sy * ts);                     // texture-size safety cap
    if (cap < 1) ts *= cap;
  }

  function makeLayer(kind) {
    var cnv = new OffscreenCanvas(Math.ceil(sx * ts), Math.ceil(sy * ts));
    var tc = cnv.getContext('2d');
    tc.setTransform(ts, 0, 0, -ts, -bx0 * ts, by1 * ts);             // projected coords → texture px (y up → v down)
    function tracePolys(polys) { for (var si = 0; si < polys.length; si++) { var sg = polys[si]; tc.moveTo(sg.X[0], sg.Y[0]); for (var k = 1; k < sg.X.length; k++) tc.lineTo(sg.X[k], sg.Y[k]); tc.closePath(); } }
    tc.save();
    if (kind === 'bathy') {                                          // lens clip baked in: no band (or its AA edge) escapes the map
      tc.beginPath();
      for (var bk = 0; bk < b.X.length; bk++) { if (bk === 0) tc.moveTo(b.X[bk], b.Y[bk]); else tc.lineTo(b.X[bk], b.Y[bk]); }
      tc.closePath(); tc.clip();
    } else {                                                         // land-mask clip baked in: bands never spill past the NE coastline
      tc.beginPath(); tracePolys(coast); tc.clip('evenodd');
    }
    tc.lineJoin = 'miter'; tc.miterLimit = 2; tc.lineWidth = 1 / ts; // 1 texture px, same-color crack cover between adjacent cells
    for (var ci = 0; ci < codes.length; ci++) {
      var code = codes[ci], isLand = code >= TERRAIN_LAND_BASE;
      if ((kind === 'bathy') === isLand) continue;
      var col = isLand ? (q.pal.landColors[LAND_BOUNDS[code - TERRAIN_LAND_BASE]] || q.pal.land)
                       : (q.pal.bathyColors[DEPTH_BOUNDS[code]] || q.pal.ocean);
      tc.fillStyle = col; tc.strokeStyle = col;
      tc.beginPath(); tracePolys(byCode[code]);
      tc.fill(); tc.stroke();
    }
    tc.restore();
    return cnv.transferToImageBitmap();
  }

  var bathy = makeLayer('bathy'), topo = makeLayer('topo');
  self.postMessage({ key: q.key, quality: q.quality, slot: q.slot || 'base', bx0: bx0, by1: by1, ts: ts, sx: sx, sy: sy, bathy: bathy, topo: topo }, [bathy, topo]);
};
