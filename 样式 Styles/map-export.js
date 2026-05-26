// Shared lossless-PNG map exporter, used by the City Map Explorer
// (public/hobbies/cities-transport/) and the Region Map Explorer
// (public/hobbies/maps-projections/). Both pages link this file directly so
// they share one source of truth for the export pipeline; per-page
// inline JS only handles the page-specific controls (location list,
// default radius, etc.) and calls window.exportMapAsPng() to save.
//
// Single source of truth for the export canvas-size cap. Read by
// exportMapAsPng's hard-cap check below AND by each page's
// exportzoom input clamping — keep them in sync by reading this
// constant rather than hardcoding the number in three places.
//
// The cap exists to keep the canvas pixel buffer (4 × W × H bytes)
// under levels the browser can actually allocate. 16384 is Chrome's
// typical hard limit for canvas dimensions on most platforms —
// pushing past it silently clamps the buffer to 16384 while our
// drawing code thinks it has the larger size, so right/bottom edges
// end up missing or toBlob fails entirely (observed at Shanghai
// z=16, ~16668 px requested → no download). 16384² ≈ 1 GB raw,
// ~2 GB peak during toBlob encoding. The math compounds quickly:
// each +1 zoom = 4× tiles = 4× pixels.
//
// Note on history: an earlier attempt at 8192 cap appeared to fail
// partway through Dublin/z=14 exports (~5976 px, well under the cap).
// The actual cause turned out to be OSM's rate-limiter cutting off
// the burst of simultaneous tile fetches, not memory — fixed by
// dropping the concurrency limiter from 6 to 2 below. This cap is
// now purely a memory-safety ceiling.
window.EXPORT_MAX_CANVAS_DIM = 16384;

