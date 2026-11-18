// F157: User Guides as iOS 6 app pages: routes and titles, FAQ answer pages and their Next rows, step ticking kept
// per guide, Copy, and the lite set (Not Jailbroken) with no jailbreak guide or word in anything it renders.
import { test } from "node:test";
import assert from "node:assert/strict";

// Home first, with no document (its screens style themselves at load when there is one).
const home = await import("./home.js");

// ---- a small fake DOM: enough for nav/ui.js grouped()/row() and guides.js ------------------------------------
function fakeDom() {
  const make = (tag, frag = false) => {
    const e = {
      tagName: String(tag).toUpperCase(), isFragment: frag, children: [], attrs: {}, listeners: {}, style: {}, dataset: {},
      parentNode: null, _text: "", _cls: new Set(), hidden: false,
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: {
        add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
        contains: (c) => e._cls.has(c), toggle: (c, on = !e._cls.has(c)) => { if (on) e._cls.add(c); else e._cls.delete(c); return on; },
      },
      get textContent() { return e._text + e.children.map((c) => c.textContent).join(""); },
      set textContent(v) { e._text = String(v); e.children = []; },
      setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute: (k) => e.attrs[k] ?? null,
      append(...c) {
        for (const x of c) {
          if (typeof x === "string") { e._text += x; continue; }
          if (x.isFragment) { x.children.splice(0).forEach((k) => e.append(k)); continue; }
          x.parentNode?.children && (x.parentNode.children = x.parentNode.children.filter((y) => y !== x));
          x.parentNode = e;
          e.children.push(x);
        }
      },
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      click() { return Promise.all((e.listeners.click ?? []).map((f) => f({ currentTarget: e }))); },
    };
    return e;
  };
  globalThis.document = { createElement: (t) => make(t), createDocumentFragment: () => make("#fragment", true) };
}
fakeDom();

const all = (n, out = []) => { out.push(n); n.children.forEach((c) => all(c, out)); return out; };
const byClass = (n, c) => all(n).filter((x) => x._cls.has(c));
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

const g = await import("./guides.js");
const draw = (path, opts = {}) => { const body = document.createElement("div"); g.render(body, { tab: "home", path }, opts); return body; };

test("F157: guide routes and titles, full and lite", () => {
  assert.deepEqual(g.guideIds(false), ["faq", "copying", "openssh", "password"]);
  assert.deepEqual(g.guideIds(true), ["faq", "copying"]);
  assert.deepEqual(g.guideRows(undefined, false).map((r) => r.href),
    ["#/home/guides/faq", "#/home/guides/copying", "#/home/guides/openssh", "#/home/guides/password"]);
  assert.deepEqual(g.guideRows(undefined, true).map((r) => r.label), ["Frequently Asked Questions", "Copying Files to/from Device"]);
  assert.equal(g.nav({ path: ["guides"] }, false).title, "User Guides");
  assert.equal(g.nav({ path: ["guides", "openssh"] }, false).title, "OpenSSH");
  assert.equal(g.nav({ path: ["guides", "password"] }, false).title, "Root Password");
  assert.equal(g.nav({ path: ["guides", "copying"] }, true).title, "Copying Files");
  assert.equal(g.nav({ path: ["guides", "faq", "app"] }, true).title, "FAQ");
  // lite has no OpenSSH or Root Password page: an old link shows the guide list
  assert.deepEqual(g.guidePage(["guides", "openssh"], true), { page: "list" });
  assert.deepEqual(g.guidePage(["guides", "password"], true), { page: "list" });
  assert.equal(g.guidePage(["guides", "faq", "tweak"], true).page, "guide", "a jailbreak answer is not in lite");
  assert.equal(g.guidePage(["guides", "faq", "tweak"], false).page, "answer");
  assert.equal(g.isLite("none"), true);
  assert.equal(g.isLite("iphoneos-arm64"), false);
});

test("F157: Home uses the lite guide rows while Not Jailbroken", async () => {
  const rows = home.homeLinks().find((s) => s.header === "User Guides").rows;
  // the tests run as the website with Settings > Device unset: Not Jailbroken
  assert.deepEqual(rows.map((r) => r.label), ["Frequently Asked Questions", "Copying Files to/from Device"]);
});

