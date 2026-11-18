/** `seconds` elapsed: "just now", "42 s ago", "3 min ago" … "2 yr ago"
 *  (time-ago.js). */
export function agoText(seconds: number): string;
/** `seconds` as at most two units, one per field: "3 min", "45 s" …, each
 *  field "" when absent (time-ago.js). */
export function durationUnits(
  seconds: number,
): { d: string; h: string; m: string; s: string };
/** `seconds` as a span: "45 s", "2 h 5 min", "1 d 3 h" (time-ago.js). */
export function spanText(seconds: number): string;
/** `seconds` until something, to the minute: "in 1 h 20 min", or "now". */
export function untilText(seconds: number): string;
/** `seconds` in its one whole unit: "15 min", "5 h" (time-ago.js). */
export function unitText(seconds: number): string;
/** `seconds` as a span in words: "1 hour 5 minutes" (time-ago.js). */
export function fullSpanText(seconds: number): string;
/** `seconds` elapsed, in words: "3 minutes ago" (time-ago.js). */
export function fullAgoText(seconds: number): string;
/** `seconds` in its one whole unit, in words: "5 hours" (time-ago.js). */
export function fullUnitText(seconds: number): string;
/** Full until: "in 1 hour 20 minutes", or "now" (time-ago.js). */
export function fullUntilText(seconds: number): string;
/** Compact span down to `floor` ("h" by default): "6d 17h", "6d 0h",
 *  "17h"; "2h 0m 7s" with "s" (time-ago.js). */
export function compactSpanText(
  seconds: number, floor?: "d" | "h" | "m" | "s"): string;
/** Compact unit: one whole unit, hours up to 48 h — "15m", "30h", "3d"
 *  (time-ago.js). */
export function compactUnitText(
  seconds: number, largest?: "d" | "h"): string;
/** Compact ago: "just now", "15m ago", "30h ago" (time-ago.js). */
export function compactAgoText(seconds: number): string;
/** Compact until, rounded up to `floor` ("m" by default): "in 1h 20m",
 *  or "now" (time-ago.js). */
export function compactUntilText(
  seconds: number, floor?: "d" | "h" | "m" | "s"): string;
/** Compact parts down to `floor`, one per field, "" when absent: "2h",
 *  "0m", "7s" (time-ago.js). */
export function compactUnits(
  seconds: number, floor?: "d" | "h" | "m" | "s",
): { d: string; h: string; m: string; s: string };
