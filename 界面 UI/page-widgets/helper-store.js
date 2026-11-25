// helper-store.js — how an edited page READS and WRITES its data through a
// loopback helper (user decision 2026-11-15: "SSOT the entire adding/
// editing system"). edit-mode.js is how editing looks and behaves; this
// is the other half, how what was edited reaches the file. First callers:
// 临终规划 Death Plan's lists (sealed_lists, /sealed-data/) and the Projects
// page (corpus_store, /intentions-data/).
//
// THE CONTRACT every helper keeps (sealed_lists.server is the first):
//
//     GET  <url>  →  {"rev", …the data}
//     PUT  <url>  ←  {"rev", …}  →  the saved data with its new rev, or
//                    {"error"} with 400 refused · 409 saved elsewhere
//                    first · 503 data vault locked
//     404 / 502   →  the helper is not running, or older than the page
//
// `rev` is the helper's: a counter (sealed_lists) or a hash of the file's
// bytes (corpus_store) — the page only hands back the one it was given.
//
//     import { getJson, putJson, postJson, writeQueue, sayInto }
//       from '…/界面 UI/page-widgets/helper-store.js';
//
//     const say = sayInto();          // the page's toast
//     const enqueue = writeQueue();
//     enqueue(async () => {
//       try { data = await putJson(url, { rev: data.rev, … }); }
//       catch (e) { say(e.message, true, !!e.restart); }
//     });
//
// EVERY WRITE WAITS ITS TURN (`writeQueue`): in edit mode a field is saved
// the moment it is left, so a quick Tab to the next field starts a second
// save while the first is still sealing. Each job runs after the one
// before it, and builds its body only when its turn comes, so none is
// dropped and none writes over another's result.
//
// THE HELPER, RESTARTED FROM ORIGIN (user decision 2026-10-25): an error
// from a helper that is down carries `restart`, and `sayInto` adds a
// button that copies Origin's link to [w] Web → [l] Local server ↻ —
// pasted into Origin's [e] Execute, or clicked where links open Origin.

import './copy-text.js';      // window.copyButton, for the restart link

export const RESTART_LINK = 'origin://web/helpers';

export function helperDown(text) {
  const e = new Error(text + ' — copy the restart link, then press [e] '
                      + 'Execute in Origin.');
  e.restart = true;
  return e;
}

export function restartButton() {
  const b = document.createElement('button');
  b.className = 'linkish';
  b.type = 'button';
  b.textContent = 'Copy restart link';
  b.title = RESTART_LINK;
  // The copy answers on the button (copy-text.js `copyButton`); a failed
  // one shows the link whole, to copy by hand.
  b.addEventListener('click', () => window.copyButton(b, RESTART_LINK,
    { onFail: () => { b.textContent = RESTART_LINK; } }));
  return b;
}

// THE PAGE'S MESSAGES FLOAT (user decision 2026-11-25: "it shouldn't take
// extra space, it shouldn't move the content below it"): one toast at the
// foot of the window, over the page, never in its flow — base.css
// `.page-toast`. A message fades after a few seconds; an error stays until
// it is clicked away, so a failed save is never missed. A copy is NOT
// told here: its button answers (copy-text.js `copyButton`).
const TOAST_MS = 4000;
let toastEl = null;

function toast() {
  if (toastEl) return toastEl;
  toastEl = document.createElement('div');
  toastEl.className = 'page-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) return;     // the restart button
    hide();
  });
  document.body.append(toastEl);
  return toastEl;
}

function hide() {
  if (toastEl) toastEl.classList.remove('on');
}

// `say(text, bad, restart)`: the toast's one voice — the text, `.bad` when
// it is an error, the restart button when asked; '' takes it down.
export function say(text, bad = false, restart = false) {
  const t = toast();
  clearTimeout(say.timer);
  if (!text) { hide(); return; }
  t.textContent = text;
  t.classList.toggle('bad', !!bad);
  if (restart) t.append(' ', restartButton());
  t.classList.add('on');
  if (!bad) say.timer = setTimeout(hide, TOAST_MS);
}

// The older name, from when each page had a status line to write into.
export const sayInto = () => say;

// What a read refused with `status` means, in words.
function readError(status, what) {
  if (status === 404 || status === 502) {
    return helperDown('The ' + what + ' helper is not running, or is older '
                      + 'than this page');
  }
  if (status === 503) return new Error('The data vault is locked.');
  if (status === 403) {
    return new Error('This ' + what + ' is served to this machine only.');
  }
  return new Error('The ' + what + ' could not be read (' + status + ').');
}

export async function getJson(url, { what = 'list' } = {}) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    throw new Error('The local server did not answer.');
  }
  if (!res.ok) throw readError(res.status, what);
  return res.json();
}

async function send(method, url, body, what) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('Not saved — the local server did not answer.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 404 || res.status === 502) {
    throw helperDown('Not saved — the ' + what + ' helper is not running, '
                     + 'or is older than this page');
  }
  if (!res.ok) {
    const e = new Error('Not saved — ' + (data.error || res.status));
    e.status = res.status;           // 409: saved elsewhere first
    e.data = data;
    throw e;
  }
  return data;
}

export const putJson = (url, body, { what = 'list' } = {}) =>
  send('PUT', url, body, what);
export const postJson = (url, body, { what = 'list' } = {}) =>
  send('POST', url, body, what);

// An `enqueue(job)` whose jobs run one at a time, in order; a job that
// fails does not stop the ones after it.
export function writeQueue() {
  let queue = Promise.resolve();
  return (job) => {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  };
}
