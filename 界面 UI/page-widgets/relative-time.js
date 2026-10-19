/* relative-time — <time class="relative-time" datetime="…"> as
   "N minutes ago" (and `relative-time-coarse` as "3 days ago" /
   "in 2yr 1mo"). ONE copy for every page (2026-10-19, lifted out of
   the index engine's footer when the Noticeboard's "checked …" needed
   it): index_page inlines it via read_relative_time_js().

   window.relativeTime.render(root)  re-render every <time> under root
   window.relativeTime.text(iso)     the same words as a string
   Fallback (no JS) is whatever text the element already holds. */
(function() {
  // Convert <time class="relative-time" datetime="..."> to "X ago" form.
  // Fallback (no JS) is the absolute YYYY-MM-DD already in the element body.
  const ago = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  const fmt = (s) => {
    if (s < 5) return 'just now';
    if (s < 60) return `${s} seconds ago`;
    if (s < 3600) return ago(Math.floor(s / 60), 'minute');
    if (s < 86400) return ago(Math.floor(s / 3600), 'hour');
    if (s < 1209600) return ago(Math.floor(s / 86400), 'day');
    if (s < 5443200) return ago(Math.floor(s / 604800), 'week');
    if (s < 31557600) return ago(Math.floor(s / 2629800), 'month');
    return ago(Math.floor(s / 31557600), 'year');
  };
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
      if (t.classList.contains('relative-time-coarse')) {
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
