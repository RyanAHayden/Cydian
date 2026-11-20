// F69, F75: the Signing walkthrough's step states (screens/signing.js stepStates) from signing.status answers and the
// Signing Server: just the certificate and a server, nothing about trusting a certificate of iFizBox's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stepStates, allDone, STEPS, missingStep, serverReady, openAt, walkOpen } from "./signing.js";

const ident = { name: "Apple Development: Ryan (ABCDE12345)", team: "ABCDE12345" };
const st = (identity, extra = {}) => ({ mode: "sideload", identity, ...extra });
const SERVER = "https://ifizbox.com";
const done = (states) => Object.fromEntries(states.map((s) => [s.id, s.done]));
const opened = (states) => states.filter((s) => s.open).map((s) => s.id);
const current = (states) => states.find((s) => s.current)?.id ?? null;

test("two numbered steps in order: the certificate, then the server", () => {
  const s = stepStates(null, { server: SERVER });
  assert.deepEqual(s.map((x) => [x.n, x.id]), [[1, "certificate"], [2, "server"]]);
  assert.deepEqual(STEPS.map((x) => x.id), ["certificate", "server"]);
});

test("with the default server set (ifizbox.com): only the certificate is needed", () => {
  for (const status of [null, undefined, st(null), st(null, { identityProblem: "gone" })]) {
    const s = stepStates(status, { server: SERVER });
    assert.deepEqual(done(s), { certificate: false, server: true });
    assert.equal(current(s), "certificate");
    assert.deepEqual(opened(s), ["certificate"]);
    assert.equal(allDone(s), false);
    assert.equal(missingStep(status, SERVER), "certificate");
  }
  const s = stepStates(st(ident), { server: SERVER });
  assert.deepEqual(done(s), { certificate: true, server: true });
  assert.equal(allDone(s), true);
  assert.deepEqual(opened(s), []);
  assert.equal(missingStep(st(ident), SERVER), null);
});

test("a status the bridge hands over as JSON text counts the same", () => {
  assert.equal(missingStep(JSON.stringify(st(ident)), SERVER), null);
});

test("no server (or one installs can't use): the server step is required and next once the certificate is in", () => {
  for (const server of [null, "", "http://sign.example.org", "not a url at all//"]) {
    assert.equal(serverReady(server), false, String(server));
    const s = stepStates(st(ident), { server });
    assert.deepEqual(done(s), { certificate: true, server: false });
    assert.equal(current(s), "server");
    assert.equal(missingStep(st(ident), server), "server");
  }
  assert.equal(missingStep(null, null), "certificate"); // both missing: the certificate first
  assert.equal(serverReady("sign.example.org"), true); // typed without https://: normalised to https
});

test("the user's own expand/collapse taps win over the default", () => {
  const s = stepStates(st(null), { server: SERVER, open: { certificate: false, server: true } });
  assert.deepEqual(opened(s), ["server"]);
});

test("openAt: Install's redirect opens just the missing step", () => {
  walkOpen.certificate = false;
  walkOpen.server = true;
  openAt("certificate");
  assert.deepEqual(opened(stepStates(st(null), { server: SERVER, open: walkOpen })), ["certificate"]);
  openAt("server");
  assert.deepEqual(opened(stepStates(st(ident), { server: null, open: walkOpen })), ["server"]);
});

test("nothing on the page or in the code still talks about trusting iFizBox's certificate", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const parts = (await readdir(new URL("../signing/", import.meta.url))).filter((f) => f.endsWith(".js")).map((f) => `../signing/${f}`);
  for (const f of ["./signing.js", "./settings.js", "../signing-client.js", ...parts, "../core/signing.js", "../signing.css"]) {
    const text = await readFile(new URL(f, import.meta.url), "utf8");
    const hit = text.match(/Certificate Trust Settings|Local Install|signing\.(trust|resetTrust|testServer)|Test Install Server|setUpTrust|mobileconfig|localInstallSection/);
    assert.equal(hit?.[0] ?? null, null, f);
  }
});

// F78: the certificate step shows the user's Files picker screenshot for the current theme, in place of a drawing.
test("the certificate step's picture is the screenshot for <html data-theme>", async () => {
  const { picture, shotFor } = await import("./signing.js");
  const { existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  for (const t of ["light", "dark"]) {
    assert.match(shotFor(t), new RegExp(`/icons/steps/select-files-${t}\\.jpg$`));
    assert.ok(existsSync(fileURLToPath(shotFor(t))), `${t} screenshot is in the repo`);
  }
  assert.equal(shotFor(null), shotFor("light"));
  const el = (tag) => ({ tagName: tag.toUpperCase(), className: "", children: [], append(...c) { this.children.push(...c); } });
  const saved = globalThis.document;
  try {
    for (const t of ["light", "dark"]) {
      globalThis.document = { createElement: el, documentElement: { getAttribute: (a) => (a === "data-theme" ? t : null) } };
      const fig = picture();
      assert.equal(fig.className, "step-picture");
      assert.equal(fig.children.length, 1);
      const [img] = fig.children;
      assert.equal(img.tagName, "IMG");
      assert.equal(img.className, "step-shot");
      assert.equal(img.src, shotFor(t));
      assert.ok(img.alt);
    }
  } finally {
    globalThis.document = saved;
  }
});
