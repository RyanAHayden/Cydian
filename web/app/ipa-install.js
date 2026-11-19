// F67: the jailbreak build's IPA install over F59's bridge call (native/Sources/Apt.swift IPAInstall):
//
//   ipaInstallAvailable()            -> true in the jailbreak build (the sideload build keeps signing.install)
//   await installIpa(url, onEvent)   -> { code: 0, stdout, stderr, bundleId }; onEvent({ fd, line }) streams the
//                                       helper's lines; rejects with Error("<code>: <message>") and err.code
//                                       (core/ipainstall.js ipaError explains them)
//
// It talks to ifizboxNative directly (as signing-client.js does), not through backend-native.js, whose error mapping
// would fold no_adhoc and bad_ipa into "network".
// SPDX-License-Identifier: GPL-3.0-or-later
import { detectMode } from "./core/settings.js";
import { ipaStatus, ipaError } from "./core/ipainstall.js";

export const ipaInstallAvailable = (mode = detectMode()) => mode === "jailbreak" && Boolean(globalThis.ifizboxNative?.call);

export async function installIpa(url, onEvent = null, { native = globalThis.ifizboxNative } = {}) {
  if (!native?.call) throw Object.assign(new Error("sideload: no native bridge"), { code: "sideload" });
  try {
    return await native.call("ipa.install", { url, stream: Boolean(onEvent) }, onEvent ?? undefined);
  } catch (e) {
    const msg = e?.message || String(e);
    const m = msg.match(/^([a-z_]+): /);
    throw Object.assign(e instanceof Error ? e : new Error(msg), { code: e?.code || m?.[1] || "install" });
  }
}

// The console's run, without the DOM (screens/ipa-install.js draws `view`; the tests bring their own):
//   view.line(type, text)   type "info" | "status" | "error" | "warning": one console line
//   view.status(text)       the white line over the bar
//   view.progress(percent)  0..100
// Resolves { ok, bundleId, error: core/ipainstall.js ipaError's answer or null, log: the console's text, cancelled }.
// F188: `signal` (the page's Cancel) ends the run at once: it resolves { ok: false, cancelled: true } without waiting
// for ipa.install and nothing more is drawn (F196: the page also asks the shell's ipa.cancel to stop it,
// screens/ipa-install.js stopIpaInstall).
export async function runIpaInstall({ url, name = "" }, view, { native = globalThis.ifizboxNative, signal = null } = {}) {
  const log = [];
  const line = (type, text) => {
    log.push(type === "error" ? `E: ${text}` : type === "status" ? `» ${text}` : text);
    view.line(type, text);
  };
  view.progress(0);
  view.status("Preparing");
  line("info", url);
  let result = null;
  let error = null;
  let lastStatus = "";
  const said = new Set(); // the helper's own "ifizbox-helper: " lines, not repeated at the end
  const stopped = () => Boolean(signal?.aborted);
  const cancelled = () => {
    log.push("» Cancelled");
    return { ok: false, bundleId: "", error: null, log: log.join("\n"), cancelled: true };
  };
  if (stopped()) return cancelled();
  const aborted = new Promise((resolve) => signal?.addEventListener?.("abort", () => resolve(true), { once: true }));
  try {
    const job = installIpa(url, ({ fd, line: raw }) => {
      if (stopped()) return;
      const text = String(raw ?? "").replace(/\s+$/, "");
      if (!text) return;
      if (fd === "status") {
        const s = ipaStatus(text);
        if (!s) { line("info", text); return; }
        if (s.error) { line("error", s.text); return; }
        if (s.percent != null) view.progress(s.percent);
        view.status(s.text);
        if (s.text !== lastStatus) line("status", s.text); // installd repeats "Installing" with each percent
        lastStatus = s.text;
        return;
      }
      if (fd === "err" && /^ifizbox-helper: /.test(text)) said.add(text.slice(16));
      line(fd === "err" && /^ifizbox-helper: /.test(text) ? "error" : fd === "err" && /^(W:|warning)/i.test(text) ? "warning" : "info", text);
    }, { native });
    job.catch(() => {}); // after Cancel no one waits for it
    result = await (signal ? Promise.race([job, aborted.then(() => null)]) : job);
  } catch (e) {
    if (!stopped()) error = ipaError(e, name);
  }
  if (stopped()) return cancelled();
  if (error) {
    const first = error.code === "no_adhoc" ? error.detail || error.title : error.message;
    // B72: not again when it is the helper's own line, word for word (no_adhoc, os_version)
    if (!(first === error.detail && said.has(error.detail))) line("error", first);
    for (const l of error.lines) line(error.code === "no_adhoc" ? "warning" : "info", l);
    view.status(error.title);
  } else {
    const id = result?.bundleId || "";
    line("status", id ? `Installed ${name || id} (${id})` : `Installed ${name || "the app"}`);
    view.status("Done");
  }
  view.progress(100);
  return { ok: !error, bundleId: result?.bundleId || "", error, log: log.join("\n"), cancelled: false };
}
