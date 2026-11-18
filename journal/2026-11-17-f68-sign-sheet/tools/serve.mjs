// F68 walk-through server: web/app/ as the sideload app sees it, with a fake cydianNative (mode "sideload") whose
// signing.* calls answer F14's shapes (native/Sources/Sideload.swift) from fixtures: a certificate in the Keychain,
// the local CA trusted, Delta to inspect (two extensions, two entitlements the profile lacks), two signed apps.
// Usage: node serve.mjs [port]   SPDX-License-Identifier: GPL-3.0-or-later
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";

const ROOT = new URL("../../../web/app/", import.meta.url).pathname;
const port = Number(process.argv[2] || 8782);
const REVOKED = process.env.REVOKED === "1";

const SHIM = `<script>
(function (g) {
  const soon = new Date(Date.now() + 4 * 864e5).toISOString();
  const later = new Date(Date.now() + 120 * 864e5).toISOString();
  const identity = { name: "iPhone Developer: Jane Appleseed (AB12CD34EF)", team: "Jane Appleseed", teamId: "AB12CD34EF",
    notAfter: later, signatureExpires: ${REVOKED ? "soon" : "later"},
    revocation: ${REVOKED ? '{ status: "revoked", revokedAt: "2026-11-12T09:00:00Z", checked: new Date().toISOString() }' : '{ status: "good", checked: new Date().toISOString() }'},
    profile: { name: "Cydian Dev", kind: "Development", appId: "AB12CD34EF.*", expires: later, devices: 3 } };
  const answers = {
    "app.info": { version: "0.9.0", cf: 1953.1 },
    "signing.status": { identity, trust: { ca: true, trusted: true, name: "Cydian Local CA" } },
    "signing.inspect": { token: "tok1", icon: null, missing: ["aps-environment", "com.apple.security.application-groups"],
      signsAs: "com.rileytestut.Delta", profileKind: "Development",
      app: { name: "Delta", bundleId: "com.rileytestut.Delta", version: "1.6.2", minimumOS: "14.0", size: 52428800,
        entitlements: { "application-identifier": "6XVY5G3U44.com.rileytestut.Delta", "aps-environment": "production",
          "com.apple.security.application-groups": ["group.com.rileytestut.Delta"], "get-task-allow": false },
        permissions: [{ key: "NSCameraUsageDescription", label: "Camera", text: "Delta uses the camera to scan QR codes." },
          { key: "NSPhotoLibraryUsageDescription", label: "Photos", text: "Choose a picture for a game's artwork." }],
        extensions: [{ path: "PlugIns/DeltaWidget.appex", bundleId: "com.rileytestut.Delta.Widget", name: "Delta Widget", point: "com.apple.widgetkit-extension" },
          { path: "PlugIns/DeltaShare.appex", bundleId: "com.rileytestut.Delta.Share", name: "Import to Delta", point: "com.apple.share-services" }] } },
    "signing.install": { bundleId: "com.rileytestut.Delta", name: "Delta", version: "1.6.2" },
    "signing.progress": { installed: true },
    "signing.installed": { apps: [
      { bundleId: "com.rileytestut.Delta", name: "Delta", version: "1.6.2", expires: soon },
      { bundleId: "xyz.skitty.Aidoku", name: "Aidoku", version: "0.6.10", expires: later }], next: { expires: soon, apps: ["Delta"] } },
    "signing.checkCertificate": { status: "good", checked: new Date().toISOString() },
    "signing.remind": { at: soon },
    "signing.resignAll": { done: ["com.rileytestut.Delta"], failed: [] },
    "signing.forget": { apps: [] },
  };
  g.__calls = [];
  g.cydianApp = true;
  g.cydianNative = { mode: "sideload", emit() {}, async call(method, params) {
    g.__calls.push({ method, params });
    if (method in answers) return JSON.parse(JSON.stringify(answers[method]));
    if (method === "apt.sources") return [];
    throw Object.assign(new Error("unknown method " + method), { code: "internal" });
  } };
})(globalThis);
</script>`;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "");
  if (!path || path.endsWith("/")) path += "index.html";
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  let body = readFileSync(file);
  if (path === "index.html") body = body.toString().replace('<script src="theme-boot.js">', SHIM + '<script src="theme-boot.js">');
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(body);
}).listen(port, "127.0.0.1", () => console.log(`serving on ${port}`));
