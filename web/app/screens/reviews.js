// F182: the Reviews tab with reviews written here, and the Write a Review sheet (journal/F181/concept/TweakReviews and
// WriteReview.dc.html). The data side is core/reviews.js; the server, worker/src/reviews.js. Styles: reviews.css.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   reviewsTab(pane, { id, version, depiction, appStore, api, renderText, now })  -> Promise
//     The ratings card (ours, the depiction's and the App Store's merged, core/reviews.js mergeReviews) with Tap to
//     Rate under it, Write a Review, the reviews (ours first, newest first, "by name – Version – date", each with
//     Report; then the depiction's), More Reviews for the next page, and a footer saying where they come from.
//     `depiction`: core/previews.js sileoRatings(); `appStore`: { average, count, reviews? } (core/applookup.js; B37:
//     its written reviews drawn as an "App Store Reviews" group after ours and the depiction's); both may be
//     null or a promise. `renderText(review)`: the body of a depiction's review (ours are always plain text).
//     `first`: page 0 already asked for (the page's header stars), so it isn't asked twice; `onRating(r)`: the merged
//     rating each time it is drawn again after a post (the header and the Rating tile follow).
//   writeReviewSheet({ initial, version, onSend, footnote }) -> { sheet, close, send, stars, fields }
//     The iOS 6 modal: Cancel / Send, the five stars, Title, Name, Review. onSend(draft) -> Promise; it closes when
//     that resolves and shows the error under the form when it throws.
//   starPicker(value, onPick)                 -> { node, set(n), value() }  five tappable stars
//
// Everything a person wrote goes in through textContent (nav/ui.js el), never innerHTML.
import { el } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { ratingsCard, reviewCell } from "./storepage.js";
import { checkDraft, mergeReviews, ourReview, LIMITS } from "../core/reviews.js";

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

export function writeReviewSheet({ initial = null, version = "", onSend = async () => {}, footnote = null, onClose = () => {} } = {}) {
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
  cancel.addEventListener("click", close);
  send.addEventListener("click", doSend);
  return { sheet, close, send: doSend, stars, fields, error, closed: () => closed };
}

const resolved = (p) => Promise.resolve(p).catch(() => null);

export async function reviewsTab(pane, { id, version = "", depiction = null, appStore = null, api, renderText = null, now = Date.now(),
  first = null, onRating = null, sheet = writeReviewSheet, confirm = confirmReport } = {}) {
  const loading = el("div", "loading");
  loading.append(el("span", "loading-spinner"), el("span", null, "Loading Reviews"));
  pane.replaceChildren(loading);
  const [ours, dep, store] = await Promise.all([first ? resolved(first) : api.list(id, 0).catch(() => null), resolved(depiction), resolved(appStore)]);
  let mine = ours?.mine ?? null;
  let page = 0;

  const redraw = async () => { await reviewsTab(pane, { id, version, depiction: dep, appStore: store, api, renderText, now: Date.now(), onRating, sheet, confirm }); };
  // Tap to Rate keeps the words of a review this device wrote: it only changes the stars.
  const post = async (draft) => {
    const r = await api.post(id, draft);
    mine = r?.review ?? mine;
    await redraw();
  };

  const merged = mergeReviews({ ours, depiction: dep, appStore: store, now });
  if (first === null) onRating?.(merged.rating); // drawn again after a post: the header's stars follow
  const card = ratingsCard(merged.rating);
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
    (card.children[card.children.length - 1] ?? card).append(tap); // inside the ratings card, under the bars
    const actions = el("div", "review-actions");
    const write = el("button", "review-button", mine?.title || mine?.text ? "Edit Your Review" : "Write a Review");
    write.type = "button";
    write.addEventListener("click", () => sheet({ initial: mine, version, onSend: post }));
    actions.append(write);
    parts.push(actions);
    if (mine?.hidden) parts.push(el("p", "review-hidden-note", "Your review was hidden after other people reported it. Changing it shows it again."));
  }

  const list = el("div", "table grouped store-review-list");
  const cellOf = (rv, i) => {
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
    }
    return c;
  };
  // Ours first (each page of More Reviews after the last), then the depiction's.
  const oursShown = [...(ours?.reviews ?? [])];
  const theirs = merged.reviews.filter((rv) => !rv.ours);
  const fillList = () => list.replaceChildren(...[...oursShown.map((rv) => ourReview(rv, now)), ...theirs].map(cellOf));
  fillList();
  if (merged.reviews.length) {
    const g = el("div", "group store-reviews-group");
    g.append(el("h2", "group-header", "Reviews"), list);
    parts.push(g);
    if (ours?.more) {
      const more = el("button", "review-button review-more", "More Reviews…");
      more.type = "button";
      more.addEventListener("click", async () => {
        more.disabled = true;
        const next = await api.list(id, page + 1).catch(() => null);
        if (next?.reviews?.length) { page++; oursShown.push(...next.reviews); fillList(); }
        more.disabled = false;
        if (next && !next.more) more.remove();
      });
      parts.push(more);
    }
  }
  // B37: the App Store's written reviews, newest first, as a group of their own (plain text: reviewCell's textContent).
  if (merged.appStoreReviews.length) {
    const g = el("div", "group store-reviews-group store-reviews-appstore");
    const l = el("div", "table grouped store-review-list");
    l.append(...merged.appStoreReviews.map((rv, i) => reviewCell(rv, i)));
    g.append(el("h2", "group-header", merged.appStoreLabel), l);
    parts.push(g);
  }
  const foot = el("p", "group-footer store-reviews-footer", merged.footer);
  parts.push(foot);
  pane.replaceChildren(...parts);
}

async function confirmReport() {
  const { index } = await showAlert({ title: "Report This Review?", message: "Reviews reported by several people are hidden.", buttons: ["Cancel", "Report"], cancel: 0 });
  return index === 1;
}
