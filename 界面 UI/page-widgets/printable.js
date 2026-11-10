// printable.js — an EXPORT TAB every interface app shares (user decision
// 2026-11-08: "make sure SSOT with other interface apps"): a page opened
// in a tab of its own, laid out to read on paper, for the browser's
// Print / Save as PDF. Lifted out of 临终规划 Death Plan's export.js,
// which now draws through this; 生活自理 Life Skills' export does too.
//
// ITS DISPLAY MODE IS THE APP'S (user decisions 2026-11-03): the site's
// light / dark choice as the opening page has it (theme-init.js's <html
// data-theme>), or, on auto, the system's. Paper is always light.

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LIGHT = `--bg: #fff; --text: #111; --muted: #555; --faint: #aaa;
    --quiet: #777; --warn: #b00;`;
const DARK = `--bg: #17191d; --text: #e4e4e4; --muted: #a0a4aa;
    --faint: #5c6066; --quiet: #8a8e94; --warn: #ff6b6b;`;

/** The paper: its colours, type, headings, lists and print rules. An app
 *  adds only what is its own (`writePrintable`'s `style`). */
export const PAPER_STYLE = `
  :root { ${LIGHT} color-scheme: light; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme=light]) { ${DARK} color-scheme: dark; } }
  :root[data-theme=dark] { ${DARK} color-scheme: dark; }
  @media print { :root, :root[data-theme] { ${LIGHT} color-scheme: light; } }
  body { font: 11pt/1.5 Georgia, 'Noto Serif', serif; color: var(--text);
         background: var(--bg);
         max-width: 44rem; margin: 2rem auto; padding: 0 1.2rem; }
  h1 { font: 600 1.6rem system-ui, sans-serif; margin: 0 0 0.6rem;
       border-bottom: 2px solid var(--text); padding-bottom: 0.2rem; }
  h2 { font: 600 1.25rem system-ui, sans-serif; margin: 1.6rem 0 0.4rem; }
  h3 { font: 600 1.05rem system-ui, sans-serif; margin: 1.1rem 0 0.3rem; }
  h4 { font: 600 0.95rem system-ui, sans-serif; margin: 0.8rem 0 0.2rem; }
  ol, ul { margin: 0.2rem 0 0.6rem; padding-left: 1.6rem; }
  ul.ticks { list-style: none; padding-left: 0.4rem; }
  li { margin: 0.25rem 0; break-inside: avoid; }
  .text { white-space: pre-wrap; margin: 0.15rem 0 0.3rem; }
  .fact { font-size: 0.92em; }
  .k { color: var(--muted); }
  .none { color: var(--quiet); font-style: italic; }
  .cover { border: 2px solid var(--text); border-radius: 6px;
           padding: 0.6rem 1rem;
           margin-bottom: 2rem; font-family: system-ui, sans-serif; }
  .part + .part { margin-top: 2.5rem; }
  @media print {
    body { margin: 0; max-width: none; }
    .print-hint { display: none; }
    .part + .part { break-before: page; }
    h2, h3, h4 { break-after: avoid; }
  }`;

/** The line every export's cover ends with. */
export const PRINT_HINT = '<p class="print-hint">To keep a copy: Print '
  + '(Ctrl+P), then Save as PDF.</p>';

/** Open the export tab NOW, inside the click, or the browser blocks it
 *  as a pop-up; `waiting` shows while the export is drawn. */
export function openTab(title, waiting = 'Preparing…') {
  const w = window.open('', '_blank');
  if (!w) throw new Error('The browser blocked the export tab — allow '
                          + 'pop-ups for this page and try again.');
  w.document.title = title;
  w.document.body.textContent = waiting;
  return w;
}

/** Write the whole printable page into `w`: `cover` and `body` are HTML,
 *  `mark` is printed at the foot of every sheet, `style` is the app's
 *  own rules on top of PAPER_STYLE. */
export function writePrintable(w, { title, cover, body, mark = '',
                                    style = '' }) {
  const theme = document.documentElement.getAttribute('data-theme');
  const themed = theme === 'dark' || theme === 'light'
    ? ' data-theme="' + theme + '"' : '';
  const foot = mark ? `@page { @bottom-center { content: "${
    esc(mark).replace(/"/g, '')}"; font: 8pt system-ui, sans-serif;
    color: #888; } }` : '';
  w.document.open();
  w.document.write(`<!DOCTYPE html><html lang="en"${themed}><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${PAPER_STYLE}${style}
${foot}</style></head><body>
<header class="cover">${cover}</header>${body}</body></html>`);
  w.document.close();
}
