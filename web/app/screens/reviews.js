// F182: the Reviews tab with reviews written here, and the Write a Review sheet (journal/F181/concept/TweakReviews and
// WriteReview.dc.html). The data side is core/reviews.js; the server, worker/src/reviews.js. Styles: reviews.css.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   reviewsTab(pane, { id, version, depiction, appStore, build, api, renderText, now })  -> Promise
//     The ratings card (ours and the depiction's merged, core/reviews.js mergeReviews) with Tap to
//     Rate under it, Write a Review, the reviews (ours first, newest first, "by name – Version – date", each with
//     Report; then the depiction's), More Reviews for the next page, and a footer saying where they come from.
//     F206: the card's skeleton while it loads; the card's five bars filter the list to one rating (`filter`, kept
//     across a redraw after a post). Returns { card, area, setFilter(stars | null), filter(), toggle }.
//     `depiction`: core/previews.js sileoRatings(), null or a promise. `renderText(review)`: the body of a
//     depiction's review (ours are always plain text).
//     B82, app pages (`build: true`): the card is This Build's alone (never averaged with Apple's). `appStore` (or a
//     promise of it): { average, count, name, seller, reviews() -> Promise<list> } when the App Store has the app, else
//     null. With one, a This Build | App Store toggle sits on top (always opening on This Build); the App Store view is
//     Apple's card (storepage.js appStoreCard) and its written reviews, asked for once, when the view first opens,
//     STORE_PAGE at a time behind More Reviews…. Without one, no toggle.
//     `first`: page 0 already asked for (the page's header stars), so it isn't asked twice; `onRating(r)`: the page's
//     rating each time it is drawn again after a post (the header and the Rating tile follow; B82: on an app page
//     ours when rated here, else the App Store's, core/reviews.js pageRating).
//     F216: Your Rating clears with the same star again or Remove (a written review asks first, confirmDelete);
//     it sends rateDelay (1.5 s) after the last touch, only the final value, and on pagehide / hidden at once.
//     `rating.flush()` sends a waiting change now (Write a Review does that first).
//   writeReviewSheet({ initial, version, onSend, footnote }) -> { sheet, close, send, stars, fields }
//     The iOS 6 modal: Cancel / Send, the five stars, Title, Name, Review. onSend(draft) -> Promise; it closes when
//     that resolves and shows the error under the form when it throws. F207: with `initial` and `onDelete`, a red
//     Delete Review at the bottom; `confirmDelete()` (an action sheet) asks first, then onDelete() and it closes.
//   starPicker(value, onPick)                 -> { node, set(n), value() }  five tappable stars
//
// Everything a person wrote goes in through textContent (nav/ui.js el), never innerHTML.
import { el } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { ratingsCard, reviewCell, appStoreCard } from "./storepage.js";
import { checkDraft, mergeReviews, ourReview, withStars, LIMITS, buildRating, pageRating, compactCount, appStoreReview } from "../core/reviews.js";

// F216: `clearable`: tapping the star that is already the value clears it to 0 (Your Rating; the sheet needs stars).
export function starPicker(value = 0, onPick = () => {}, { cls = "", clearable = false } = {}) {
  const node = el("span", `review-stars${cls ? ` ${cls}` : ""}`);
  node.setAttribute("role", "radiogroup");
  node.setAttribute("aria-label", "Rating");
  let now = 0;
  const buttons = [1, 2, 3, 4, 5].map((n) => {
    const b = el("button", "review-star", "★");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", `${n} star${n === 1 ? "" : "s"}`);
    b.addEventListener("click", () => { const v = clearable && n === now ? 0 : n; set(v); return onPick(v); });
    node.append(b);
    return b;
  });
  function set(n) {
    now = Math.max(0, Math.min(5, Number(n) || 0));
    buttons.forEach((b, i) => { b.classList.toggle("on", i < now); b.setAttribute("aria-checked", String(i + 1 === now)); });
  }
  set(value);
  return { node, buttons, set, value: () => now };
}

