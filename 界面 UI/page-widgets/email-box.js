// email-box.js — THE SHELF'S EMAIL MODULE (user decisions 2026-11-11:
// "every email uses the same module"; 2026-11-16: onto the shelf, its look
// in styles/email.css). First user: 疗愈轨迹 Healing Trajectory. One way to
// draw an email and copy from it, whatever the email is:
//
//   · a DRAFT from a template (the Email page's screening and referral
//     emails, filled for the recipient picked), and
//   · a SAVED email, read from an .eml file (a therapist's Emails page).
//
// An email is a plain object:
//
//   { from, to, cc?, site?, date?, subject,
//     greet,                      the first line; Copy body sits on it
//     paragraphs: [...],          text, or the tokens '[line]' (the
//                                 recipient's own line) and '[format]'
//     line?, linePlaceholder?,    what '[line]' becomes
//     formats?, format?,          what '[format]' becomes (email.yaml)
//     sign: [...] }               the sign-off, one string per line
//
// Text in [brackets] is a blank still to fill: marked in amber, and a copy
// that would carry one is held back until a second click. `picked` marks
// what the recipient filled in, so it can be told from the template.
//
// A page imports it from the shelf and links styles/email.css.

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Text with [placeholders] marked to fill, and a picked value marked.
function marked(text, picked) {
  return String(text || '').split(/(\[[^\]]+\])/).map((part) => {
    if (!part) return '';
    if (/^\[.*\]$/.test(part)) return `<span class="fill">${esc(part)}</span>`;
    return picked ? `<span class="swap">${esc(part)}</span>` : esc(part);
  }).join('');
}

// A copy button sits on the line it copies, at its right end (user
// decision 2026-11-08): To, Subject, and the body on the greeting line,
// where the body starts.
const copyBtn = (what, label) => '<button type="button" class="cp"'
  + ` data-copy="${what}">${label}</button>`;

// A header line's label and value, the label in a column of its own so a
// value that wraps lines up after the colon (user decision 2026-11-08).
function hv(label, valueHtml) {
  return `<span class="hv"><span class="k">${label}:</span>`
    + `<b>${valueHtml}</b></span>`;
}

// The Site line: a web address opens in a new tab (user decision
// 2026-11-08); anything else is shown as text.
function siteLine(v, picked) {
  const value = /^https?:\/\//.test(v || '')
    ? `<a href="${esc(v)}" target="_blank" rel="noopener"`
      + `${picked ? ' class="swap"' : ''}>${esc(v)}</a>`
    : (v ? marked(v, picked) : '—');
  return `<p class="subj">${hv('Site', value)}</p>`;
}

// The format paragraph (user decision 2026-11-08): the wording of the
// option the toggle shows, from email.yaml's `formats:`.
export function formatText(m) {
  const fs = m.formats || [];
  return (fs.find((f) => f.id === m.format) || fs[0] || {}).text || '';
}

const para = (m, t) => (t === '[line]' ? m.line || ''
  : t === '[format]' ? formatText(m) : t);

// The email, drawn: its header lines, then the body.
export function emailHtml(m, picked) {
  const head = (label, v, pick, what) => `<p class="subj${what ? ' line' : ''}">`
    + hv(label, v ? marked(v, pick) : '—')
    + (what ? copyBtn(what, `Copy ${label.toLowerCase()}`) : '') + '</p>';
  // From carries two: the name and the address, the two fields a
  // contact form asks for separately (user decision 2026-11-08).
  return '<p class="subj line">'
    + hv('From', m.from ? marked(m.from, false) : '—')
    + '<span class="cps">' + copyBtn('name', 'Copy name')
    + copyBtn('from', 'Copy from') + '</span></p>'
    + head('To', m.to, picked, 'to')
    + (m.cc !== undefined ? head('Cc', m.cc, picked) : '')
    + (m.site !== undefined ? siteLine(m.site, picked) : '')
    + (m.date !== undefined ? head('Date', m.date, false) : '')
    + head('Subject', m.subject, false, 'subject')
    + `<p class="line"><span>${marked(m.greet,
      picked && !String(m.greet || '').includes('['))}</span>`
    + copyBtn('body', 'Copy body') + '</p>'
    + (m.paragraphs || []).map((t) => (t === '[line]'
      ? `<p>${m.line ? marked(m.line, picked) : marked(m.linePlaceholder)}</p>`
      : t === '[format]' ? `<p><span class="swap">${esc(formatText(m))}`
        + '</span></p>'
      // a draft's [slots] are marked to fill; a saved email is shown as is
      : `<p>${(m.saved ? esc(t) : marked(t, false))
        .replace(/\n/g, '<br>')}</p>`)).join('')
    + ((m.sign || []).length ? `<p>${m.sign.map(esc).join('<br>')}</p>` : '');
}

