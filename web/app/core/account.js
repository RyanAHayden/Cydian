// F97: iFizBox Account. Settings, sources, Ignored Upgrades, installed-app records and the signing certificate kept on
// cydian.dev, so a new phone, a reinstall or the website gets them back. No email, no password: the account is a
// random 128-bit account key made on the device. Everything is encrypted here (AES-GCM, its key from the account key
// with HKDF) before it leaves, so the server (worker/src/account.js) only ever holds ciphertext; the URL's id is a
// second HKDF output, which the server hashes again before using it as a KV key. Pure JS on Web Crypto, no DOM: node
// tests cover all of it, the network and the device's stores come in as functions.
//
//   newKey()                 16 random bytes                 keyCode(bytes) -> "ABCD-EFGH-…" (Crockford base32)
//   parseKey(text)           a code, or a ifizbox://account?k= link -> bytes, or null
//   keyLink(bytes)           ifizbox://account?k=<code>
//   await deriveAccount(bytes)        -> { id (64 hex), key (AES-GCM CryptoKey) }
//   await seal(key, payload) / await unseal(key, bytes)   payload <-> 12-byte IV + ciphertext
//   accountApi({ base, id, fetcher })  get() -> {version, data} | null; put(data, version | null) -> version
//                                      (throws a Conflict with .version on 409); remove()
//   mergePayload(local, remote, seen, now)   what both devices end up with (rules below)
//   summarize(payload)       what "seen" keeps: no certificate, only its fingerprint
//   changesFor(local, merged, { syncCert })  what applying `merged` changes on this device
//   createAccountSync(deps)  the controller Settings > Account and the app's lifecycle use (below)
//
// The payload (v: 1): { sources: [core/sourcelist.js exportLine], settings: { TRAVELS key: value }, holds: [package],
// wishlist: [package] (F102's Wish List, core/wishlist.js; an older payload without it reads as empty),
// identity?: { p12, profile (base64url), password, p12Name, profileName } | null (null: no certificate; left out: this
// build doesn't say), apps: [core/installed.js appRecord], stamps: { "settings.<key>": ms, identity: ms }, savedAt }.
//
// Merging: sources, holds, the wish list and apps are sets, merged three ways against what this device last synced ("seen"): the
// account's list, plus what this device added since, minus what it removed since. So a removal travels too, and a
// device that never synced only adds. Settings and the certificate are last-write-wins per field: a field this
// device changed since the last sync wins (its stamp is now); otherwise the account's value stands. An app both have
// goes to the changed side, or the newer record. Applying never removes a certificate from a device.
// SPDX-License-Identifier: GPL-3.0-or-later
import { toB64url, fromB64url } from "./transfer.js";
import { NAME } from "../brand.js";

const ACCOUNT_VERSION = 1;
export const ACCOUNT_BASE = "https://cydian.dev"; // the app's server; the website uses its own origin
const SALT = new TextEncoder().encode("ifizbox-account-v1");
const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new AccountError("no_crypto", "This browser can't encrypt (Web Crypto is missing).");
  return s;
};

class AccountError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

// ---- the key ----------------------------------------------------------------------------------------------------

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I, L, O, U

export function newKey(rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))) { return rand(16); }

