// F103: the Sileo-only depiction views (RatingView, ReviewView, WebView, MinVersionForceView), rendered over a small
// fake DOM. No browser: what's checked is the tree, the styles set on it and that nothing unsafe gets in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSileo, stars, webUrl } from "./depiction.js";

function fakeElement(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, style: { setProperty(k, v) { e.style[k] = v; } },
    className: "", textContent: "", hidden: false,
    classList: { add: (...c) => { e.className = [e.className, ...c].filter(Boolean).join(" "); }, toggle() {}, contains: (c) => e.className.split(" ").includes(c) },
    append(...k) { for (const c of k) { if (typeof c === "string") e.children.push({ nodeType: 3, textContent: c }); else if (c?.tagName === "#FRAG") e.children.push(...c.children); else if (c) e.children.push(c); } },
    setAttribute(a, v) { e.attrs[a] = String(v); }, getAttribute: (a) => e.attrs[a] ?? null,
    addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
  };
  return e;
}

function withDom(fn) {
  const saved = globalThis.document;
  globalThis.document = { createElement: fakeElement, createDocumentFragment: () => fakeElement("#frag") };
  try { return fn(); } finally { globalThis.document = saved; }
}

const all = (root, out = []) => { out.push(root); for (const c of root.children ?? []) all(c, out); return out; };
const byClass = (root, cls) => all(root).filter((n) => n.className?.split?.(" ").includes(cls));
const text = (n) => (n.nodeType === 3 ? n.textContent : n.textContent + (n.children ?? []).map(text).join(""));
const stack = (...views) => ({ class: "DepictionStackView", views });

test("F103: RatingView draws five stars filled to the rating, clamped to 0-5", () => withDom(() => {
  const root = renderSileo(stack({ class: "DepictionRatingView", rating: 3.5, alignment: 1 }));
  const [box] = byClass(root, "dep-rating");
  assert.ok(box, "a rating box");
  assert.equal(box.style.textAlign, "center");
  const [s] = byClass(box, "dep-stars");
  assert.equal(s.attrs["aria-label"], "3.5 out of 5 stars");
  assert.equal(byClass(s, "dep-stars-fill")[0].style.width, "70%");
  assert.equal(byClass(stars(9), "dep-stars-fill")[0].style.width, "100%");
  assert.equal(byClass(stars(-1), "dep-stars-fill")[0].style.width, "0%");
  assert.equal(byClass(stars("junk"), "dep-stars-fill")[0].style.width, "0%");
}));

test("F103: ReviewView is one grouped cell: title, stars, author, markdown", () => withDom(() => {
  const root = renderSileo(stack({ class: "DepictionReviewView", title: "Great tweak", author: "someone", rating: 4,
    markdown: "Works **well** on iOS 16." }));
  const [cell] = byClass(root, "dep-review");
  assert.ok(cell, "a review cell");
  assert.equal(byClass(cell, "dep-review-title")[0].textContent, "Great tweak");
  assert.equal(byClass(cell, "dep-review-author")[0].textContent, "by someone");
  assert.equal(byClass(cell, "dep-stars-fill")[0].style.width, "80%");
  const [body] = byClass(cell, "dep-review-body");
  assert.equal(text(body), "Works well on iOS 16.");
  assert.ok(all(body).some((n) => n.tagName === "STRONG"), "markdown is parsed");
  const bare = renderSileo(stack({ class: "DepictionReviewView", title: "t", markdown: "<script>x</script>" }));
  assert.equal(byClass(bare, "dep-review-author").length, 0, "no author, no author line");
  assert.ok(!all(bare).some((n) => n.tagName === "SCRIPT"), "markdown text is never HTML");
}));

test("F103: WebView is a sandboxed iframe at the width/height aspect; only http(s)", () => withDom(() => {
  const root = renderSileo(stack({ class: "DepictionWebView", URL: "https://example.com/w", width: 320, height: 180, alignment: 2 }));
  const [f] = all(root).filter((n) => n.tagName === "IFRAME");
  assert.ok(f, "an iframe");
  assert.equal(f.src, "https://example.com/w");
  assert.equal(f.attrs.sandbox, "allow-scripts", "scripts, but no same-origin, forms, popups or top navigation");
  assert.equal(f.attrs.referrerpolicy, "no-referrer");
  assert.equal(f.style.width, "min(100%, 320px)");
  assert.equal(f.style.aspectRatio, "320 / 180");
  assert.equal(byClass(root, "dep-web")[0].style.textAlign, "right");
  for (const URL of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "", undefined]) {
    const r = renderSileo(stack({ class: "DepictionWebView", URL }));
    assert.equal(all(r).filter((n) => n.tagName === "IFRAME" || n.tagName === "A").length, 0, String(URL));
  }
  assert.equal(webUrl("ftp://x"), null);
  assert.deepEqual(webUrl(" https://a.b/c "), { src: "https://a.b/c", proxied: false, original: "https://a.b/c" });
}));

