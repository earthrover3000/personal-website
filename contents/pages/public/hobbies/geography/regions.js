// Region reference data for the Geography (Maps & Projections) page's
// Region Map Explorer.
//
// Loaded as a sibling file (deployed alongside index.html via the
// project config's extra_files: ['regions.js']). Exposes one global —
// window.GEOGRAPHY_DATA — with the list of geographic regions the
// widget renders.
//
// Each region carries its own defaultRadiusKm so the widget can pick a
// sensible scale per location when the user switches between them.
//
// Symmetric in structure to urbanism/cities.js — currently only two
// entries, but extracted so the pattern matches across both
// map-explorer pages and so adding new regions is a one-place edit.

(function () {
  window.GEOGRAPHY_DATA = {
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
})();
