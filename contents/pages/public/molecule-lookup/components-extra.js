// ── Molecule Lookup: recognised components ─────────────────────────────
// Split out of index.html so the vendored table and our additions are each
// a file you can diff against its source (user decision 2026-08-17).
//
// Loaded as a sibling <script>, NOT fetched. The page's Offline mode means
// "ask no third-party service", and a same-origin script that ships with the
// page is available exactly whenever the page is — so nothing about offline
// operation changes by moving these out.

// OURS, kept deliberately separate so components-chembl.js stays
// byte-for-byte re-fetchable from ChEMBL. Twelve of Berge's FDA-approved
// counterions are missing from that file; almost all are obsolete
// (hydrabamine, glycollylarsanilate, triethiodide, subacetate...), so the bar
// for adding one here is: a CURRENTLY MARKETED drug fails to resolve without
// it. Two qualify.
//
// Bitartrate looked like a third and is deliberately ABSENT: hydrocodone
// bitartrate's record fragments to tartaric acid plus water, never to a
// distinct bitartrate species, and Tartrate in the vendored file already
// covers that. A name missing from the list is not the same as a gap in it.

var VOCAB_EXTRA = [
  // methenamine hippurate (Hiprex). Its sibling methenamine mandelate renders
  // correctly only because ChEMBL happens to carry Mandelic acid; without this
  // row two chemically identical products disagree.
  ["Hippurate", "counterion", "OC(=O)CNC(=O)c1ccccc1"],
  // dimenhydrinate = diphenhydramine + this. SMILES taken verbatim from the
  // PubChem record's own fragment rather than retyped, so the tautomer that
  // reaches the index is the tautomer that arrives in real lookups.
  ["Teoclate", "counterion", "CN1C2=C(C(=O)N(C1=O)C)NC(=N2)Cl"],
];