test("F103: on the site an http WebView, which the proxy can't serve as HTML, is a link row instead", () => withDom(() => {
  // No ifizboxNative: getBackend() is the http backend, whose assetUrl goes through /api/fetch.
  const u = webUrl("http://example.com/page");
  assert.equal(u.proxied, true);
  assert.match(u.src, /\/api\/fetch\?/);
  const root = renderSileo(stack({ class: "DepictionWebView", URL: "http://example.com/page" }));
  assert.equal(all(root).filter((n) => n.tagName === "IFRAME").length, 0);
  const [a] = all(root).filter((n) => n.tagName === "A");
  assert.equal(a.href, "http://example.com/page");
  assert.equal(a.rel, "noopener noreferrer");
}));

test("F103: MinVersionForceView renders its inner view; an empty one renders nothing", () => withDom(() => {
  const root = renderSileo(stack({ class: "DepictionMinVersionForceView", minVersion: "2.5",
    view: { class: "DepictionHeaderView", title: "New in 2.0" } }));
  const [h] = byClass(root, "dep-header");
  assert.equal(h?.textContent, "New in 2.0");
  const empty = renderSileo(stack({ class: "DepictionMinVersionForceView", minVersion: "2.5" }));
  assert.equal(byClass(empty, "dep-stack")[0].children.length, 0);
}));

// B18: Chariz's Oneko depiction (https://chariz.com/api/sileo/package/com.pixelomer.oneko/depiction.json), its
// three DepictionButtonViews as served: isLink with a nested label, and with a nested image.
test("B18: a ButtonView with isLink and a nested view draws the view inside a plain link, not an empty bar", () => withDom(() => {
  const opened = [];
  const root = renderSileo(stack(
    { class: "DepictionButtonView", action: "https://chariz.com/get/oneko/changelog", openExternal: false, isLink: true,
      view: { class: "DepictionLabelView", text: "Version History", fontSize: 12, alignment: 2, margins: "{21, 15, 6, 15}" } },
    { class: "DepictionButtonView", action: "mailto:contact%40pixelomer.com?subject=Oneko%20%E2%80%93%20Chariz%20Support",
      openExternal: true, isLink: true, view: { class: "DepictionLabelView", text: "Email Support", fontSize: 12, margins: "{4, 15, 10, 15}" } },
    { class: "DepictionButtonView", action: "https://chariz.com/", isLink: true, yPadding: 8, text: "Chariz",
      view: { class: "DepictionImageView", URL: "https://chariz.com/img/chariz-logo-head@3x.png", width: 83, height: 30,
        cornerRadius: 0, alignment: 1, accessibilityText: "Chariz" } },
    { class: "DepictionButtonView", action: "depiction-https://example.com/sub.json", view: { class: "DepictionLabelView", text: "More" } },
    { class: "DepictionButtonView", action: "https://example.com/", text: "Plain" },
  ), { open: (url, title) => opened.push([url, title]) });
  const [history, email, logo, sub, plain] = byClass(root, "dep-button");
  for (const b of [history, email, logo]) {
    assert.ok(b.classList.contains("link"), "isLink: link style, not the filled bar");
    assert.ok(b.classList.contains("has-view"));
  }
  const [label] = byClass(history, "dep-label");
  assert.equal(label?.textContent, "Version History", "the nested label is inside the button");
  assert.equal(label.style.textAlign, "right");
  assert.equal(history.href, "https://chariz.com/get/oneko/changelog");
  assert.equal(history.textContent, "", "no duplicate text beside the view");
  assert.equal(history.attrs["aria-label"], "Version History");
  assert.match(email.href, /^mailto:/);
  assert.equal(byClass(email, "dep-label")[0].textContent, "Email Support");
  const [img] = all(logo).filter((n) => n.tagName === "IMG");
  assert.equal(img?.src, "https://chariz.com/img/chariz-logo-head@3x.png", "the nested image is inside the button");
  assert.equal(img.alt, "Chariz");
  assert.equal(logo.attrs["aria-label"], "Chariz");
  assert.equal(logo.style.paddingBlock, "8px");
  assert.ok(!sub.classList.contains("link"), "no isLink: still the filled button, with its view inside");
  assert.equal(byClass(sub, "dep-label")[0].textContent, "More");
  sub.listeners.click[0]({ preventDefault() {} });
  assert.deepEqual(opened, [["https://example.com/sub.json", "More"]], "a sub-depiction opens with the label's text as title");
  assert.equal(plain.textContent, "Plain");
  assert.ok(!plain.classList.contains("link") && !plain.classList.contains("has-view"));
}));