// The email's body as text, as it would be pasted.
export function emailText(m) {
  const paras = (m.paragraphs || []).map((t) => para(m, t)).filter(Boolean);
  return [m.greet, ...paras, (m.sign || []).join('\n')].filter(Boolean)
    .join('\n\n');
}

// ---- copying -----------------------------------------------------------

// The older way to copy: select the text in a hidden box and ask the
// browser to copy it. It works on a plain-http page (user report
// 2026-11-08: http://ganymede.local:3000 is not a secure context, so
// navigator.clipboard is missing there) as long as it runs inside the
// click, before anything is awaited.
function copyByHand(text) {
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.opacity = '0';
  document.body.appendChild(box);
  box.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  box.remove();
  return ok;
}

// Copy `text`, then `tell` what happened, naming the field.
export async function copyText(text, label, tell) {
  if (!text) { tell('Nothing to copy.'); return; }
  const done = `Copy successful: ${label}.`;
  const blocked = 'Clipboard blocked; select and copy by hand.';
  if (!(window.isSecureContext && navigator.clipboard)) {
    tell(copyByHand(text) ? done : blocked);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    tell(done);
  } catch (e) { tell(copyByHand(text) ? done : blocked); }
}

// Wire the copy buttons of the email drawn in `box`. `current()` is the
// email now shown, or null; `own` is the one whose From copies even with
// nothing picked (From is the same whoever is picked). The buttons are
// redrawn with the email, so one listener on the box answers them all.
export function wireCopy(box, current, own, tell) {
  box.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-copy]');
    if (!b) return;
    const self = b.dataset.copy === 'from' || b.dataset.copy === 'name';
    const m = current() || (self ? own : null);
    if (!m) { tell('Pick a name first.'); return; }
    // Name copies the part before <…>; From copies the address alone
    // (what a contact form's email field wants): the part in <…>, or the
    // whole value when there is none.
    const kind = b.dataset.copy;
    const text = {
      name: () => String(m.from || '').split('<')[0].trim(),
      from: () => (/<([^>]+)>/.exec(m.from || '') || [, m.from])[1],
      to: () => m.to,
      subject: () => m.subject,
      body: () => emailText(m),
    }[kind]();
    const label = { name: 'Name', from: 'From', to: 'To',
                    subject: 'Subject', body: 'Body' }[kind];
    // AN UNFILLED [PLACEHOLDER] HOLDS THE COPY BACK (user decision
    // 2026-11-08): the first click says what is left to fill and arms the
    // button for five seconds; a second click copies anyway, for a gap
    // filled in after pasting. A complete field copies at once.
    const gaps = String(text || '').match(/\[[^\]]+\]/g);
    if (gaps && b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      tell(`${label} still has ${[...new Set(gaps)].join(', ')}`
        + ' to fill. Click again to copy anyway.');
      clearTimeout(b.disarm);
      b.disarm = setTimeout(() => { delete b.dataset.armed; }, 5000);
      return;
    }
    delete b.dataset.armed;
    copyText(text, label, tell);
  });
}

// A SAVED email (an .eml read by the server) as an email of this module:
// its first line is the greeting line, the rest the body.
export function savedEmail(s) {
  const text = String(s.body || '').trim();
  const cut = text.indexOf('\n');
  const greet = cut < 0 ? text : text.slice(0, cut).trim();
  const parts = (cut < 0 ? '' : text.slice(cut + 1)).split(/\n\s*\n/)
    .map((x) => x.trim()).filter(Boolean);
  return { from: s.from_full || s.from, to: s.to_full || s.to,
    cc: s.cc_full || undefined, date: s.date, subject: s.subject,
    greet, paragraphs: parts, sign: [], saved: true };
}