function field(label, { value = "", placeholder = "", max, multiline = false }) {
  const row = el("label", multiline ? "review-field review-field-text" : "review-field");
  const input = el(multiline ? "textarea" : "input", "review-input");
  if (!multiline) { input.type = "text"; row.append(el("span", "review-field-label", label)); } else {
    input.setAttribute("aria-label", label);
  }
  input.placeholder = placeholder;
  input.maxLength = max;
  input.value = value ?? "";
  row.append(input);
  return { row, input };
}

export function writeReviewSheet({ initial = null, version = "", onSend = async () => {}, footnote = null, onClose = () => {},
  onDelete = null, confirmDelete = confirmDeleteReview } = {}) {
  const sheet = el("div", "sheet review-sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Write a Review");
  const bar = el("header", "navbar sheet-bar");
  const row = el("div", "sheet-bar-row");
  const cancel = el("button", "bar-button", "Cancel");
  cancel.type = "button";
  const send = el("button", "bar-button done", "Send");
  send.type = "button";
  const left = el("div", "sheet-left");
  left.append(cancel);
  const right = el("div", "sheet-right");
  right.append(send);
  row.append(left, el("h1", "nav-title", "Write a Review"), right);
  bar.append(row);

  const body = el("div", "sheet-body review-sheet-body");
  const scroll = el("div", "sheet-scroll review-sheet-scroll");
  const stars = starPicker(initial?.stars ?? 0, () => { error.hidden = true; });
  const rate = el("div", "review-rate");
  rate.append(stars.node, el("span", "review-rate-label", "Tap a Star to Rate"));
  const form = el("div", "review-form");
  const fields = {
    title: field("Title", { value: initial?.title, max: LIMITS.title }),
    name: field("Name", { value: initial?.name, placeholder: "Nickname", max: LIMITS.name }),
    text: field("Review", { value: initial?.text, placeholder: "Review (optional)", max: LIMITS.text, multiline: true }),
  };
  form.append(fields.title.row, fields.name.row, fields.text.row);
  const error = el("div", "review-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const note = el("div", "review-note", footnote ?? `${version ? `Reviewing version ${version}. ` : ""}One review per package per device; you can change it later.`);
  scroll.append(rate, form, error, note);
  // F207: Delete Review, iOS 6's red destructive button at the bottom, only when there is a review of this device's.
  let del = null;
  if (initial && onDelete) {
    const wrap = el("div", "review-delete-wrap");
    del = el("button", "action-button destructive review-delete", "Delete Review");
    del.type = "button";
    wrap.append(del);
    scroll.append(wrap);
  }
  body.append(scroll);
  sheet.append(bar, body);
  document.body.append(sheet);
  const ease = "cubic-bezier(.25,.1,.25,1)";
  sheet.animate?.([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 350, easing: ease });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener?.("keydown", onKey);
    const end = () => { sheet.remove(); onClose(); };
    const a = sheet.animate?.([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 300, easing: ease, fill: "forwards" });
    if (a?.finished) a.finished.then(end, end); else end();
  }
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener?.("keydown", onKey);
  const showError = (msg) => { error.textContent = msg; error.hidden = false; };

  let busy = false;
  async function doSend() {
    if (busy) return false;
    const c = checkDraft({ stars: stars.value(), title: fields.title.input.value, name: fields.name.input.value, text: fields.text.input.value, version });
    if (!c.ok) { showError(c.error); return false; }
    busy = true;
    send.disabled = true;
    try {
      await onSend(c.draft);
      close();
      return true;
    } catch (e) {
      showError(e?.message || "Your review couldn't be sent.");
      return false;
    } finally { busy = false; send.disabled = false; }
  }
  async function doDelete() {
    if (busy || !del) return false;
    if (!(await confirmDelete())) return false;
    busy = true;
    send.disabled = del.disabled = true;
    try {
      await onDelete();
      close();
      return true;
    } catch (e) {
      showError(e?.message || "Your review couldn't be deleted.");
      return false;
    } finally { busy = false; send.disabled = del.disabled = false; }
  }
  cancel.addEventListener("click", close);
  send.addEventListener("click", doSend);
  del?.addEventListener("click", doDelete);
  return { sheet, close, send: doSend, remove: doDelete, deleteButton: del, stars, fields, error, closed: () => closed };
}

