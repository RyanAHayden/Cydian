// F57: a Sileo Payment Provider vendor in node (https://developer.getsileo.app/payment-providers), for testing the
// shell's paid-package calls without Havoc or Chariz. createFakeNative({ vendors: [vendor] }) sends net.request,
// auth.session and paid.install's download here.
//
//   const vendor = createFakeVendor({ packages: { "com.example.paid": { price: "$1.99", version: "1.0" } } });
//   vendor.base                      https://vendor.test/api/sileo/  (what the repo's payment_endpoint holds)
//   vendor.handle(req)               {method, url, headers, body} -> {status, headers, body} | undefined (not ours)
//   vendor.authenticate(url)         the callback URL the sign-in page ends at (sileo://authentication_success?…),
//                                    or null when `cancelSignIn` is set (the user closed the sheet)
//   vendor.download(url)             the one-time .deb: {status, body}; a second fetch is 404, as vendors do
//   vendor.log                       every request it got, parsed: {method, path, body}
//
// A ".deb" here is "!<arch>\n" and then a control stanza (Package, Version, Architecture), which
// native/fake/ifizbox-helper's install-paid reads. Purchases need the payment secret the sign-in handed out;
// `purchaseNeedsAction` makes purchase answer status 1 with a URL that auth.session "completes".
// SPDX-License-Identifier: GPL-3.0-or-later
import { randomUUID } from "node:crypto";

export function createFakeVendor({ base = "https://vendor.test/api/sileo/", name = "Fake Vendor", packages = {},
  udid = null, purchaseNeedsAction = false, cancelSignIn = false } = {}) {
  const log = [];
  const tokens = new Map(); // token -> { secret, udid, purchased: Set }
  const downloads = new Map(); // one-time URL path -> deb text
  const json = (status, o) => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(o) });
  const origin = new URL(base).origin;

  const vendor = {
    base, log, packages,
    get cancelSignIn() { return cancelSignIn; },
    set cancelSignIn(v) { cancelSignIn = v; },

    authenticate(url) {
      const u = new URL(url);
      if (!url.startsWith(base + "authenticate?")) return null;
      if (cancelSignIn) return null;
      if (udid && u.searchParams.get("udid") !== udid) return "sileo://authentication_failure";
      const token = randomUUID(), secret = randomUUID();
      tokens.set(token, { secret, udid: u.searchParams.get("udid"), model: u.searchParams.get("model"), purchased: new Set() });
      return `sileo://authentication_success?token=${token}&payment_secret=${secret}`;
    },

    // A purchase that needed the browser: the sheet ends at payment_completed and the package is bought.
    completePayment(url) {
      const m = /\/pay\/([^/]+)\/([^/?]+)$/.exec(new URL(url).pathname);
      const t = m && tokens.get(m[1]);
      if (!t) return null;
      t.purchased.add(decodeURIComponent(m[2]));
      return "sileo://payment_completed";
    },

    handle({ method, url, body }) {
      if (!url.startsWith(base)) return undefined;
      const path = url.slice(base.length);
      let b = {};
      try { b = body ? JSON.parse(body) : {}; } catch { return json(400, { error: "bad JSON" }); }
      log.push({ method, path, body: b });
      if (method === "GET" && path === "info") {
        return json(200, { name, icon: `${origin}/icon.png`, description: "A vendor for tests",
          authentication_banner: { message: "Sign in to buy packages.", button: "Sign In" } });
      }
      if (method !== "POST") return json(405, { error: "method not allowed" });
      const user = b.token ? tokens.get(b.token) : null;
      if (path === "user_info") {
        if (!user) return json(401, { error: "Signed out", invalidate: true });
        return json(200, { items: [...user.purchased], user: { name: "Test", email: "test@vendor.test" } });
      }
      if (path === "sign_out") { tokens.delete(b.token); return json(200, { success: true }); }
      const m = /^package\/([^/]+)\/(info|purchase|authorize_download)$/.exec(path);
      const id = m && decodeURIComponent(m[1]);
      const pkg = id && packages[id];
      if (!pkg) return json(404, { error: "No such package" });
      if (m[2] === "info") return json(200, { price: pkg.price, purchased: Boolean(user?.purchased.has(id)), available: true });
      if (!user) return json(401, { error: "Please sign in again", invalidate: true });
      if (m[2] === "purchase") {
        if (b.payment_secret !== user.secret) return json(403, { error: "Wrong payment secret" });
        if (purchaseNeedsAction) return json(200, { status: 1, url: `${origin}/pay/${b.token}/${encodeURIComponent(id)}` });
        user.purchased.add(id);
        return json(200, { status: 0 });
      }
      if (!user.purchased.has(id)) return json(403, { error: "You haven't bought this package" });
      if (b.version && b.version !== pkg.version) return json(404, { error: "No such version" });
      const one = `/dl/${randomUUID()}.deb`;
      downloads.set(one, `!<arch>\nPackage: ${pkg.control?.Package ?? id}\nVersion: ${pkg.control?.Version ?? pkg.version}\n` +
        `Architecture: iphoneos-arm64\nName: ${id}\n`);
      return json(200, { url: origin + one });
    },

    download(url) {
      const u = new URL(url);
      if (u.origin !== origin) return undefined;
      const deb = downloads.get(u.pathname);
      if (deb == null) return { status: 404, body: "" };
      downloads.delete(u.pathname); // one time
      return { status: 200, body: deb };
    },
  };
  return vendor;
}
