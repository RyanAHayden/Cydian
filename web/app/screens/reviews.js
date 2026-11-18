// F182: the Reviews tab with reviews written here, and the Write a Review sheet (journal/F181/concept/TweakReviews and
// WriteReview.dc.html). The data side is core/reviews.js; the server, worker/src/reviews.js. Styles: reviews.css.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   reviewsTab(pane, { id, version, depiction, appStore, api, renderText, now })  -> Promise
//     The ratings card (ours, the depiction's and the App Store's merged, core/reviews.js mergeReviews) with Tap to
//     Rate under it, Write a Review, the reviews (ours first, newest first, "by name – Version – date", each with
//     Report; then the depiction's), More Reviews for the next page, and a footer saying where they come from.
//     F206: the card's skeleton while it loads; the card's five bars filter the list to one rating (`filter`, kept
//     across a redraw after a post). Returns { card, area, setFilter(stars | null), filter() }.
//     `depiction`: core/previews.js sileoRatings(); `appStore`: { average, count, reviews? } (core/applookup.js; B37:
//     its written reviews drawn as an "App Store Reviews" group after ours and the depiction's); both may be
//     null or a promise. `renderText(review)`: the body of a depiction's review (ours are always plain text).
//     `first`: page 0 already asked for (the page's header stars), so it isn't asked twice; `onRating(r)`: the merged
//     rating each time it is drawn again after a post (the header and the Rating tile follow).
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
import { ratingsCard, reviewCell } from "./storepage.js";
import { checkDraft, mergeReviews, ourReview, withStars, LIMITS } from "../core/reviews.js";

export function starPicker(value = 0, onPick = () => {}, { cls = "" } = {}) {
  const node = el("span", `review-stars${cls ? ` ${cls}` : ""}`);
  node.setAttribute("role", "radiogroup");
  node.setAttribute("aria-label", "Rating");
  let now = 0;
  const buttons = [1, 2, 3, 4, 5].map((n) => {
    const b = el("button", "review-star", "★");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", `${n} star${n === 1 ? "" : "s"}`);
    b.addEventListener("click", () => { set(n); onPick(n); });
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
  first = null, onRating = null, sheet = writeReviewSheet, confirm = confirmReport, confirmDelete = confirmDeleteReview, filter = null } = {}) {
  // F206: the card's skeleton (the filled card's shape, "Loading Reviews…" in its last line), not a spinner, so the
  // tab doesn't jump when the reviews arrive.
  pane.replaceChildren(ratingsCard(null, { pending: true }));
  const [ours, dep, store] = await Promise.all([first ? resolved(first) : api.list(id, 0).catch(() => null), resolved(depiction), resolved(appStore)]);
  let mine = ours?.mine ?? null;
  let page = 0;
  let stars = [1, 2, 3, 4, 5].includes(filter) ? filter : null; // F206: the star filter, null for all

  const redraw = async () => { await reviewsTab(pane, { id, version, depiction: dep, appStore: store, api, renderText, now: Date.now(), onRating, sheet, confirm, confirmDelete, filter: stars }); };
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

  const merged = mergeReviews({ ours, depiction: dep, appStore: store, now });
  if (first === null) onRating?.(merged.rating); // drawn again after a post: the header's stars follow
  // Ours first (each page of More Reviews after the last), then the depiction's; B37's App Store reviews apart.
  const oursShown = [...(ours?.reviews ?? [])];
  const theirs = merged.reviews.filter((rv) => !rv.ours);
  const mainReviews = () => [...oursShown.map((rv) => ourReview(rv, now)), ...theirs];
  const written = () => [...mainReviews(), ...merged.appStoreReviews];
  // F206: the bars count the reviews we have when the source gives no histogram; a row filters the list below to its
  // rating, the same row again (or Show All) clears it.
  const card = ratingsCard(merged.rating, { reviews: written(), selected: stars, onPick: (n) => setFilter(stars === n ? null : n) });
  const parts = [card];
  if (ours?.enabled) {
    const tap = el("div", "review-tap");
    const status = el("span", "review-tap-status");
    const picker = starPicker(mine?.stars ?? 0, async (n) => {
      status.textContent = "Sending…";
      try {
        await post({ stars: n, title: mine?.title ?? "", name: mine?.name ?? "", text: mine?.text ?? "", version: version || mine?.version || "" });
      } catch (e) { status.textContent = e?.message || "Not sent."; picker.set(mine?.stars ?? 0); }
    }, { cls: "small" });
    tap.append(el("span", "review-tap-label", mine ? "Your Rating:" : "Tap to Rate:"), status, picker.node);
    card.table.append(tap); // inside the ratings card, under the bars
    const actions = el("div", "review-actions");
    const write = el("button", "review-button", mine?.title || mine?.text ? "Edit Your Review" : "Write a Review");
    write.type = "button";
    write.addEventListener("click", () => sheet({ initial: mine, version, onSend: post, onDelete: mine ? removeMine : null, confirmDelete }));
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
      }
      // B37: the App Store's written reviews, newest first, as a group of their own.
      if (merged.appStoreReviews.length) {
        const g = el("div", "group store-reviews-group store-reviews-appstore");
        const l = el("div", "table grouped store-review-list");
        l.append(...merged.appStoreReviews.map(cellOf));
        g.append(el("h2", "group-header", merged.appStoreLabel), l);
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
  const foot = el("p", "group-footer store-reviews-footer", merged.footer);
  parts.push(foot);
  pane.replaceChildren(...parts);
  return { card, area, setFilter, filter: () => stars };
}

async function confirmReport() {
  const { index } = await showAlert({ title: "Report This Review?", message: "Reviews reported by several people are hidden.", buttons: ["Cancel", "Report"], cancel: 0 });
  return index === 1;
}

// F207: iOS 6's action sheet, red Delete Review over Cancel.
async function confirmDeleteReview() {
  return (await showActionSheet({ buttons: ["Delete Review"], destructive: 0 })) === 0;
}
