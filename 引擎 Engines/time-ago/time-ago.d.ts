/** `seconds` elapsed as words: "just now", "1 second ago", "42 seconds ago", "3 minutes
 *  ago" … "2 years ago" (time-ago.js). */
export function agoText(seconds: number): string;
/** `seconds` elapsed as at most two units, one per field: 45s · 3m45s ·
 *  2h05m · 1d03h, each field "" when absent (time-ago.js). */
export function durationUnits(
  seconds: number,
): { d: string; h: string; m: string; s: string };