export function keyCode(bytes, { groups = true } = {}) {
  let bits = 0, acc = 0, out = "";
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(acc >> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += B32[(acc << (5 - bits)) & 31];
  return groups ? out.match(/.{1,4}/g).join("-") : out;
}

export function parseKey(text) {
  let s = String(text ?? "").trim();
  const link = /[?&]k=([^&#\s]+)/.exec(s);
  if (link) s = decodeURIComponent(link[1]);
  s = s.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (s.length !== 26 || /[^0-9A-HJKMNP-TV-Z]/.test(s)) return null;
  const out = new Uint8Array(16);
  let bits = 0, acc = 0, i = 0;
  for (const c of s) {
    acc = ((acc << 5) | B32.indexOf(c)) & 0xffff; bits += 5;
    if (bits >= 8) { out[i++] = (acc >> (bits - 8)) & 255; bits -= 8; }
  }
  return (acc & ((1 << bits) - 1)) === 0 ? out : null; // the 2 bits past 128 are zero in a real code
}

export const keyLink = (bytes) => "ifizbox://account?k=" + keyCode(bytes, { groups: false });

const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function deriveAccount(bytes) {
  const s = subtle();
  const base = await s.importKey("raw", bytes, "HKDF", false, ["deriveBits", "deriveKey"]);
  const idBits = await s.deriveBits({ name: "HKDF", hash: "SHA-256", salt: SALT, info: new TextEncoder().encode("id") }, base, 256);
  const key = await s.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: new TextEncoder().encode("encrypt") }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { id: hex(idBits), key };
}

export async function seal(key, payload) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}

export async function unseal(key, bytes) {
  const b = new Uint8Array(bytes);
  let text;
  try {
    text = new TextDecoder().decode(await subtle().decrypt({ name: "AES-GCM", iv: b.subarray(0, 12) }, key, b.subarray(12)));
  } catch { throw new AccountError("bad_key", "Your account can't be opened with this key."); }
  const p = JSON.parse(text);
  if (!p || typeof p !== "object" || p.v !== ACCOUNT_VERSION) throw new AccountError("too_new", `Your account was saved by a newer ${NAME}. Update ${NAME}.`);
  return p;
}

// ---- the server -------------------------------------------------------------------------------------------------

export function accountApi({ base = "", id, fetcher = (...a) => globalThis.fetch(...a) }) {
  const url = `${base}/api/account/${id}`;
  const ver = (r) => Number(String(r.headers.get("ETag") ?? "").replace(/^W\//, "").replace(/"/g, "")) || null;
  const why = async (r) => {
    let msg = `cydian.dev answered HTTP ${r.status}.`;
    try { msg = (await r.json()).error || msg; } catch { /* not JSON */ }
    return new AccountError(r.status === 429 ? "rate_limited" : r.status === 413 ? "too_large" : "server", msg);
  };
  const call = async (init) => {
    try { return await fetcher(url, { cache: "no-store", ...init }); } catch (e) {
      throw new AccountError("network", "cydian.dev can't be reached. Check the connection.", { cause: e });
    }
  };
  return {
    async get() {
      const r = await call({});
      if (r.status === 404) return null;
      if (!r.ok) throw await why(r);
      return { version: ver(r), data: new Uint8Array(await r.arrayBuffer()) };
    },
    async put(data, version) {
      const headers = { "Content-Type": "application/octet-stream", ...(version ? { "If-Match": `"${version}"` } : { "If-None-Match": "*" }) };
      const r = await call({ method: "PUT", body: data, headers });
      if (r.status === 409) throw new AccountError("conflict", "The account changed on another device.", { version: ver(r) });
      if (r.status === 404) throw new AccountError("gone", "This account was deleted.");
      if (!r.ok) throw await why(r);
      return ver(r) ?? (await r.json()).version;
    },
    async remove() {
      const r = await call({ method: "DELETE" });
      if (!r.ok && r.status !== 404) throw await why(r);
    },
  };
}

// ---- merging ----------------------------------------------------------------------------------------------------

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const same = (a, b) => canon(a) === canon(b);

// A certificate's fingerprint for "seen" (kept in localStorage): FNV-1a, two lanes. Not a secret's hash: the .p12
// is random enough that this tells nothing about it or its password.
export function identityPrint(id) {
  if (id === undefined) return undefined;
  if (!id) return null;
  const s = `${id.p12}|${id.profile}|${id.password ?? ""}`;
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0;
    b = Math.imul(b ^ s.charCodeAt(s.length - 1 - i), 2246822519) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

const appVer = (r) => `${r.version ?? ""}@${r.date ?? 0}`;

export function summarize(p) {
  return {
    sources: [...new Set(p?.sources ?? [])].sort(), holds: [...new Set(p?.holds ?? [])].sort(), wishlist: [...new Set(p?.wishlist ?? [])].sort(),
    settings: { ...(p?.settings ?? {}) }, identity: identityPrint(p?.identity),
    apps: Object.fromEntries((p?.apps ?? []).map((r) => [r.id, appVer(r)])),
  };
}

// (remote + added here since seen) - removed here since seen, the remote order first.
function mergeSet(remote = [], local = [], seenList = null) {
  const seen = new Set(seenList ?? []), here = new Set(local);
  const removed = new Set([...seen].filter((x) => !here.has(x)));
  const out = [];
  for (const x of [...remote, ...local.filter((x) => !seen.has(x))]) if (!removed.has(x) && !out.includes(x)) out.push(x);
  return out;
}

export function mergePayload(local, remote, seen = null, now = Date.now()) {
  const stamps = {};
  if (!remote) {
    for (const k of Object.keys(local.settings ?? {})) stamps[`settings.${k}`] = now;
    if (local.identity !== undefined) stamps.identity = now;
    return { v: ACCOUNT_VERSION, sources: [...new Set(local.sources ?? [])], settings: { ...local.settings }, holds: [...new Set(local.holds ?? [])],
      wishlist: [...new Set(local.wishlist ?? [])],
      ...(local.identity !== undefined ? { identity: local.identity } : {}), apps: [...(local.apps ?? [])], stamps, savedAt: now };
  }
  const rs = remote.stamps ?? {};
  const settings = {};
  for (const k of new Set([...Object.keys(remote.settings ?? {}), ...Object.keys(local.settings ?? {})])) {
    const inL = Object.hasOwn(local.settings ?? {}, k), inR = Object.hasOwn(remote.settings ?? {}, k);
    const changed = inL && (seen ? !Object.hasOwn(seen.settings, k) || !same(local.settings[k], seen.settings[k]) : !inR);
    if (changed && (rs[`settings.${k}`] ?? 0) <= now) { settings[k] = local.settings[k]; stamps[`settings.${k}`] = now; }
    else if (inR) { settings[k] = remote.settings[k]; if (rs[`settings.${k}`]) stamps[`settings.${k}`] = rs[`settings.${k}`]; }
    else settings[k] = local.settings[k];
  }
  let identity = remote.identity;
  if (rs.identity) stamps.identity = rs.identity;
  if (local.identity !== undefined) {
    const print = identityPrint(local.identity);
    const changed = seen ? print !== seen.identity : remote.identity === undefined || (remote.identity === null && local.identity !== null);
    if (changed && print !== identityPrint(remote.identity) && (rs.identity ?? 0) <= now) { identity = local.identity; stamps.identity = now; }
  }
  const la = new Map((local.apps ?? []).map((r) => [r.id, r])), ra = new Map((remote.apps ?? []).map((r) => [r.id, r]));
  const ids = mergeSet([...ra.keys()], [...la.keys()], seen ? Object.keys(seen.apps) : null);
  const apps = ids.map((id) => {
    const l = la.get(id), r = ra.get(id);
    if (!l || !r) return l ?? r;
    const changed = seen ? appVer(l) !== seen.apps[id] : (l.date ?? 0) > (r.date ?? 0);
    return changed ? l : r;
  });
  return { v: ACCOUNT_VERSION, sources: mergeSet(remote.sources, local.sources, seen?.sources), settings,
    holds: mergeSet(remote.holds, local.holds, seen?.holds),
    wishlist: mergeSet(remote.wishlist, local.wishlist, seen?.wishlist), ...(identity !== undefined ? { identity } : {}), apps, stamps, savedAt: now };
}

// Whether the account needs writing: what it would hold differs from what it holds (stamps and times aside).
export const differs = (a, b) => !b || !same(summarize(a), summarize(b));
// Whether this device changed anything since `seen` (a summarize() result).
export const changedSince = (local, seen) => !seen || !same(summarize(local), seen);

export function changesFor(local, merged, { syncCert = true } = {}) {
  const has = (list) => new Set(list ?? []);
  const lS = has(local.sources), mS = has(merged.sources), lH = has(local.holds), mH = has(merged.holds);
  const lW = has(local.wishlist), mW = has(merged.wishlist);
  const settings = {};
  for (const [k, v] of Object.entries(merged.settings ?? {})) if (!same(v, local.settings?.[k])) settings[k] = v;
  const la = new Map((local.apps ?? []).map((r) => [r.id, r]));
  const ma = new Set((merged.apps ?? []).map((r) => r.id));
  const identity = syncCert && local.identity !== undefined && merged.identity && identityPrint(merged.identity) !== identityPrint(local.identity)
    ? merged.identity : null;
  const c = {
    addSources: [...mS].filter((x) => !lS.has(x)), removeSources: [...lS].filter((x) => !mS.has(x)), settings,
    addHolds: [...mH].filter((x) => !lH.has(x)), removeHolds: [...lH].filter((x) => !mH.has(x)), identity,
    addWishes: [...mW].filter((x) => !lW.has(x)), removeWishes: [...lW].filter((x) => !mW.has(x)),
    putApps: (merged.apps ?? []).filter((r) => !la.has(r.id) || appVer(la.get(r.id)) !== appVer(r)),
    removeApps: [...la.keys()].filter((id) => !ma.has(id)),
  };
  c.empty = !c.addSources.length && !c.removeSources.length && !Object.keys(settings).length && !c.addHolds.length &&
    !c.removeHolds.length && !c.addWishes.length && !c.removeWishes.length && !identity && !c.putApps.length && !c.removeApps.length;
  return c;
}

// A certificate for the payload from the files (bytes), or null.
export function identityOf(c) {
  if (!c?.p12 || !c?.profile) return null;
  return { p12: toB64url(c.p12), profile: toB64url(c.profile), password: c.password ?? "", p12Name: c.p12Name ?? "", profileName: c.profileName ?? "" };
}
export const identityFiles = (id) => ({ ...id, p12: fromB64url(id.p12), profile: fromB64url(id.profile) });

// ---- the controller ---------------------------------------------------------------------------------------------
//
//   const acct = createAccountSync({ keys, state, collect, apply, api?, base?, now? })
//     keys:    { get() -> code | null, set(code), remove() }  the Keychain in the app, IndexedDB on the website
//     state:   { get() -> object | null, set(object | null) }  localStorage: { version, seen, lastSynced, syncCert }
//     collect({ syncCert }) -> this device's payload; apply(changes) does changesFor's list
//   await acct.create()        a new key, the device's things written as the account -> code
//   await acct.signIn(text)    the key from a code or link; a read only (what's here is written at the next save)
//   await acct.sync({ write }) read, merge, apply; write too when `write` and the account needs it. A 409 reads and
//                              merges again (3 tries)
//   await acct.save()          the batched write: only when something changed since the last sync (or a read found
//                              this device ahead). Called when the app goes to the background / the page is hidden
//   await acct.remove()        deletes the account on cydian.dev and forgets the key here
//   await acct.status()        { signedIn, code, lastSynced, syncCert }
export function createAccountSync({ keys, state, collect, apply, api = null, base = "", fetcher, now = () => Date.now() }) {
  let busy = Promise.resolve();
  const serial = (f) => { const p = busy.then(f, f); busy = p.catch(() => {}); return p; };
  const st = () => ({ syncCert: true, ...(state.get() ?? {}) });
  const put = (patch) => state.set({ ...st(), ...patch });
  const open = async () => {
    const code = await keys.get();
    const bytes = code && parseKey(code);
    if (!bytes) throw new AccountError("signed_out", `Sign in to your ${NAME} Account first.`);
    const { id, key } = await deriveAccount(bytes);
    return { key, api: api ? api(id) : accountApi({ base, id, fetcher }) };
  };

  async function syncOnce({ write }) {
    const { key, api: server } = await open();
    const s = st();
    for (let attempt = 0; ; attempt++) {
      const local = await collect({ syncCert: s.syncCert });
      const got = await server.get();
      if (!got && s.version) throw new AccountError("gone", "This account was deleted on another device.");
      const remote = got ? await unseal(key, got.data) : null;
      const merged = mergePayload(local, remote, s.seen ?? null, now());
      const changes = changesFor(local, merged, { syncCert: s.syncCert });
      if (!changes.empty) await apply(changes);
      const ahead = differs(merged, remote);
      let version = got?.version ?? null;
      if (write && ahead) {
        try { version = await server.put(await seal(key, merged), version); } catch (e) {
          if (e.code === "conflict" && attempt < 2) continue;
          throw e;
        }
      }
      // "seen" is what the account holds now: the merge when it was written, else the account as read (so what this
      // device has beyond it still counts as changed, for the next save). A certificate this device kept against the
      // account's (applying never removes one; Sync Certificate off takes none) counts as seen, or it would go back up.
      const after = await collect({ syncCert: s.syncCert });
      const seen = summarize(write && ahead ? merged : remote ?? merged);
      if (after.identity !== undefined && identityPrint(after.identity) !== identityPrint(merged.identity)) seen.identity = identityPrint(after.identity);
      put({ version, seen, lastSynced: now(), pending: ahead && !write });
      return { changes, wrote: write && ahead };
    }
  }

  return {
    async create() {
      return serial(async () => {
        const code = keyCode(newKey());
        await keys.set(code);
        put({ version: null, seen: null, lastSynced: null, pending: false });
        try { await syncOnce({ write: true }); } catch (e) { await keys.remove(); state.set(null); throw e; }
        return code;
      });
    },
    async signIn(text) {
      const bytes = parseKey(text);
      if (!bytes) throw new AccountError("bad_key", "That isn't an account key. It looks like XXXX-XXXX-…, 26 letters and digits.");
      return serial(async () => {
        const before = await keys.get();
        await keys.set(keyCode(bytes));
        put({ version: null, seen: null, lastSynced: null, pending: false });
        try {
          const { api: server } = await open();
          if (!(await server.get())) throw new AccountError("not_found", "There is no account with that key.");
          return await syncOnce({ write: false });
        } catch (e) {
          if (before) await keys.set(before); else await keys.remove();
          state.set(null);
          throw e;
        }
      });
    },
    sync: ({ write = true } = {}) => serial(() => syncOnce({ write })),
    async save() {
      return serial(async () => {
        if (!(await keys.get())) return false;
        const s = st();
        if (!s.pending && s.seen && !changedSince(await collect({ syncCert: s.syncCert }), s.seen)) return false;
        await syncOnce({ write: true });
        return true;
      });
    },
    async remove() {
      return serial(async () => {
        const { api: server } = await open();
        await server.remove();
        await keys.remove();
        state.set(null);
      });
    },
    async forget() { return serial(async () => { await keys.remove(); state.set(null); }); },
    setSyncCert(on) { put({ syncCert: !!on }); },
    async status() {
      const code = await keys.get();
      const s = st();
      return { signedIn: !!code, code: code ?? null, lastSynced: s.lastSynced ?? null, syncCert: s.syncCert !== false };
    },
  };
}
