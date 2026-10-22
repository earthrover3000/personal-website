/* relative-time — <time class="relative-time" datetime="…"> as
   "N minutes ago" (and `relative-time-coarse` as "3 days ago" /
   "in 2yr 1mo"). ONE copy for every page (2026-10-19, lifted out of
   the index engine's footer when the Noticeboard's "checked …" needed
   it): index_page inlines it via read_relative_time_js().
   window.relativeTime.render(root)  re-render every <time> under root
   window.relativeTime.text(iso)     the same words as a string
   THE WORDS ARE `agoText`, 引擎 Engines/time-ago/time-ago.js (user
   decision 2026-10-20: one spelling of "… ago" everywhere) — inlined
   IN FRONT of this file by read_relative_time_js, so this file is never
   served on its own. Fallback (no JS) is whatever text the element
   already holds.
   `relative-time-units` (2026-10-22, the 💬 Sessions widget): the age
   as time-ago's SHORT form (`durationUnits`, 3m45s), one child per unit
   — <span data-u="d|h|m|s"> — so a page can give each unit a column. */
(function() {
  // Convert <time class="relative-time" datetime="..."> to "X ago" form.
  // Fallback (no JS) is the absolute YYYY-MM-DD already in the element body.
  const fmt = agoText;            // 引擎 Engines/time-ago, inlined above
  const fmtCoarse = (dt) => {
    const now = new Date();
    const e = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    const r = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const diffDays = Math.round((e - r) / 86400000);
    if (diffDays === 0) return 'today';
    if (diffDays === -1) return 'yesterday';
    const future = diffDays > 0;
    const absDays = Math.abs(diffDays);
    if (absDays < 60) {
      const body = `${absDays} day${absDays === 1 ? '' : 's'}`;
      return future ? `in ${body}` : `${body} ago`;
    }
    const earlier = future ? new Date(r) : dt;
    const later = future ? dt : new Date(r);
    let years = later.getUTCFullYear() - earlier.getUTCFullYear();
    let months = later.getUTCMonth() - earlier.getUTCMonth();
    if (later.getUTCDate() < earlier.getUTCDate()) months -= 1;
    if (months < 0) { years -= 1; months += 12; }
    const body = years === 0 ? `${months}mo` : `${years}yr ${months}mo`;
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
        const parts = durationUnits((Date.now() - dt.getTime()) / 1000);
        t.querySelectorAll('[data-u]').forEach((u) => {
          u.textContent = parts[u.dataset.u] || '';
        });
      } else if (t.classList.contains('relative-time-coarse')) {
        t.textContent = fmtCoarse(dt);
      } else {
        const seconds = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
        t.textContent = fmt(seconds);
      }
    });
  };
  window.relativeTime = { text, render };
  render(document);
})();
