// regions.js — canonical geographic-region definitions, the shared engine
// SSOT (moved from 个人网站 …/pages/maps-projections/regions.js, now a MOVED
// stub). Exposes one global: window.WORLD_REGIONS = { regions }.
//
// EVERY entry here does double duty — list a region and BOTH consumers pick
// it up, no further registration anywhere:
//   1. the Maps & Projections "Region Map Explorer" offers it (its Leaflet
//      Web-Mercator crop, plus the exact crop circle outlined on the Hǎo
//      overview via PROJ.mercatorDisc);
//   2. the flight-route popover (界面 UI/map-widgets/map-route.js) gates its
//      close-up mode on it: a flight whose endpoints BOTH fall inside one
//      region's Mercator-plane disc (PROJ.mercatorDiscContains, radius =
//      defaultRadiusKm — the same math as the drawn circle) renders that
//      region's canonical Web-Mercator crop instead of the whole-world Hǎo map.
//
// Each region carries its own defaultRadiusKm so consumers pick a sensible
// scale per location when switching between them. The entry shape
// { value, lat, lon, label, defaultRadiusKm } is consumed verbatim by
// createMapExplorer's `locations:` and createWorldMap's `regions:` / `crop:`
// options — keep it stable.

(function (root) {
  root.WORLD_REGIONS = {
    regions: [
      // Mercator-plane circumcentre of Dover, Cnoc Bólais, and Duncansby
      // Head — pixel rim passes through all three at ~499 km, 510 km
      // gives a small breathing margin.
      { value: 'british-isles', lat: 54.439107,  lon:  -4.112081,  label: 'British Isles', defaultRadiusKm: 510  },
      // Centred on Baoji 宝鸡 (OSM place=city node 244076584) — a
      // central-China anchor that frames the populated east-coast
      // corridor + western interior at 1500 km.
      { value: 'china-proper',  lat: 34.3609713, lon: 107.2322378, label: 'China Proper',  defaultRadiusKm: 1500 }
    ]
  };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
