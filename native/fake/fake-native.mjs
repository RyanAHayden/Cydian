// The Swift side of the bridge (native/Sources/Apt.swift) in node, over a fixture tree instead of a phone, for tests
// without a device (N3; N4's queue and console reuse it). It answers the same methods with the same shapes and
// error strings, and runs native/fake/cydian-helper where the app runs the real helper as root.
//
//   const fx = makeFixture();                       // a scratch copy of native/fake/fixture/
//   const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: { "https://r/x": "body" } });
//   globalThis.cydianNative = native;                // what native/bridge.js would have set up
//   ...                                              fx.cleanup()
//
// `net`: URL -> string | { status, body, headers } for net.fetch / net.packages (a missing URL answers 404;
// net: null means offline, every request fails with "network: ..."). `env` goes to the helper (FAKE_FAIL=update).
// F63: helper.run of apply-ask gives the helper a stdin pipe, which helper.answer { answer: keep | new } writes to.
// F59: ipa.install downloads into `ipaDir` (default: beside the prefix, ipa-cache/) and runs install-ipa there.
// SPDX-License-Identifier: GPL-3.0-or-later
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FAKE_HELPER = join(HERE, "cydian-helper");
export const FIXTURE = join(HERE, "fixture");

export function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "cydian-fake-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return { dir, prefix: join(dir, "prefix"), remote: join(dir, "remote"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

