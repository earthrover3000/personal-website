// Type declarations for the shared phase-colour module (phase-color.js) —
// the deterministic personal-website version/phase colour, SSOT for the
// lifespan-atlas app (imported as `ring-log/phase-color`; theme/display.ts
// re-exports it) and the site's site-log-rings page-widget.

/** Fixed ramp length: minors .1 … .PHASE_RAMP get distinct hue slots;
 *  "+" / overflow clamps to the last slot. */
export declare const PHASE_RAMP: number;
/** Hue band per major parity, [first-slot hue, last-slot hue] in HSL degrees. */
export declare const PHASE_HUE_BANDS: [number, number][];
/** Deterministic hex colour for a personal-website version band, keyed on
 *  the stage identity (major.minor). */
export declare function phaseColor(major: number, minor: number | "+"): string;