const resolved = (p) => Promise.resolve(p).catch(() => null);

export async function reviewsTab(pane, { id, version = "", depiction = null, appStore = null, api, renderText = null, now = Date.now(),
  first = null, onRating = null, sheet = writeReviewSheet, confirm = confirmReport, confirmDelete = confirmDeleteReview, filter = null,
  rateDelay = 1500, win = globalThis.window ?? null, doc = globalThis.document ?? null, build = false } = {}) {
  // F206: the card's skeleton (the filled card's shape, "Loading Reviews…" in its last line), not a spinner, so the
  // tab doesn't jump when the reviews arrive.
  pane.replaceChildren(ratingsCard(null, { pending: true, build }));
  const [ours, dep, found] = await Promise.all([first ? resolved(first) : api.list(id, 0).catch(() => null), resolved(depiction), resolved(appStore)]);
  // B82: Apple's written reviews are asked for once, the first time the App Store view opens (kept across a redraw).
  const store = found ? { ...found, reviews: onceList(found.reviews) } : null;
  let mine = ours?.mine ?? null;
  let page = 0;
  let stars = [1, 2, 3, 4, 5].includes(filter) ? filter : null; // F206: the star filter, null for all

  const redraw = async () => { await reviewsTab(pane, { id, version, depiction: dep, appStore: store, api, renderText, now: Date.now(), onRating, sheet, confirm, confirmDelete, filter: stars, rateDelay, win, doc, build }); };
  // F207: delete this device's review; the tab draws again (stars, count, list) and Tap to Rate starts empty.
  const removeMine = async () => {
    await api.remove(id, mine?.id ?? null);
    mine = null;
    await redraw();
  };
  // Tap to Rate keeps the words of a review this device wrote: it only changes the stars.
  const post = async (draft) => {
    const r = await api.post(id, draft);
    mine = r?.review ?? mine;
    await redraw();
  };

  const merged = mergeReviews({ ours, depiction: dep, now });
  // B82: an app page's card is This Build's alone; its header and Rating tile fall back to the App Store's.
  const cardRating = build ? buildRating(ours) : merged.rating;
  if (first === null) onRating?.(build ? pageRating({ ours, appStore: store }) : merged.rating); // drawn again after a post: the header's stars follow
  // Ours first (each page of More Reviews after the last), then the depiction's; B82: the App Store's never here.
  const oursShown = [...(ours?.reviews ?? [])];
  const theirs = merged.reviews.filter((rv) => !rv.ours);
  const mainReviews = () => [...oursShown.map((rv) => ourReview(rv, now)), ...theirs];
  const written = mainReviews;
  // F206: the bars count the reviews we have when the source gives no histogram; a row filters the list below to its
  // rating, the same row again (or Show All) clears it.
  const card = ratingsCard(cardRating, { reviews: written(), selected: stars, build, onPick: (n) => setFilter(stars === n ? null : n) });
  const parts = [card];
  let rating = null; // F216: { picker, flush } of Your Rating
  if (ours?.enabled) {
    const tap = el("div", "review-tap");
    const status = el("span", "review-tap-status");
    const label = el("span", "review-tap-label");
    // F216: the same star again clears it; Remove does too. The stars and the label follow each tap at once; the
    // post (or delete) goes out rateDelay after the last touch, only the final value and only if it changed.
    const picker = starPicker(mine?.stars ?? 0, (n) => changed(n), { cls: "small", clearable: true });
    const remove = el("button", "review-tap-remove", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => { picker.set(0); return changed(0); });
    tap.append(label, status, remove, picker.node);
    card.table.append(tap); // inside the ratings card, under the bars
    const show = () => {
      const v = picker.value();
      label.textContent = v ? "Your Rating:" : "Tap to Rate:";
      remove.hidden = !v;
    };
    show();
    rating = { picker, flush: () => flushRating() };
    const hasWords = () => Boolean(mine?.title || mine?.text);
    let timer = null, down = false, okToDelete = false, sending = null;
    let lastAsked = mine?.stars ?? 0; // the value a cancelled clear goes back to
    const onHide = () => { if (doc?.visibilityState === "hidden") flushRating(); };
    let watching = false;
    const watch = (on) => {
      if (on === watching) return;
      watching = on;
      const f = on ? "addEventListener" : "removeEventListener";
      win?.[f]?.("pagehide", flushRating);
      doc?.[f]?.("visibilitychange", onHide);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = null;
      if (down) { watch(true); return; } // a finger is still on the stars: wait for it to lift
      timer = setTimeout(() => { timer = null; flushRating(); }, rateDelay);
      watch(true);
    };
    async function changed(n) {
      status.textContent = "";
      show();
      // A review can't stay without stars: clearing one with words asks first, here, while the finger is on it.
      if (n === 0 && (mine?.stars ?? 0) && hasWords() && !okToDelete) {
        const prev = timer;
        clearTimeout(prev);
        timer = null;
        if (!(await confirmDelete())) {
          picker.set(lastAsked);
          show();
          if (lastAsked !== (mine?.stars ?? 0)) schedule();
          return;
        }
        okToDelete = true;
      }
      if (n) lastAsked = n;
      schedule();
    }
    async function flushRating() {
      clearTimeout(timer);
      timer = null;
      watch(false);
      if (sending) return sending;
      const was = mine?.stars ?? 0;
      const n = picker.value();
      if (n === was) { status.textContent = ""; return; }
      status.textContent = "Sending…";
      sending = (async () => {
        try {
          if (n === 0) await removeMine();
          else await post({ stars: n, title: mine?.title ?? "", name: mine?.name ?? "", text: mine?.text ?? "", version: version || mine?.version || "" });
        } catch (e) {
          status.textContent = e?.message || "Not sent.";
          picker.set(mine?.stars ?? 0); // the last value the server has
          lastAsked = mine?.stars ?? 0;
          okToDelete = false;
          show();
        } finally { sending = null; }
      })();
      return sending;
    }
    const press = () => { down = true; clearTimeout(timer); timer = null; };
    const lift = () => { if (!down) return; down = false; if (watching) schedule(); }; // watching: a change waits
    for (const t of ["pointerdown", "touchstart"]) picker.node.addEventListener(t, press);
    for (const t of ["pointerup", "pointercancel", "touchend", "touchcancel"]) picker.node.addEventListener(t, lift);
    const actions = el("div", "review-actions");
    const write = el("button", "review-button", mine?.title || mine?.text ? "Edit Your Review" : "Write a Review");
    write.type = "button";
    write.addEventListener("click", async () => { await rating?.flush(); sheet({ initial: mine, version, onSend: post, onDelete: mine ? removeMine : null, confirmDelete }); });
    actions.append(write);
    parts.push(actions);
    if (mine?.hidden) parts.push(el("p", "review-hidden-note", "Your review was hidden after other people reported it. Changing it shows it again."));
  }

  const cellOf = (rv, i) => {
    if (rv.appStore) return reviewCell(rv, i); // B37: plain text (reviewCell's textContent), no Report
    const c = reviewCell(rv, i, rv.ours ? undefined : renderText ?? undefined);
    if (rv.ours && rv.id !== mine?.id) {
      const rep = el("button", "review-report", "Report");
      rep.type = "button";
      rep.addEventListener("click", async () => {
        if (!(await confirm())) return;
        rep.disabled = true;
        try {
          const r = await api.report(id, rv.id);
          rep.replaceWith(el("span", "review-reported", r?.hidden ? "Reported. It's hidden now." : "Reported. Thank you."));
        } catch (e) { rep.disabled = false; rep.textContent = e?.code === "rate_limited" ? "Try Later" : "Report"; }
      });
      c.append(rep);
    } else if (rv.ours && mine && rv.id === mine.id) {
      // F207: your own review's row offers Delete Review instead of Report.
      const del = el("button", "review-delete-own", "Delete Review");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!(await confirmDelete())) return;
        del.disabled = true;
        try { await removeMine(); } catch (e) { del.disabled = false; del.textContent = e?.code === "rate_limited" ? "Try Later" : "Not Deleted. Try Again"; }
      });
      c.append(del);
    }
    return c;
  };
  // More Reviews: the next page of ours, kept below the list whether it is filtered or not.
  let moreLeft = Boolean(ours?.more);
  const moreButton = () => {
    const more = el("button", "review-button review-more", "More Reviews…");
    more.type = "button";
    more.addEventListener("click", async () => {
      more.disabled = true;
      const next = await api.list(id, page + 1).catch(() => null);
      if (next) moreLeft = Boolean(next.more);
      more.disabled = false;
      if (next?.reviews?.length) { page++; oursShown.push(...next.reviews); }
      if (next) fillArea();
    });
    return more;
  };
  // The list(s) under the card: all of them as before (ours and the depiction's, then B37's App Store group), or
  // F206's one filtered group: "4-Star Reviews (3)", or a cell saying there are none, and Show All N Reviews.
  const area = el("div", "store-reviews-area");
  function fillArea() {
    const out = [];
    const main = mainReviews();
    if (stars) {
      const shown = withStars(written(), stars);
      const g = el("div", "group store-reviews-group store-reviews-filtered");
      const l = el("div", "table grouped store-review-list");
      if (shown.length) l.append(...shown.map(cellOf));
      else l.append(el("div", "store-reviews-none", "No reviews with this rating."));
      g.append(el("h2", "group-header", `${stars}-Star Reviews (${shown.length})`), l);
      out.push(g);
      if (moreLeft) out.push(moreButton());
      const all = el("button", "review-button review-more review-show-all", `Show All ${written().length} Reviews`);
      all.type = "button";
      all.addEventListener("click", () => setFilter(null));
      out.push(all);
    } else {
      if (main.length) {
        const g = el("div", "group store-reviews-group");
        const l = el("div", "table grouped store-review-list");
        l.append(...main.map(cellOf));
        g.append(el("h2", "group-header", "Reviews"), l);
        out.push(g);
        if (moreLeft) out.push(moreButton());
      } else if (cardRating?.count > 0) {
        // Rated (Tap to Rate gives stars alone) but nothing written: say so, not a blank under the card.
        const g = el("div", "group store-reviews-group store-reviews-unwritten");
        const l = el("div", "table grouped store-review-list");
        l.append(el("div", "store-reviews-none", "No written reviews yet."));
        g.append(el("h2", "group-header", "Reviews"), l);
        out.push(g);
      }
    }
    area.replaceChildren(...out);
  }
  function setFilter(n) {
    stars = n;
    card.select(n);
    fillArea();
    area.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" }); // opacity only (120 Hz)
  }
  fillArea();
  parts.push(area);
  // B82: an app page says nothing of sources under This Build; with nobody rated yet, it points at the App Store tab.
  const footText = !build ? merged.footer
    : store && !cardRating ? "Ratings here are for this build only. The App Store tab has the original app's." : null;
  if (footText) parts.push(el("p", "group-footer store-reviews-footer", footText));
  if (!(build && store)) {
    pane.replaceChildren(...parts);
    return { card, area, setFilter, filter: () => stars, rating, toggle: null };
  }
  const toggle = reviewsToggle(pane, { parts, ours, store, cellOf, now });
  return { card, area, setFilter, filter: () => stars, rating, toggle };
}

