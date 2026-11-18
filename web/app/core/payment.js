// Paid packages through Sileo's Payment Provider API (F20; https://developer.getsileo.app/payment-providers).
// Pure JS, no DOM, no network of its own: the caller hands in `request`, which sends what buildRequest() describes.
//
//   isCommercial(stanza | tagString)       -> true for packages tagged cydia::commercial (the only ones asked about)
//   paymentEndpointUrl(source)             -> "<repo>/payment_endpoint"
//   parseEndpoint(text)                    -> the vendor's https base URL (with a trailing /), or null
//   buildRequest(base, action, opts)       -> { method, url, headers, body }  (body a JSON string, or null)
//       actions: info, user_info, sign_out, package_info, purchase, authorize_download
//   authenticateUrl(base, { udid, model }) -> the sign-in page (opened in an auth session, not fetched)
//   parseCallback(url)                     -> { kind: "authentication_success", token, secret }
//                                             | { kind: "payment_completed" } | null
//   isFreePrice(price)                     -> true for "FREE" / "free" (B13)
//   parseReply(status, json)               -> { ok, data, error, recoveryUrl, invalidate }
//   createPaymentClient({ base, request, device, credentials })  the vendor's calls, signed in or not
//   createCredentialStore({ storage, secure })                    token and payment secret per vendor
//
// Checked live on 2026-11-17 (journal/2026-11-17-f20-repo-extras): repo.chariz.com/payment_endpoint ->
// https://chariz.com/api/sileo/, havoc.app/payment_endpoint -> https://havoc.app/api/sileo/; both answer GET /info
// and POST /package/<id>/info in the spec's shape ({"price":"$1.99","purchased":false,"available":true}), and
// /authenticate?udid&model sends the browser to their own sign-in page. Neither sends CORS headers, so the page
// can't call them itself: the app sends them through the shell (net.request), the site doesn't call them at all.
//
// Sign-in: the vendor finishes at sileo://authentication_success?token=…&payment_secret=…, a scheme its server
// writes, not one Cydian picks. The shell's auth session catches that URL (ASWebAuthenticationSession's
// callbackURLScheme "sileo" needs no registered scheme) and hands it back; a cydian:// link with the same path
// (cydian://authentication_success?… or cydian://payment/authentication_success?…) is read the same way, for a
// vendor that lets the client name its own callback.

const COMMERCIAL_TAG = "cydia::commercial";
const CALLBACK_SCHEMES = ["sileo:", "cydian:"];
const PKG = /^[a-z0-9][a-z0-9+.-]*$/i;

export function isCommercial(st) {
  const tag = typeof st === "string" ? st : st?.tag ?? st?.Tag ?? "";
  return String(tag).split(",").some((t) => t.trim().toLowerCase() === COMMERCIAL_TAG);
}

