// City reference data for the Urbanism page's City Map Explorer.
//
// Loaded as a sibling file (deployed alongside index.html via the
// project config's extra_files: ['cities.js']). Exposes one global —
// window.URBANISM_DATA — with the two location lists the page swaps
// between via its "Include cities I've lived in" toggle.
//
// All coords are the lat/lon of each city's OSM place=city node,
// fetched via Overpass with Wikidata QIDs unioned into one request:
//   [out:json];(node["wikidata"="<Q>"]["place"~"city|town"]; ...);out;
// Inline `// node N — Tier` comments record the OSM node ID (so each
// row is verifiable at openstreetmap.org/node/<N>) and the GaWC tier.

(function () {
  // Single source of truth for each city's coordinates + display label.
  // Lists below reference cities by slug — adding a city is one entry
  // here plus its slug in whichever list shapes need it.
  var CITIES = {
    dublin:        { lat: 53.3493795, lon:  -6.2605593, label: 'Dublin' },         // node 3473474851
    cambridge:     { lat: 52.2055314, lon:   0.1186637, label: 'Cambridge' },      // node 20971094
    london:        { lat: 51.5074456, lon:  -0.1277653, label: 'London' },         // node 107775
    shanghai:      { lat: 31.2323437, lon: 121.4691024, label: 'Shanghai' },       // node 778910398
    'new-york':    { lat: 40.7127281, lon: -74.0060152, label: 'New York' },       // node 61785451 — Alpha++
    'hong-kong':   { lat: 22.2792968, lon: 114.1628907, label: 'Hong Kong' },      // node 24330691 — Alpha+
    beijing:       { lat: 39.9057136, lon: 116.3912972, label: 'Beijing' },        // node 25248662 — Alpha+
    singapore:     { lat:  1.2899175, lon: 103.8519072, label: 'Singapore' },      // node 531668011 — Alpha+
    paris:         { lat: 48.8534951, lon:   2.3483915, label: 'Paris' },          // node 17807753 — Alpha+
    dubai:         { lat: 25.2296341, lon:  55.2895850, label: 'Dubai' },          // node 13258099521 — Alpha+
    tokyo:         { lat: 35.6768601, lon: 139.7638947, label: 'Tokyo' },          // node 265018692 — Alpha+
    sydney:        { lat: -33.8698439, lon: 151.2082848, label: 'Sydney' },        // node 13766899 — Alpha+
    seoul:         { lat: 37.5666791, lon: 126.9782914, label: 'Seoul' },          // node 1912365631 — Alpha
    milan:         { lat: 45.4641943, lon:   9.1896346, label: 'Milan' },          // node 62505581 — Alpha
    toronto:       { lat: 43.6534817, lon: -79.3839347, label: 'Toronto' },        // node 18063533 — Alpha
    frankfurt:     { lat: 50.1106444, lon:   8.6820917, label: 'Frankfurt' },      // node 27418664 — Alpha
    chicago:       { lat: 41.8755616, lon: -87.6244212, label: 'Chicago' },        // node 153388690 — Alpha
    jakarta:       { lat: -6.1754049, lon: 106.8271680, label: 'Jakarta' },        // node 29939632 — Alpha
    'sao-paulo':   { lat: -23.5506507, lon: -46.6333824, label: 'São Paulo' },     // node 30674098 — Alpha
    'mexico-city': { lat: 19.4326296, lon: -99.1331785, label: 'Mexico City' },    // node 62270270 — Alpha
    mumbai:        { lat: 19.0549990, lon:  72.8692035, label: 'Mumbai' },         // node 16173235 — Alpha
    madrid:        { lat: 40.4167820, lon:  -3.7035070, label: 'Madrid' },         // node 21068295 — Alpha
    warsaw:        { lat: 52.2319581, lon:  21.0067249, label: 'Warsaw' },         // node 428339515 — Alpha
    guangzhou:     { lat: 23.1288454, lon: 113.2590064, label: 'Guangzhou' },      // node 244080443 — Alpha
    istanbul:      { lat: 41.0063810, lon:  28.9758715, label: 'Istanbul' },       // node 1882099475 — Alpha
    amsterdam:     { lat: 52.3730796, lon:   4.8924534, label: 'Amsterdam' },      // node 268396336 — Alpha
    bangkok:       { lat: 13.7524938, lon: 100.4935089, label: 'Bangkok' },        // node 1628207792 — Alpha
    'los-angeles': { lat: 34.0536909, lon: -118.2427660, label: 'Los Angeles' },   // node 1738808199 — Alpha
    'kuala-lumpur':{ lat:  3.1516964, lon: 101.6942371, label: 'Kuala Lumpur' },   // node 1889910974 — Alpha
    // Alpha- — display labels use English where the OSM name is in
    // another script (München → Munich, 臺北市 → Taipei, الرياض → Riyadh,
    // etc.) for consistency with the rest of the dropdown.
    luxembourg:    { lat: 49.6112768, lon:   6.1297990, label: 'Luxembourg' },     // node 52943358 — Alpha-
    taipei:        { lat: 25.0375198, lon: 121.5636796, label: 'Taipei' },         // node 1147314253 — Alpha-
    shenzhen:      { lat: 22.5445741, lon: 114.0545429, label: 'Shenzhen' },       // node 3510661780 — Alpha-
    brussels:      { lat: 50.8467372, lon:   4.3524930, label: 'Brussels' },       // node 1635651356 — Alpha-
    zurich:        { lat: 47.3744489, lon:   8.5410422, label: 'Zurich' },         // node 240025182 — Alpha-
    'buenos-aires':{ lat: -34.6095579, lon: -58.3887904, label: 'Buenos Aires' },  // node 81590481 — Alpha-
    melbourne:     { lat: -37.8142454, lon: 144.9631732, label: 'Melbourne' },     // node 21579127 — Alpha-
    'san-francisco':{ lat: 37.7879363, lon: -122.4075201, label: 'San Francisco' },// node 26819236 — Alpha-
    riyadh:        { lat: 24.6389160, lon:  46.7160104, label: 'Riyadh' },         // node 315358390 — Alpha-
    santiago:      { lat: -33.4376995, lon: -70.6510671, label: 'Santiago' },      // node 50016356 — Alpha-
    dusseldorf:    { lat: 51.2254018, lon:   6.7763137, label: 'Düsseldorf' },     // node 240126753 — Alpha-
    stockholm:     { lat: 59.3251172, lon:  18.0710935, label: 'Stockholm' },      // node 25929985 — Alpha-
    'washington-dc':{ lat: 38.8950982, lon: -77.0363849, label: 'Washington DC' }, // node 158368533 — Alpha-
    vienna:        { lat: 48.2083537, lon:  16.3725042, label: 'Vienna' },         // node 17328659 — Alpha-
    lisbon:        { lat: 38.7077507, lon:  -9.1365919, label: 'Lisbon' },         // node 265958490 — Alpha-
    munich:        { lat: 48.1371079, lon:  11.5753822, label: 'Munich' },         // node 1700534808 — Alpha-
    // dublin already above (Alpha-, also lived-in)
    houston:       { lat: 29.7589382, lon: -95.3676974, label: 'Houston' },        // node 27526178 — Alpha-
    berlin:        { lat: 52.5173885, lon:  13.3951309, label: 'Berlin' },         // node 240109189 — Alpha-
    johannesburg:  { lat: -26.2050000, lon: 28.0497220, label: 'Johannesburg' },   // node 261833893 — Alpha-
    boston:        { lat: 42.3588336, lon: -71.0578303, label: 'Boston' },         // node 158809705 — Alpha-
    'new-delhi':   { lat: 28.6138954, lon:  77.2090057, label: 'New Delhi' }       // node 16173236 — Alpha-
  };

  // Translate a slug list into the {value, lat, lon, label} shape the
  // map-explorer widget expects. '---' becomes a visual divider option.
  function pick(slugs) {
    return slugs.map(function (s) {
      if (s === '---') return { divider: true };
      var c = CITIES[s];
      if (!c) throw new Error('cities.js: unknown city slug "' + s + '"');
      return { value: s, lat: c.lat, lon: c.lon, label: c.label };
    });
  }

  // GaWC 2024 order, four sections (Alpha++, Alpha+, Alpha, Alpha-).
  // Source: gawc.lboro.ac.uk/gawc-worlds/the-world-according-to-gawc/
  // world-cities-2024/
  var GAWC_LIST = pick([
    'london', 'new-york',
    '---',
    'hong-kong', 'beijing', 'singapore', 'shanghai', 'paris', 'dubai', 'tokyo', 'sydney',
    '---',
    'seoul', 'milan', 'toronto', 'frankfurt', 'chicago', 'jakarta', 'sao-paulo',
    'mexico-city', 'mumbai', 'madrid', 'warsaw', 'guangzhou', 'istanbul',
    'amsterdam', 'bangkok', 'los-angeles', 'kuala-lumpur',
    '---',
    'luxembourg', 'taipei', 'shenzhen', 'brussels', 'zurich', 'buenos-aires',
    'melbourne', 'san-francisco', 'riyadh', 'santiago', 'dusseldorf', 'stockholm',
    'washington-dc', 'vienna', 'lisbon', 'munich', 'dublin', 'houston', 'berlin',
    'johannesburg', 'boston', 'new-delhi'
  ]);

  // Lived-in pre-pended; London + Shanghai removed from GaWC Alpha++/+,
  // and Dublin removed from Alpha-, so they don't appear twice (the
  // merged Alpha++/+ section reflects the original "places you've lived
  // AND want global comparison" shape of the list).
  var LIVED_LIST = pick([
    'dublin', 'cambridge', 'london', 'shanghai',
    '---',
    'new-york', 'hong-kong', 'beijing', 'singapore', 'paris', 'dubai', 'tokyo', 'sydney',
    '---',
    'seoul', 'milan', 'toronto', 'frankfurt', 'chicago', 'jakarta', 'sao-paulo',
    'mexico-city', 'mumbai', 'madrid', 'warsaw', 'guangzhou', 'istanbul',
    'amsterdam', 'bangkok', 'los-angeles', 'kuala-lumpur',
    '---',
    'luxembourg', 'taipei', 'shenzhen', 'brussels', 'zurich', 'buenos-aires',
    'melbourne', 'san-francisco', 'riyadh', 'santiago', 'dusseldorf', 'stockholm',
    'washington-dc', 'vienna', 'lisbon', 'munich', 'houston', 'berlin',
    'johannesburg', 'boston', 'new-delhi'
  ]);

  window.URBANISM_DATA = {
    gawcList: GAWC_LIST,
    livedList: LIVED_LIST
  };
})();
