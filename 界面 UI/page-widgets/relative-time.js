/* relative-time — <time class="relative-time" datetime="…"> as
   "3 minutes ago" — time-ago's FULL ago — and `relative-time-coarse`
   in the CALENDAR style, "3 days ago" / "in 2 years 1 month". ONE copy for every page (2026-10-19, lifted out of
   the index engine's footer when the Noticeboard's "checked …" needed
   it): index_page inlines it via read_relative_time_js().
   window.relativeTime.render(root)  re-render every <time> under root
                                     (`relative-time-until`: a countdown,
                                     COMPACT until "in 1h 20m")
   window.relativeTime.text(iso)     the same words as a string
   window.relativeTime.units(sec)    a duration as {d,h,m,s} strings,
                                     the cells `relative-time-units` fills
                                     (COMPACT to the second: 2h 0m 7s)
   window.relativeTime.span(sec)     "2 h 5 min"     (time-ago's spanText)
   window.relativeTime.until(sec)    "in 1 h 20 min" (untilText)
   window.relativeTime.unit(sec)     "5 h"           (unitText)
   window.relativeTime.full(sec)     "4 days 2 hours" (fullSpanText)
   window.relativeTime.ago(sec)      "3 min ago"     (agoText)
   window.relativeTime.fullUnit(sec) "3 days"        (fullUnitText)
   window.relativeTime.fullUntil(sec) "in 1 hour 20 minutes" (fullUntilText)
   window.relativeTime.compactUntil(sec) "in 1h 20m"  (compactUntilText)
   window.relativeTime.fullAgo(sec)  "5 minutes ago" (fullAgoText)
   window.relativeTime.calendar(iso, daysUpTo=70)  CALENDAR's distance to a
                                     date: {days, future, body}, body
                                     "18 days" / "3 months" — the caller
                                     words the direction
   The <time> words are the FULL ago (fullAgoText), as they always were.
   THE WORDS ARE `agoText`, 引擎 Engines/time-ago/time-ago.js (user
   decision 2026-10-20: one spelling of "… ago" everywhere) — inlined
   IN FRONT of this file by read_relative_time_js, so this file is never
   served on its own. Fallback (no JS) is whatever text the element
   already holds.
   `relative-time-units` (2026-10-22, the Sessions widget): the age
   as time-ago's COMPACT parts to the second (`compactUnits(s, 's')`:
   45s · 3m 7s · 2h 0m 7s · 1d 0h 5m 0s, every unit down to the second,
   zeros kept — user decisions 2026-11-18), one child per unit
   — <span data-u="d|h|m|s"> — so a page can give each unit a column. */
(function() {
  // Convert <time class="relative-time" datetime="..."> to "X ago" form.
  // Fallback (no JS) is the absolute YYYY-MM-DD already in the element body.
  const fmt = fullAgoText;        // 引擎 Engines/time-ago, inlined above
  // CALENDAR's distance between two UTC midnights, `e` (the thing) and `r`
  // (today): {days, future, body} — body in full words, whole DAYS below
  // `daysUpTo` — 70, the workshop's one threshold (user decision
  // 2026-11-18; 60 before) — calendar months and years from there.
  // `daysUpTo` Infinity counts in days for ever (Inner Healing's
  // "Days ago" switch).
  const calendarParts = (e, r, daysUpTo = 70) => {
    const days = Math.round((e - r) / 86400000);
    const future = days > 0;
    const absDays = Math.abs(days);
    const word = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    if (absDays < daysUpTo) return { days, future, body: word(absDays, 'day') };
    const earlier = new Date(future ? r : e);
    const later = new Date(future ? e : r);
    let years = later.getUTCFullYear() - earlier.getUTCFullYear();
    let months = later.getUTCMonth() - earlier.getUTCMonth();
    if (later.getUTCDate() < earlier.getUTCDate()) months -= 1;
    if (months < 0) { years -= 1; months += 12; }
    // CALENDAR, in full words (user decision 2026-11-17).
    const body = years === 0 ? word(months, 'month')
      : months ? `${word(years, 'year')} ${word(months, 'month')}`
      : word(years, 'year');
    return { days, future, body };
  };
  // A 'YYYY-MM-DD' date against THIS device's today, through
  // calendarParts — for a page that words the direction itself ("in 18
  // days", "3 days overdue").
  const calendar = (iso, daysUpTo = 70) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const now = new Date();
    return calendarParts(Date.UTC(y, m - 1, d),
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()), daysUpTo);
  };
  const fmtCoarse = (dt) => {
    const now = new Date();
    const e = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    const r = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const { days, future, body } = calendarParts(e, r);
    if (days === 0) return 'today';
    if (days === -1) return 'yesterday';
    return future ? `in ${body}` : `${body} ago`;
  };
  const text = (iso) => {
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return '';
    return fmt(Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000)));
  };
  const render = (root) => {
    (root || document).querySelectorAll('time.relative-time').forEach(t => {
      const dt = new Date(t.getAttribute('datetime'));
      if (isNaN(dt.getTime())) return;
      if (t.classList.contains('relative-time-units')) {
        const parts = compactUnits((Date.now() - dt.getTime()) / 1000, 's');
        t.querySelectorAll('[data-u]').forEach((u) => {
          u.textContent = parts[u.dataset.u] || '';
        });
      } else if (t.classList.contains('relative-time-until')) {
        // A countdown: COMPACT until, "in 1h 20m", "now" once it has
        // come (user decision 2026-11-18; the reminder card's lock).
        t.textContent = compactUntilText((dt.getTime() - Date.now()) / 1000);
      } else if (t.classList.contains('relative-time-coarse')) {
        t.textContent = fmtCoarse(dt);
      } else {
        const seconds = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
        t.textContent = fmt(seconds);
      }
    });
  };
  // A fixed duration in the same unit cells (the Sessions card's
  // finished-turn length, 2026-10-22).
  const units = (seconds) => compactUnits(Math.max(0, seconds), 's');
  window.relativeTime = { text, render, units, span: spanText,
                          until: untilText, unit: unitText,
                          full: fullSpanText, ago: agoText,
                          fullUnit: fullUnitText,
                          fullUntil: fullUntilText,
                          compactUntil: compactUntilText,
                          fullAgo: fullAgoText, calendar };
  render(document);
})();