const memo = new WeakMap();
// B82: a function asked once whatever calls it later (a redraw passes the same one on); a list given as is stays one.
function onceList(f) {
  if (typeof f !== "function") return () => Promise.resolve(Array.isArray(f) ? f : []);
  if (memo.has(f)) return f;
  let p = null;
  const once = () => (p ??= Promise.resolve().then(f).then((l) => (Array.isArray(l) ? l : []), () => []));
  memo.set(once, true);
  return once;
}

export const STORE_PAGE = 10; // Apple's reviews shown per More Reviews… tap (its feed gives up to 50)

// B82: the This Build | App Store toggle (depiction.js's small segmented control, packages.css .segmented) over the
// two views. It always opens on This Build; the App Store view is filled the first time it is chosen (its card at once,
// Apple's written reviews when they arrive). Switching fades the view in (opacity only, 120 Hz).
function reviewsToggle(pane, { parts, ours, store, cellOf, now = Date.now() }) {
  const views = [el("div", "store-review-view store-review-build"), el("div", "store-review-view store-review-appstore")];
  views[0].append(...parts);
  const n = Number(ours?.count) || 0;
  const labels = [n ? `This Build (${compactCount(n)})` : "This Build",
    Number(store.count) > 0 ? `App Store (${compactCount(store.count)})` : "App Store"];
  const seg = el("div", "segmented store-review-toggle");
  seg.setAttribute("role", "tablist");
  const buttons = labels.map((t, i) => {
    const b = el("button", "segment", t);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => select(i));
    seg.append(b);
    return b;
  });
  let at = 0, filled = false, loaded = null;
  function fillStore() {
    filled = true;
    const v = views[1];
    const g = el("div", "group store-reviews-group store-reviews-appstore");
    const l = el("div", "table grouped store-review-list");
    l.append(el("div", "store-reviews-none", "Loading Reviews…"));
    g.append(el("h2", "group-header", "Reviews"), l);
    const slot = el("div", "store-appstore-more-slot");
    v.append(appStoreCard(store, { name: store.name ?? null, seller: store.seller ?? null }), g, slot);
    loaded = store.reviews().then((list) => {
      const all = list.map((rv) => appStoreReview(rv, now));
      if (!all.length) { l.replaceChildren(el("div", "store-reviews-none", "No App Store reviews to show.")); return; }
      let shown = 0;
      let more = null;
      const page = () => {
        const next = all.slice(shown, shown + STORE_PAGE);
        if (!shown) l.replaceChildren();
        l.append(...next.map((rv, i) => cellOf(rv, shown + i)));
        shown += next.length;
        if (shown < all.length && !more) {
          more = el("button", "review-button review-more store-appstore-more", "More Reviews…");
          more.type = "button";
          more.addEventListener("click", page);
          slot.append(more);
        } else if (shown >= all.length && more) { slot.replaceChildren(); more = null; }
      };
      page();
    });
  }
  function select(i) {
    if (!(i === 0 || i === 1)) return;
    const changed = i !== at;
    at = i;
    buttons.forEach((b, j) => { b.classList.toggle("selected", i === j); b.setAttribute("aria-selected", String(i === j)); });
    views.forEach((v, j) => { v.hidden = i !== j; });
    if (i === 1 && !filled) fillStore();
    if (changed) views[i].animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
  }
  select(0);
  pane.replaceChildren(seg, ...views);
  return { control: seg, buttons, views, select, selected: () => (at ? "appstore" : "build"), loaded: () => loaded };
}

async function confirmReport() {
  const { index } = await showAlert({ title: "Report This Review?", message: "Reviews reported by several people are hidden.", buttons: ["Cancel", "Report"], cancel: 0 });
  return index === 1;
}

// F207: iOS 6's action sheet, red Delete Review over Cancel.
async function confirmDeleteReview() {
  return (await showActionSheet({ buttons: ["Delete Review"], destructive: 0 })) === 0;
}