export function paymentEndpointUrl(source) {
  const uri = String(source?.uri ?? "");
  if (!/^https?:\/\//i.test(uri)) return null;
  return uri.replace(/\/*$/, "/") + "payment_endpoint";
}

// The endpoint file is plain text, one URL. The spec says vendors must use HTTPS; anything else is refused, as is
// a URL with credentials or a query (requests are built by appending paths to it).
export function parseEndpoint(text) {
  const line = String(text ?? "").trim().split(/\s+/)[0] ?? "";
  let u;
  try { u = new URL(line); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || !u.hostname) return null;
  return u.href.replace(/\/*$/, "/");
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

function pkgPath(id) {
  if (!PKG.test(String(id ?? ""))) throw new Error(`not a package name: ${id}`);
  return `package/${encodeURIComponent(id)}/`;
}

// The request one call sends. `opts`: { token, secret, udid, device, packageId, version, repo, architecture }.
// Like Sileo and Zebra (B10, docs/sileo-zebra.md), every POST but sign_out carries udid and device, and
// authorize_download the package's architecture, so a vendor serving rootful and rootless debs picks the right one.
// Fields the spec marks optional (token on package_info) are left out when unknown rather than sent empty.
export function buildRequest(base, action, opts = {}) {
  const b = parseEndpoint(base);
  if (!b) throw new Error(`not an https payment endpoint: ${base}`);
  const { token, secret, udid, device, packageId, version, repo, architecture } = opts;
  const who = () => clean({ token, udid, device });
  let path, body = null, method = "POST";
  switch (action) {
    case "info": method = "GET"; path = "info"; break;
    case "user_info": need(token, "token"); path = "user_info"; body = who(); break;
    case "sign_out": need(token, "token"); path = "sign_out"; body = { token }; break;
    case "package_info": path = pkgPath(packageId) + "info"; body = who(); break;
    case "purchase":
      need(token, "token"); need(secret, "payment secret");
      path = pkgPath(packageId) + "purchase"; body = { ...clean({ token, udid, device }), payment_secret: String(secret) }; break;
    case "authorize_download":
      need(token, "token");
      path = pkgPath(packageId) + "authorize_download"; body = clean({ token, udid, device, version, repo, architecture }); break;
    default: throw new Error(`unknown payment action: ${action}`);
  }
  return { method, url: b + path, headers: method === "GET" ? { Accept: "application/json" } : { ...JSON_HEADERS },
    body: body && JSON.stringify(body) };
}

function need(v, what) {
  if (v == null || v === "") throw new Error(`payment: no ${what} (sign in first)`);
}

function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v != null && v !== "") out[k] = String(v);
  return out;
}

export function authenticateUrl(base, { udid = "", model = "" } = {}) {
  const b = parseEndpoint(base);
  if (!b) throw new Error(`not an https payment endpoint: ${base}`);
  return `${b}authenticate?${new URLSearchParams({ udid, model })}`;
}

// sileo://authentication_success?token=…&payment_secret=… (host form) and cydian://payment/authentication_success
// (path form) both parse; so does sileo://payment_completed.
export function parseCallback(url) {
  let u;
  try { u = new URL(String(url ?? "")); } catch { return null; }
  if (!CALLBACK_SCHEMES.includes(u.protocol)) return null;
  const words = [u.hostname, ...u.pathname.split("/")].filter(Boolean).map((w) => w.toLowerCase());
  const what = words.filter((w) => w !== "payment").pop();
  if (what === "authentication_success") {
    const token = u.searchParams.get("token");
    const secret = u.searchParams.get("payment_secret");
    if (!token || !secret) return null;
    return { kind: "authentication_success", token, secret };
  }
  if (what === "payment_completed") return { kind: "payment_completed" };
  return null;
}

// Spec: an `error` string (or success: false) means failure; `recovery_url` gives a More Info button; `invalidate`
// tells the client to forget its credentials. A non-2xx answer without a body is a failure too.
export function parseReply(status, json) {
  const j = json && typeof json === "object" && !Array.isArray(json) ? json : {};
  const recoveryUrl = typeof j.recovery_url === "string" && /^https?:\/\//i.test(j.recovery_url) ? j.recovery_url : null;
  const invalidate = j.invalidate === true;
  const failed = typeof j.error === "string" || j.success === false || !(status >= 200 && status < 300);
  if (failed) {
    const error = typeof j.error === "string" && j.error.trim() ? j.error.trim() : `the vendor answered HTTP ${status}`;
    return { ok: false, data: j, error, recoveryUrl, invalidate };
  }
  return { ok: true, data: j, error: null, recoveryUrl, invalidate };
}

// Typed answers.
function parseInfo(j) {
  const banner = j?.authentication_banner;
  return {
    name: typeof j?.name === "string" ? j.name : "",
    icon: typeof j?.icon === "string" && /^https?:\/\//i.test(j.icon) ? j.icon : null,
    description: typeof j?.description === "string" ? j.description : "",
    banner: banner && typeof banner.message === "string"
      ? { message: banner.message, button: typeof banner.button === "string" && banner.button ? banner.button : "Sign In" } : null,
  };
}

// B13: a commercial package the vendor gives away answers price "FREE" (Chariz, betterAlarm), and purchased: true
// even without a token, so the screen asks this rather than trusting `purchased` alone.
export function isFreePrice(price) {
  return typeof price === "string" && price.trim().toLowerCase() === "free";
}

function parsePackageInfo(j) {
  return { price: typeof j?.price === "string" ? j.price : null, purchased: j?.purchased === true,
    available: j?.available !== false };
}

// status 0 done, 1 open `url` (in a browser sheet, finishing at sileo://payment_completed), -1 or anything else failed.
export function parsePurchase(j) {
  const s = Number(j?.status);
  if (s === 0) return { status: "done" };
  if (s === 1 && typeof j?.url === "string" && /^https:\/\//i.test(j.url)) return { status: "action", url: j.url };
  return { status: "failed" };
}

export class PaymentError extends Error {
  constructor(reply) {
    super(reply.error);
    this.name = "PaymentError";
    this.recoveryUrl = reply.recoveryUrl;
    this.invalidate = reply.invalidate;
  }
}

// `request({ method, url, headers, body })` -> { status, json } (json null when the body wasn't JSON).
// `device()` -> { udid, model } (may be async; the shell knows them). `credentials`: createCredentialStore().
export function createPaymentClient({ base, request, device = () => ({}), credentials = null }) {
  const vendor = parseEndpoint(base);
  if (!vendor) throw new Error(`not an https payment endpoint: ${base}`);

  async function send(action, opts = {}) {
    const res = await request(buildRequest(vendor, action, opts));
    const reply = parseReply(res.status, res.json);
    if (!reply.ok) {
      if (reply.invalidate) await credentials?.forget(vendor);
      throw new PaymentError(reply);
    }
    return reply.data;
  }

  async function who() {
    const d = (await device()) ?? {};
    const c = (await credentials?.load(vendor)) ?? {};
    return { udid: d.udid, device: d.model, token: c.token };
  }

  return {
    base: vendor,
    info: async () => parseInfo(await send("info")),
    async signedIn() { return Boolean((await credentials?.load(vendor))?.token); },
    async authenticateUrl() { const d = (await device()) ?? {}; return authenticateUrl(vendor, d); },
    // Keeps what the vendor's callback URL carried. Returns true when it was a sign-in for us to keep.
    async finishSignIn(callbackUrl) {
      const cb = parseCallback(callbackUrl);
      if (cb?.kind !== "authentication_success") return false;
      await credentials?.save(vendor, { token: cb.token, secret: cb.secret });
      return true;
    },
    async userInfo() {
      const d = await send("user_info", await who());
      return { items: Array.isArray(d.items) ? d.items.filter((x) => typeof x === "string") : [],
        user: { name: typeof d.user?.name === "string" ? d.user.name : "", email: typeof d.user?.email === "string" ? d.user.email : "" } };
    },
    async signOut() {
      const w = await who();
      try { if (w.token) await send("sign_out", { token: w.token }); } finally { await credentials?.forget(vendor); }
    },
    packageInfo: async (packageId) => parsePackageInfo(await send("package_info", { ...(await who()), packageId })),
    async purchase(packageId) {
      const c = (await credentials?.load(vendor)) ?? {};
      return parsePurchase(await send("purchase", { ...(await who()), secret: c.secret, packageId }));
    },
    // The one-time https URL the .deb downloads from (expires in a minute or two: fetch it straight away).
    // `architecture`: the package's own (its stanza's Architecture), not the device's guess.
    async authorizeDownload(packageId, { version, repo, architecture } = {}) {
      const d = await send("authorize_download", { ...(await who()), packageId, version, repo, architecture });
      if (typeof d.url !== "string" || !/^https:\/\//i.test(d.url)) throw new PaymentError(parseReply(502, { error: "the vendor gave no https download URL" }));
      return d.url;
    },
  };
}

// Token and payment secret per vendor base URL. The token sits in `storage`; the secret goes to `secure`
// ({ get(key), set(key, value), remove(key) }, the shell's Keychain behind the passcode or Face ID as the spec asks)
// when there is one, else beside the token. Screens say which one they got (`secureStorage`).
export function createCredentialStore({ storage = globalThis.localStorage, secure = null } = {}) {
  const k = (vendor) => "cydian.payment:" + vendor;
  return {
    secureStorage: Boolean(secure),
    async load(vendor) {
      let rec = null;
      try { rec = JSON.parse(storage?.getItem(k(vendor)) || "null"); } catch { rec = null; }
      if (!rec?.token) return null;
      const secret = secure ? await secure.get(k(vendor)).catch(() => null) : rec.secret;
      return { token: rec.token, secret: secret ?? null };
    },
    async save(vendor, { token, secret }) {
      if (secure) {
        await secure.set(k(vendor), secret);
        storage?.setItem(k(vendor), JSON.stringify({ token }));
      } else storage?.setItem(k(vendor), JSON.stringify({ token, secret }));
    },
    async forget(vendor) {
      storage?.removeItem(k(vendor));
      if (secure) await secure.remove(k(vendor)).catch(() => {});
    },
  };
}
