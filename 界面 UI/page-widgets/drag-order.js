// drag-order.js — THE shelf's drag-to-reorder: any page whose list can be
// put in order by hand uses this, rather than writing its own (user
// decision 2026-10-24: "SSOT it so in the future other apps can use this
// drag logic"). First callers: 临终规划 Death Plan's Checklist
// (items, within a method or into another) and Schedule (entries between
// stages, stages between methods) — each a `group`.
//
// WHAT THE USER SEES. Each item has a ⠇ grip. Drag it (mouse, pen or
// finger): the item lifts out of the list, a tilted copy follows the
// pointer, and the list opens a GAP the item's size — a dashed outline —
// exactly where it will land, closing up again as the pointer moves on.
// Let go and it drops into the gap. Or focus the grip and use ↑ / ↓ to move
// it one place at a time.
//
// HOW TO USE IT on a new page:
//
//     <link rel="stylesheet" href="…/界面 UI/styles/docs.css">
//     import { dragHandle, dragOrder, focusGrip } from
//       '…/界面 UI/page-widgets/drag-order.js';
//
//     for (const it of items) {
//       const li = document.createElement('li');
//       li.dataset.id = it.id;               // what onDrop reports
//       li.append(dragHandle(), it.text);    // the grip, anywhere inside
//       ul.appendChild(li);
//     }
//     dragOrder(ul, { onDrop: (ids, { moved, keyboard }) => {
//       save(ids);                           // the new order, every id
//       if (keyboard) focusGrip(ul, moved);  // after a redraw, if any
//     } });
//
// - An item is a DIRECT child of the container with a `data-id` (or what
//   the `items` option says). Anything else there (a heading, an add
//   button, a fold without an id) stays put and nothing is dropped across
//   it. Items can be any element: <li>, a <details> fold, a <div>.
// - Moves stay within one container, unless containers share a `group`:
//   then an item can be dragged from one into another, an empty one too
//   (the plan pages' sections). The keyboard moves within one container.
// - `onDrop` is called once, after a move that changed the order, on the
//   container the item landed in, with every item's id there in the new
//   order and `{moved, item, from, to, keyboard}` — the DOM already shows
//   it. A page that saves and redraws can hand keyboard focus back with
//   `focusGrip`.
// - `enabled()` gates it (the plan pages drag only in edit mode), and
//   `always: false` leaves showing the grips to the page's own CSS.
// - Calling `dragOrder` again on the same container only replaces its
//   options, so a page may call it on every draw.
//
// THE LOOK IS docs.css's, never this file's ("SSOT the style", same day):
// its "Editing: drag handles" block styles the grip (`.drag-handle`), the
// copy under the pointer (`.drag-ghost`) and the gap (`.drop-gap`). The
// plan pages (plan-chrome.js) drag with this module since 2026-10-24, in
// place of the mouse-only drag they had had since 2026-07.
//
// Pointer events, not the HTML drag-and-drop API: they behave the same for
// a mouse, a pen and a finger, and that API does not fire on touch screens.

/** The grip to put in an item: docs.css's ⠇, as a button so it can take
 *  focus. */
export function dragHandle(
  label = 'Drag to reorder (or focus and use ↑ ↓)') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'drag-handle';
  b.textContent = '⠇';
  b.title = label;
  b.setAttribute('aria-label', label);
  // Inside a <summary> a click would also open or close the fold.
  b.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  });
  return b;
}

/** Make `container`'s items draggable by their grips. See the header.
 *  Options: `onDrop(ids, info)`; `items` (which children are items,
 *  default `[data-id]`); `group` (containers sharing it take each other's
 *  items); `enabled()` (false: grips do nothing, e.g. outside edit mode);
 *  `always` (default true: grips always shown — false leaves showing them
 *  to the page's own rules, as the plan pages' `.editing`); `handle`.
 *  Calling it again on the same container replaces its options. */
export function dragOrder(container, opts) {
  const o = { items: '[data-id]', group: null, enabled: () => true,
              always: true, handle: '.drag-handle', ...opts };
  const first = !container.__dragOrder;
  container.__dragOrder = o;
  if (o.always) container.classList.add('drag-order');  // grips (docs.css)
  if (o.group) container.dataset.dragGroup = o.group;
  if (first) listen(container);
}

const itemsOf = (c) => [...c.children]
  .filter((n) => n.matches(c.__dragOrder.items) && !n.classList
    .contains('drop-gap'));
const idsOf = (c) => itemsOf(c).map((n) => n.dataset.id);
// The containers an item from `c` may go to: its group's, else itself.
const targetsOf = (c) => (c.__dragOrder.group
  ? [...document.querySelectorAll('[data-drag-group]')].filter((n) =>
    n.dataset.dragGroup === c.__dragOrder.group && n.__dragOrder
    && n.getClientRects().length)
  : [c]);