// Captures the currently displayed map area as a lossless PNG, clipped
// to the displayed shape (circle / rounded square).
//
// Strategy: render at the integer zoom Leaflet itself uses for its
// tile layer — Math.round(currentZoom), capped at each layer's
// maxZoom. At integer zoom every tile is exactly TILE_SIZE px, so
// positions are integer-aligned with no per-tile scaling — eliminating
// both the bilinear-edge seams and any overlap-stretch distortion of
// an in-place same-zoom export. Output PNG dimensions are 2^(zHi - z)
// × the on-screen size, which is ≥1 when the user's zoom is on the
// upper half of the integer interval and <1 on the lower half. We
// deliberately do NOT use Math.ceil here: that would pull tiles from
// a zoom level the screen never showed, so any detail that appears
// only above zHi-1 (e.g. OpenRailwayMap's line-number labels above
// z=13) would show up in the export but not on the page.
//
// Tile sourcing is dual-mode: prefer Leaflet's already-loaded DOM
// tiles via layer._tiles (fast, no network) and only fetch fresh
// when the requested coords aren't in DOM cache. The fast path is
// critical — when zHi == Math.round(currentZoom) (the common case),
// every needed tile is already in the DOM.
//
// Returns a Promise that resolves once the download is triggered.
// Optional onProgress(done, total) fires after each tile completes.
// Optional targetZoom overrides the tile zoom used for the export
// (rounded to integer and clamped to the layers' supported range).
// The output PNG dimensions are derived: on-screen geographic area
// captured at native pixel density of the chosen zoom — so each
// +1 zoom roughly doubles each side (4× the file). Default
// (targetZoom omitted) = same integer zoom Leaflet uses on screen.
window.exportMapAsPng = async function (map, container, shape, filename, onProgress, targetZoom) {
  var rect = container.getBoundingClientRect();
  var screenW = Math.round(rect.width);
  var screenH = Math.round(rect.height);
  if (!screenW || !screenH) return;

  var TILE_SIZE = 256;
  var center = map.getCenter();
  var currentZoom = map.getZoom();

  // Collect tile layers in addition order = z-order; pick the
  // highest integer zoom they all support.
  var maxZoom = Infinity;
  var layers = [];
  map.eachLayer(function (layer) {
    if (layer instanceof L.TileLayer) {
      layers.push(layer);
      var lm = layer.options.maxZoom != null ? layer.options.maxZoom : 18;
      if (lm < maxZoom) maxZoom = lm;
    }
  });
  if (!layers.length) return;

  // zHi: integer tile zoom. If caller specified targetZoom, round
  // it and clamp to [0, maxZoom]; else match Leaflet's screen-tile
  // zoom (Math.round of the fractional view zoom — the same rule
  // OSM/Leaflet use to pick the integer zoom for tile loading).
  var zHi;
  if (targetZoom != null && isFinite(targetZoom)) {
    zHi = Math.min(maxZoom, Math.max(0, Math.round(targetZoom)));
  } else {
    zHi = Math.min(maxZoom, Math.round(currentZoom));
  }
  // Output dimensions: on-screen geographic area at zHi native
  // pixel density. scale = 2^(zHi - currentZoom). At zHi ==
  // round(currentZoom) the scale is ~1 (just compensates for the
  // fractional-zoom rounding); +1 zoom doubles each side.
  var scale = Math.pow(2, zHi - currentZoom);
  var outW = Math.round(screenW * scale);
  var outH = Math.round(screenH * scale);

  // Cap the canvas dimensions per EXPORT_MAX_CANVAS_DIM. If zHi
  // would breach the cap, drop it by enough integer steps to fit.
  var MAX_CANVAS_DIM = window.EXPORT_MAX_CANVAS_DIM || 8192;
  if (outW > MAX_CANVAS_DIM || outH > MAX_CANVAS_DIM) {
    var maxScale = MAX_CANVAS_DIM / Math.max(screenW, screenH);
    var newZHi = Math.floor(currentZoom + Math.log2(maxScale));
    console.warn('exportMapAsPng: requested zoom ' + zHi + ' would produce a ' +
      outW + '×' + outH + ' canvas (limit ' + MAX_CANVAS_DIM + ' px); capping to zoom ' + newZHi + '.');
    zHi = newZHi;
    scale = Math.pow(2, zHi - currentZoom);
    outW = Math.round(screenW * scale);
    outH = Math.round(screenH * scale);
  }

  var out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  var ctx = out.getContext('2d');

  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(outW / 2, outH / 2, Math.min(outW, outH) / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
  } else if (shape === 'square') {
    // Scale the 10 px on-screen corner radius so the masked corners
    // look proportionally identical at the higher output resolution.
    var r = 10 * scale;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(outW - r, 0);
    ctx.quadraticCurveTo(outW, 0, outW, r);
    ctx.lineTo(outW, outH - r);
    ctx.quadraticCurveTo(outW, outH, outW - r, outH);
    ctx.lineTo(r, outH);
    ctx.quadraticCurveTo(0, outH, 0, outH - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.clip();
  }

  // Project the visible center to world-pixel space at zHi, then
  // derive the output canvas's top-left in world pixels. All tiles
  // share the same fractional shift, so rounding each tile's
  // destination once keeps adjacent tiles aligned at integer edges.
  var centerPx = map.project(center, zHi);
  var topLeftX = centerPx.x - outW / 2;
  var topLeftY = centerPx.y - outH / 2;

  var x0 = Math.floor(topLeftX / TILE_SIZE);
  var y0 = Math.floor(topLeftY / TILE_SIZE);
  var x1 = Math.floor((topLeftX + outW - 1) / TILE_SIZE);
  var y1 = Math.floor((topLeftY + outH - 1) / TILE_SIZE);

  // Manual URL builder — Leaflet's layer.getTileUrl(coords) ignores
  // coords.z and substitutes layer._getZoomForUrl() (= the current
  // _tileZoom). That breaks when our zHi differs from the layer's
  // current tile zoom (e.g. fractional zoom 5.006 → _tileZoom=5 but
  // zHi=6). Build URLs ourselves to guarantee z=zHi.
  function buildTileUrl(layer, x, y, z) {
    var tpl = layer._url;
    var subs = layer.options.subdomains || 'abc';
    if (typeof subs === 'string') subs = subs.split('');
    var sIdx = ((x + y) % subs.length + subs.length) % subs.length;
    return tpl
      .replace('{s}', subs[sIdx])
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y)
      .replace('{r}', '');
  }

  // Failure tally — coalesced into one warning at the end so a few
  // 429s from OSM at high zoom don't spam the console with hundreds
  // of identical messages.
  var failureCount = 0;

  // Resolve a tile to a drawable image, preferring Leaflet's DOM
  // cache. Returns null on failure (caller leaves transparent).
  //
  // For freshly-fetched tiles we go fetch + createImageBitmap rather
  // than `new Image()`. ImageBitmap supports .close() for explicit
  // pixel-data release; HTMLImageElement leaves its decoded data in
  // the browser's internal image cache, which accumulates over
  // repeated high-zoom exports and is the most common cause of "each
  // export renders less than the last."
  function getTileImage(layer, tx, ty, z) {
    var key = tx + ':' + ty + ':' + z;
    var cached = layer._tiles && layer._tiles[key];
    if (cached && cached.loaded && cached.el && cached.el.complete) {
      var co = cached.el.crossOrigin;
      if (co === '' || co === 'anonymous') {
        return Promise.resolve(cached.el);
      }
    }
    return fetch(buildTileUrl(layer, tx, ty, z), { mode: 'cors' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      })
      .then(function (b) { return createImageBitmap(b); })
      .catch(function () {
        failureCount++;
        return null;
      });
  }

  // Concurrency-limited task runner. OSM's tile policy is behaviour-
  // based (no published rate, but pre-emptive bulk fetching is
  // prohibited and the server will throttle / block repeated bursts).
  // 2 in flight keeps us conservatively inside "user actively
  // viewing tiles" territory — exports are slower but far less
  // likely to trigger the anti-abuse limiter.
  function makeLimiter(max) {
    var queue = [];
    var active = 0;
    function pump() {
      while (active < max && queue.length) {
        active++;
        var task = queue.shift();
        task().then(function () { active--; pump(); }, function () { active--; pump(); });
      }
    }
    return function (taskFn) {
      return new Promise(function (resolve, reject) {
        queue.push(function () { return taskFn().then(resolve, reject); });
        pump();
      });
    };
  }
  var fetchSlot = makeLimiter(2);

  var totalTiles = layers.length * (x1 - x0 + 1) * (y1 - y0 + 1);
  var doneTiles = 0;
  if (onProgress) onProgress(0, totalTiles);

  // Process layers serially in z-order; tiles within a layer go
  // through the shared limiter. The railways overlay (added after
  // the OSM base) lands on top because we process layers in addition
  // order.
  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    var fetches = [];
    for (var tx = x0; tx <= x1; tx++) {
      for (var ty = y0; ty <= y1; ty++) {
        (function (tx, ty, layer) {
          fetches.push(fetchSlot(function () {
            return getTileImage(layer, tx, ty, zHi).then(function (img) {
              if (img) {
                try {
                  ctx.drawImage(
                    img,
                    Math.round(tx * TILE_SIZE - topLeftX),
                    Math.round(ty * TILE_SIZE - topLeftY),
                    TILE_SIZE,
                    TILE_SIZE
                  );
                } catch (e) {
                  console.error('exportMapAsPng: drawImage failed', tx, ty, e);
                }
                // ImageBitmaps (our fresh fetches) expose .close() for
                // explicit decoded-pixel release; HTMLImageElement
                // (the DOM-cached tiles owned by Leaflet) does not —
                // leave those alone since they're still on screen.
                if (img.close) img.close();
              }
              doneTiles++;
              if (onProgress) onProgress(doneTiles, totalTiles);
            });
          }));
        })(tx, ty, layer);
      }
    }
    await Promise.all(fetches);
  }

  if (failureCount > 0) {
    console.warn('exportMapAsPng: ' + failureCount + ' of ' + totalTiles +
      ' tile fetch(es) failed (likely rate-limit at high zoom). Affected regions left transparent.');
  }

  return new Promise(function (resolve) {
    out.toBlob(function (blob) {
      if (!blob) {
        console.error('exportMapAsPng: toBlob returned null (canvas tainted? check tile crossOrigin)');
        resolve();
        return;
      }
      // Release the canvas pixel buffer immediately. For a 16384²
      // canvas that's ~1 GB of RAM that would otherwise linger until
      // GC eventually decided to run — accumulating across repeated
      // exports and causing later exports to render only partially
      // before hitting memory limits.
      out.width = 0;
      out.height = 0;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename || 'map.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); resolve(); }, 1000);
    }, 'image/png');
  });
};