export function createFakeNative({ prefix, remote, net = {}, env = {}, helper = FAKE_HELPER, mode = "jailbreak",
  ipaDir = join(dirname(prefix ?? "."), "ipa-cache") } = {}) {
  const calls = [];
  let answerTo = null; // F63: the running apply-ask's stdin
  const fail = (msg) => Promise.reject(new Error(msg));

  function netGet(url) {
    if (net === null) return null;
    const hit = net[url];
    if (hit === undefined) return { status: 404, body: "" };
    return typeof hit === "string" ? { status: 200, body: hit } : { status: 200, body: "", ...hit };
  }

  const methods = {
    "apt.sources"() {
      const etc = join(prefix, "etc/apt");
      const out = [];
      const main = read(join(etc, "sources.list"));
      if (main != null) out.push({ path: join(etc, "sources.list"), text: main });
      const d = join(etc, "sources.list.d");
      if (existsSync(d)) {
        for (const name of readdirSync(d).sort()) {
          if (/\.(list|sources)$/.test(name)) out.push({ path: join(d, name), text: read(join(d, name)) });
        }
      }
      return out;
    },
    "apt.list"({ name }) {
      if (typeof name !== "string" || !name || name.includes("/") || name.startsWith(".")) return fail("bad_url: bad list name");
      return read(join(prefix, "var/lib/apt/lists", name));
    },
    "apt.dpkgStatus": () => read(join(prefix, "var/lib/dpkg/status")),
    "net.fetch"({ url }) {
      if (!/^https?:\/\//i.test(url ?? "")) return fail("bad_url: not an http(s) URL");
      const r = netGet(url);
      if (!r) return fail("network: The Internet connection appears to be offline.");
      return { status: r.status, headers: r.headers ?? {}, body: Buffer.from(r.body).toString("base64") };
    },
    "net.packages"({ dir }) {
      for (const name of ["Packages.xz", "Packages.gz", "Packages"]) {
        const r = netGet(dir + name);
        if (!r) return fail("network: The Internet connection appears to be offline.");
        if (r.status < 400 && name === "Packages") return { text: r.body, source: dir + name };
      }
      return fail(`not_found: no Packages index in ${dir}`);
    },
    "helper.run"({ words, stream }, onEvent) {
      // Like Helper.run in Apt.swift: no helper at its path, or one that can't start, is a "helper:" error.
      if (!existsSync(helper)) return fail(`helper: cydian-helper is not installed at ${helper}`);
      return new Promise((resolve, reject) => {
        const child = spawn(helper, words, {
          env: { PATH: process.env.PATH, CYDIAN_PREFIX: prefix, FAKE_REMOTE: remote, CYDIAN_IPA_DIR: ipaDir, ...env },
          // F63: apply-ask gets a stdin pipe for helper.answer, as Helper.run in Apt.swift gives it.
          stdio: [words[0] === "apply-ask" ? "pipe" : "ignore", "pipe", "pipe", "pipe"],
        });
        if (child.stdin) {
          child.stdin.on("error", () => {}); // an answer after the helper ended
          answerTo = child.stdin;
        }
        const text = { out: "", err: "" };
        const pending = { out: "", err: "", status: "" };
        const feed = (fd) => (chunk) => {
          const s = chunk.toString("utf8");
          if (fd !== "status") text[fd] += s;
          if (!stream || !onEvent) return;
          const lines = (pending[fd] + s).split("\n");
          pending[fd] = lines.pop();
          for (const line of lines) onEvent({ fd, line });
        };
        child.stdout.on("data", feed("out"));
        child.stderr.on("data", feed("err"));
        child.stdio[3].on("data", feed("status"));
        child.on("error", (e) => reject(new Error(`helper: can't start cydian-helper: ${e.message}`)));
        child.on("close", (code) => {
          if (child.stdin) { if (answerTo === child.stdin) answerTo = null; child.stdin.destroy(); }
          if (stream && onEvent) for (const fd of ["out", "err", "status"]) if (pending[fd]) onEvent({ fd, line: pending[fd] });
          resolve({ code: code ?? 128, stdout: text.out, stderr: text.err });
        });
      });
    },
    // F63: like Helper.answer in Apt.swift: keep -> "N", new -> "Y" on the running apply-ask's stdin.
    "helper.answer"({ answer }) {
      const line = { keep: "N\n", new: "Y\n" }[answer];
      if (!line) return fail("helper: answer is keep or new");
      if (!answerTo) return fail("helper: no install is waiting for an answer");
      answerTo.write(line);
      return true;
    },
    // F59: like IPAInstall.run in Apt.swift: download as <UUID>.ipa into ipaDir, cydian-helper install-ipa, remove
    // the download; the helper's exit code picks the error code.
    async "ipa.install"({ url, stream }, onEvent) {
      if (mode !== "jailbreak") return fail("sideload: the sideload build installs IPAs through signing.install");
      if (!/^https?:\/\//i.test(url ?? "")) return fail("bad_url: not an http(s) URL");
      mkdirSync(ipaDir, { recursive: true, mode: 0o700 });
      if (stream && onEvent) onEvent({ fd: "status", line: "dlstatus:ipa:0:Downloading" });
      const r = netGet(url);
      if (!r) return fail("network: The Internet connection appears to be offline.");
      if (r.status >= 400) return fail(`not_found: HTTP ${r.status} for ${url}`);
      const path = join(ipaDir, `${randomUUID().toUpperCase()}.ipa`);
      writeFileSync(path, Buffer.from(r.body));
      let res;
      try {
        res = await call("helper.run", { words: ["install-ipa", path], stream }, onEvent);
      } finally {
        rmSync(path, { force: true });
      }
      if (res.code === 0) {
        const id = res.stdout.split("\n").filter((l) => l.startsWith("Installed ")).pop();
        return { code: 0, stdout: res.stdout, stderr: res.stderr, bundleId: id ? id.slice(10) : "" };
      }
      const why = res.stderr.split("\n").filter((l) => l.startsWith("cydian-helper: ")).pop();
      const kind = { 64: "bad_ipa", 69: "no_adhoc", 77: "helper" }[res.code] ?? "install";
      return fail(`${kind}: ${why ? why.slice(15) : `cydian-helper exited with ${res.code}`}`);
    },
  };

  async function call(method, params = {}, onEvent) {
    calls.push({ method, params });
    const m = methods[method];
    if (!m) throw new Error(`unknown method ${method}`);
    const v = await m(params, onEvent);
    return v === undefined ? null : v;
  }

  return {
    calls,
    call,
    emit() {},
    helper: (words, onEvent) => call("helper.run", { words, stream: Boolean(onEvent) }, onEvent),
    dpkgStatus: () => call("apt.dpkgStatus"),
  };
}