function gripOf(container, target) {
  const o = container.__dragOrder;
  const g = target.closest && target.closest(o.handle);
  if (!g || !container.contains(g)) return null;
  // A grip belongs to its NEAREST item: in nested lists (the site map's
  // page tree) a row's grip moves that row, never the row around it.
  const item = g.closest(o.items);
  return item && item.parentNode === container ? { g, item } : null;
}

// The container under the pointer: the one it is inside, else the nearest
// above or below it among those it is level with. NESTED LISTS (2026-10-25,
// the Death Plan's sub-references): of two the pointer is inside,
// the inner one — the outer one holds it, so it would always win, and a row
// dropped into a sub-list would land back in the list around it.
function containerAt(targets, x, y) {
  let best = null;
  let dist = Infinity;
  for (const c of targets) {
    const r = c.getBoundingClientRect();
    const level = x >= r.left - 40 && x <= r.right + 40;
    if (!level) continue;
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < dist || (d === 0 && dist === 0 && best && best.contains(c))) {
      dist = d;
      best = c;
    }
  }
  return best;
}

function listen(container) {
  container.addEventListener('pointerdown', (ev) => {
    const o = container.__dragOrder;
    const hit = gripOf(container, ev.target);
    if (!hit || ev.button > 0 || !o.enabled()) return;
    ev.preventDefault();
    ev.stopPropagation();       // an outer list must not take it as well
    const { item } = hit;
    // Never a list inside the lifted row itself (its own sub-list).
    const targets = targetsOf(container).filter((c) => !item.contains(c));
    // Compared by the items themselves, so items without an id (the plan
    // pages' rows) count their moves too.
    const before = new Map(targets.map((c) => [c, itemsOf(c)]));
    const same = (a, b) => a.length === b.length
      && a.every((n, i) => n === b[i]);
    let ghost = null;
    let gap = null;

    // The gap goes into the container under the pointer, before the first
    // item whose middle is below it, else after its last item; the lifted
    // item is out of the count.
    const placeGap = (x, y) => {
      const c = containerAt(targets, x, y) || gap.parentNode;
      const others = itemsOf(c).filter((n) => n !== item);
      const next = others.find((n) => {
        const r = n.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      if (next) {
        if (gap.nextElementSibling !== next) c.insertBefore(gap, next);
      } else if (others.length) {
        const last = others[others.length - 1];
        if (last.nextElementSibling !== gap) last.after(gap);
      } else if (gap.parentNode !== c) {
        c.prepend(gap);
      }
    };
    const lift = () => {
      const r = item.getBoundingClientRect();
      ghost = item.cloneNode(true);
      ghost.className = 'drag-ghost';
      ghost.removeAttribute('data-id');
      document.body.appendChild(ghost);
      // The gap starts where the item was, its size, then follows.
      gap = document.createElement(item.tagName === 'LI' ? 'li' : 'div');
      gap.className = 'drop-gap';
      gap.style.height = r.height + 'px';
      item.before(gap);
      item.hidden = true;
      item.style.display = 'none';         // even where CSS sets display
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
    };
    const move = (e) => {
      if (!ghost) lift();
      ghost.style.left = (e.clientX + 14) + 'px';
      ghost.style.top = (e.clientY - 10) + 'px';
      placeGap(e.clientX, e.clientY);
    };
    const finish = (drop) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      if (!ghost) return;
      ghost.remove();
      const to = drop ? gap.parentNode : container;
      if (drop) gap.before(item);
      gap.remove();
      item.hidden = false;
      item.style.display = '';
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      const changed = to !== container
        || !same(itemsOf(to), before.get(to));
      if (changed && to.__dragOrder.onDrop) {
        to.__dragOrder.onDrop(idsOf(to), { moved: item.dataset.id, item,
          from: container, to, keyboard: false });
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  });

  container.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    const o = container.__dragOrder;
    const hit = gripOf(container, ev.target);
    if (!hit || !o.enabled()) return;
    ev.preventDefault();
    ev.stopPropagation();
    const list = itemsOf(container);
    const from = list.indexOf(hit.item);
    const to = from + (ev.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= list.length) return;
    if (to < from) container.insertBefore(hit.item, list[to]);
    else list[to].after(hit.item);
    hit.g.focus();
    if (o.onDrop) {
      o.onDrop(idsOf(container), { moved: hit.item.dataset.id,
        item: hit.item, from: container, to: container, keyboard: true });
    }
  });
}

/** Focus the grip of the item `id` under `root`, if it is there. */
export function focusGrip(root, id, handle = '.drag-handle') {
  const item = [...root.querySelectorAll('[data-id]')]
    .find((n) => n.dataset.id === id);
  const g = item && item.querySelector(handle);
  if (g) g.focus();
}
