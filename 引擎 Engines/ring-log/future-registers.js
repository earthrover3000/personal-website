// ring-log/future-registers — how a band says "this time is not settled".
// The SSOT shared by BOTH surfaces that draw the personal-website phase band:
//   • the lifespan-atlas app — src/lib/futureRegisters.ts re-exports these via
//     the `ring-log/future-registers` alias (vite.config.ts resolve.alias +
//     the tsconfig.app.json path) and keeps the doctrine that names the three
//     registers and says when each applies;
//   • the site's Site Log rings page-widget (界面 UI/page-widgets/
//     site-log-rings.js), which dynamic-imports this file by relative path.
// A sibling of rings.js on the phase-color.js argument: rings.js is
// contractually geometry-only, and this is colour.
//
// WHY IT MOVED HERE (2026-09-05). The site widget claimed to replicate the
// app's website-shading recipe EXACTLY, and had stopped: when the app moved
// its forward fade from an alpha ramp to a colour dissolve (2026-09-02), the
// widget kept ramping alpha. Nothing looked broken on the site — with only a
// grey base underneath, alpha-to-zero happens to land on the same colour it
// should dissolve into — but the two were saying different things by then,
// and the app's own history says a copied fade shape is exactly how these
// drift (see the app module's note on the location tail and the project tail).
//
// ALPHA IS NOT A REGISTER — the doctrine in full lives in the app module, and
// it is the reason these return COLOURS and take no opacity: a register is
// expressed by HUE. A surface still applies its own band opacity on top; what
// it must not do is use opacity to mean "less settled".

/** Parse "#rgb" or "#rrggbb" into [r, g, b] (0–255). EXPORTED for the sibling
 *  segment-stack module, so the engine folder has ONE hex parser rather than a
 *  second copy alongside the first. */
export function parseHex(h) {
  const s = String(h).replace("#", "");
  const f = s.length === 3 ? s.split("").map((c) => c + c).join("") : s.slice(0, 6);
  return [
    parseInt(f.slice(0, 2), 16),
    parseInt(f.slice(2, 4), 16),
    parseInt(f.slice(4, 6), 16),
  ];
}

/** Blend two hex colours in sRGB: t=0 → a, t=1 → b. Good enough for UI tints
 *  (not perceptual). Returns a 6-digit "#rrggbb". Moved here from the app's
 *  theme/display.ts, which now re-exports it, so the dissolve arithmetic is
 *  the same arithmetic on both surfaces.
 *
 *  BOTH ARGUMENTS MUST BE REAL HEX. A CSS `var(...)` string parses to NaN and
 *  yields "#NaNNaNNaN" silently — which is why the future grey is threaded to
 *  callers as a resolved value rather than left as a variable. */
export function mixHex(a, b, t) {
  const pa = parseHex(a), pb = parseHex(b);
  const to = (i) =>
    Math.max(0, Math.min(255, Math.round(pa[i] + (pb[i] - pa[i]) * t)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(0)}${to(1)}${to(2)}`;
}

/** ② PROJECTION GROUND — the ground past a claim's end. Flat, hard-edged, no
 *  fade. Trivial by design: it exists as a named function so a surface says
 *  WHICH register it is painting, and so ② and ③ demonstrably end and begin
 *  in the same colour. */
export function projectionGround(futureGrey) {
  return futureGrey;
}

/** ③ DISSOLVE — one step of a band whose confidence is running out: its own
 *  colour carried `t` of the way to `futureGrey`, at full opacity. t = 0 is
 *  the band's colour, t = 1 the bare future. Callers discretise, since every
 *  consumer paints flat fills.
 *
 *  ③ HAS TO HAND OVER TO ②. A dissolve is half a statement — something must
 *  go on painting that grey where the ramp stops, or the band steps back to
 *  whatever lies under it. That step is what the app shipped for three years
 *  and what the site would have inherited. */
export function dissolveToFuture(color, futureGrey, t) {
  return mixHex(color, futureGrey, Math.max(0, Math.min(1, t)));
}