test("F157: the FAQ's groups, answer pages and their Next rows", () => {
  for (const lite of [false, true]) {
    const sections = g.faqSections(lite);
    assert.deepEqual(sections.map((s) => s.header), ["Getting Started", "Problems", "Sources"]);
    for (const s of sections) {
      for (const r of s.rows) {
        const id = r.href.split("/").at(-1);
        const a = g.answerFor(id, lite);
        assert.ok(a, id);
        assert.ok(a.a || a.steps?.length, id);
        for (const n of a.next) assert.ok(g.LINKS[n], `${id} -> ${n}`);
      }
    }
  }
  const full = g.FAQ.flatMap((f) => [...f.next, ...(f.liteNext ?? [])]);
  for (const place of ["device", "refresh", "installed", "add", "more", "help"]) assert.ok(full.includes(place), place);
  assert.equal(g.linkRow("device").href, "#/home/settings/device");
  assert.equal(g.linkRow("refresh").href, "#/sources");
  assert.equal(g.linkRow("installed").href, "#/installed");
  assert.equal(g.linkRow("add").href, "#/sources/manage/sources");
  assert.equal(g.linkRow("more").href, "#/sources/manage");
  assert.equal(g.linkRow("help").href, "#/home/help");

  // an answer page: the question heading, the answer in a cell, then Next
  const page = draw(["guides", "faq", "package"]);
  assert.equal(byClass(page, "guide-q")[0].textContent, "A package won't install");
  assert.equal(byClass(page, "guide-num").length, 3, "numbered steps");
  const next = byClass(page, "group-header").find((h) => h.textContent === "Next");
  assert.ok(next);
  const hrefs = all(next.parentNode).filter((x) => x.href).map((x) => x.href);
  assert.deepEqual(hrefs, ["#/home/settings/device", "#/sources"]);
  const prose = draw(["guides", "faq", "expired"], { lite: true });
  assert.match(byClass(prose, "guide-text")[0].textContent, /Settings > Signing/);
});

test("F157: OpenSSH's steps tick green when tapped, remembered per guide", async () => {
  const store = memStore();
  let page = draw(["guides", "openssh"], { store });
  let badges = byClass(page, "guide-tick");
  assert.deepEqual(badges.map((b) => b.textContent), ["1", "2", "3", "4"]);
  assert.ok(badges.every((b) => !b._cls.has("is-done")));
  await badges[0].click();
  await badges[2].click();
  assert.ok(badges[0]._cls.has("is-done"));
  assert.equal(badges[0].getAttribute("aria-pressed"), "true");
  assert.deepEqual(JSON.parse(store.m.get("cydian.guideSteps.openssh")), [1, 3]);
  await badges[2].click(); // untick
  assert.ok(!badges[2]._cls.has("is-done"));
  // drawn again: still ticked; another guide keeps its own
  page = draw(["guides", "openssh"], { store });
  badges = byClass(page, "guide-tick");
  assert.deepEqual(badges.map((b) => b._cls.has("is-done")), [true, false, false, false]);
  assert.ok(byClass(draw(["guides", "password"], { store }), "guide-tick").every((b) => !b._cls.has("is-done")));
  assert.deepEqual([...g.doneSteps("openssh", { getItem: () => "not json" })], []);
  // step 1's Install row opens OpenSSH's package page; Log In has Still alpine? -> Root Password
  const links = all(page).filter((x) => x.href).map((x) => x.href);
  assert.ok(links.includes("#/search/package%3Aopenssh"), links.join());
  assert.ok(links.includes("#/home/guides/password"));
  assert.ok(page.textContent.includes("Still alpine?"));
});

