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
// SPDX-License-Identifier: GPL-3.0-or-later
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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

export function createFakeNative({ prefix, remote, net = {}, env = {}, helper = FAKE_HELPER } = {}) {
  const calls = [];
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
          env: { PATH: process.env.PATH, CYDIAN_PREFIX: prefix, FAKE_REMOTE: remote, ...env },
          stdio: ["ignore", "pipe", "pipe", "pipe"],
        });
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
          if (stream && onEvent) for (const fd of ["out", "err", "status"]) if (pending[fd]) onEvent({ fd, line: pending[fd] });
          resolve({ code: code ?? 128, stdout: text.out, stderr: text.err });
        });
      });
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