test("F157: Copy puts the command on the clipboard and says Copied", async () => {
  const copied = [];
  const copy = async (t) => { copied.push(t); };
  const page = draw(["guides", "openssh"], { copy });
  const [ssh] = byClass(page, "guide-copy");
  assert.ok(byClass(page, "guide-term")[0].textContent.includes(g.SSH_EXAMPLE));
  await ssh.click();
  assert.deepEqual(copied, [g.SSH_EXAMPLE]);
  assert.equal(ssh.textContent, "Copied");
  const pw = draw(["guides", "password"], { copy });
  for (const b of byClass(pw, "guide-copy")) await b.click();
  assert.deepEqual(copied.slice(1), ["passwd", "sudo passwd root", "exit"]);
  assert.equal(byClass(pw, "guide-warning").length, 1, "one warning row");
  // the transcript holds the whole session, and has no Copy of its own
  const transcript = byClass(pw, "guide-term")[0];
  assert.match(transcript.textContent, /passwd.*sudo passwd root.*exit/s);
  assert.equal(byClass(transcript, "guide-copy").length, 0);
  // a failed copy doesn't claim Copied
  const failing = draw(["guides", "openssh"], { copy: async () => { throw new Error("denied"); } });
  const b = byClass(failing, "guide-copy")[0];
  await b.click();
  assert.equal(b.textContent, "Copy");
});

test("F157: Copying Files: three segments when jailbroken, the no-jailbreak page alone in lite", async () => {
  const page = draw(["guides", "copying"]);
  const segs = byClass(page, "segment");
  assert.deepEqual(segs.map((s) => s.textContent), ["On iPhone", "Computer", "No Jailbreak"]);
  const panes = byClass(page, "guide-pane");
  assert.deepEqual(panes.map((p) => p.hidden), [false, true, true]);
  assert.match(panes[0].textContent, /Filza File Manager/);
  await segs[1].click();
  assert.deepEqual(panes.map((p) => p.hidden), [true, false, true]);
  assert.ok(segs[1]._cls.has("selected"));
  for (const v of ["SFTP", "iPhone's IP", "mobile", "22", "Cyberduck", "WinSCP", "FileZilla"]) assert.ok(panes[1].textContent.includes(v), v);
  assert.ok(all(panes[1]).some((x) => x.href === "#/home/guides/openssh"));
  const lite = draw(["guides", "copying"], { lite: true });
  assert.equal(byClass(lite, "segmented").length, 0);
  for (const v of ["Files", "AirDrop", "LocalSend", "Finder", "iTunes File Sharing"]) assert.ok(lite.textContent.includes(v), v);
});

// Everything the lite build can render under guides/: no jailbreak guide, and no jailbreak-only word.
const JAILBREAK_WORDS = /jailbr|tweak|\bapt\b|Settings > Device|rootful|rootless|\bssh\b|openssh|root password|sudo|alpine|filza|respring|substrate|cydia\b/i;
test("F157: the lite build's rendered guides name nothing jailbreak-only", () => {
  const paths = [["guides"], ...g.guideIds(true).map((id) => ["guides", id]),
    ...g.faqFor(true).map((f) => ["guides", "faq", f.id]), ["guides", "openssh"], ["guides", "password"]];
  for (const p of paths) {
    const page = draw(p, { lite: true });
    const text = page.textContent;
    assert.ok(text.length > 20, p.join("/"));
    assert.doesNotMatch(text, JAILBREAK_WORDS, p.join("/"));
    const hrefs = all(page).filter((x) => x.href).map((x) => x.href).join(" ");
    assert.doesNotMatch(hrefs, /openssh|password|settings\/device|\/help/, p.join("/"));
    assert.doesNotMatch(g.nav({ path: p }, true).title, JAILBREAK_WORDS);
  }
  for (const f of g.faqFor(true)) assert.doesNotMatch(f.q, JAILBREAK_WORDS, f.id);
  // and the full set does carry them: the test would see them
  assert.match(draw(["guides", "faq", "kind"]).textContent, JAILBREAK_WORDS);
  assert.ok(g.faqFor(true).some((f) => f.q === "An app won't install"));
  assert.ok(g.faqFor(true).some((f) => f.q === "My certificate expired"));
  assert.ok(g.faqFor(true).some((f) => f.q === "Adding a source"));
});
