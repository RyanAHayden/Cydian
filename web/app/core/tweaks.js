// Tweak injection (F288): the user adds .dylib, .deb and zipped .framework tweaks to an IPA before it is signed, as
// Feather's TweakHandler does (GPL-3.0, khcrysalis/Feather, Feather/Utilities/Handlers/TweakHandler.swift). This file
// does everything but the signing, the same for both signers:
//
//   prepareTweaks([{ name, data }]) -> { files: [{ path, data }], inject: [loadPath], names, ignored, missing }
//     unpacks each .deb (data.tar.* -> Library/MobileSubstrate/DynamicLibraries/*.dylib and usr/lib/TweakInject/*.dylib
//     injected; Library/Frameworks/*.framework and usr/lib/*.dylib copied as what they link; Library/Application
//     Support/*.bundle into the app's top folder), takes .dylibs and .frameworks as they are, and points every load
//     command between them at @rpath (CydiaSubstrate and libsubstrate at the bundled CydiaSubstrate.framework, or at
//     ElleKit's libellekit.dylib). `files` go into the app (paths under it: Frameworks/…, X.bundle/…); `inject`
//     is what the main executable gets as LC_LOAD_WEAK_DYLIB. `missing` names what a tweak links that nobody added
//     (["CydiaSubstrate"]: add ElleKit's .deb); a sign with something missing is refused (tweakProblem).
//   injectInto(executable, inject) -> executable   adds the weak load commands (and LC_RPATH @executable_path/Frameworks
//     when the binary lacks it) to every slice, in the room after its load commands; the website's signer does this
//     before zsign signs, the app's in Swift (native/sign/Tweaks.swift) on the same rules.
//   tweakParams(prepared) -> { files: [{ path, data: base64 }], inject, names }   for signing.install / library.options
//   loadCommands(bin), dylibsOf(bin)   reading a Mach-O's load commands (the tests' otool -L)
//
// SPDX-License-Identifier: GPL-3.0-or-later
import { readAr, readTar, readZip, decompress, UnpackError } from "./unpack.js";

export { UnpackError };
export const TWEAK_ACCEPT = ".dylib,.deb,.zip,.framework";
export const TWEAK_LIMIT = 64 << 20; // all of an app's tweaks, unpacked
export const SUBSTRATE = "@rpath/CydiaSubstrate.framework/CydiaSubstrate";
export const RPATH = "@executable_path/Frameworks";

const fail = (m) => { throw new UnpackError(m); };

// ---- Mach-O ------------------------------------------------------------------------------------------------------

const MH_MAGIC_64 = 0xfeedfacf, MH_MAGIC = 0xfeedface, FAT = 0xcafebabe, FAT64 = 0xcafebabf;
export const LC = { ID_DYLIB: 0xd, LOAD_DYLIB: 0xc, LOAD_WEAK_DYLIB: 0x80000018, REEXPORT_DYLIB: 0x8000001f,
  LAZY_LOAD_DYLIB: 0x20, LOAD_UPWARD_DYLIB: 0x80000023, RPATH: 0x8000001c, SEGMENT_64: 0x19, SEGMENT: 0x1 };
const DYLIB_CMDS = new Set([LC.ID_DYLIB, LC.LOAD_DYLIB, LC.LOAD_WEAK_DYLIB, LC.REEXPORT_DYLIB, LC.LAZY_LOAD_DYLIB, LC.LOAD_UPWARD_DYLIB]);

const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const cstr = (b, s, e) => {
  let r = [];
  for (let i = s; i < e && b[i]; i++) r.push(b[i]);
  return new TextDecoder().decode(new Uint8Array(r));
};

export function isMachO(b) {
  if (!b || b.length < 8) return false;
  const le = view(b).getUint32(0, true), be = view(b).getUint32(0, false);
  if (le === MH_MAGIC_64 || le === MH_MAGIC) return true;
  // fat: a small arch count tells it from a Java class file (same magic)
  return (be === FAT || be === FAT64) && view(b).getUint32(4, false) > 0 && view(b).getUint32(4, false) < 20;
}

// The slices as [offset, size]: the file itself when thin.
export function slices(b) {
  const dv = view(b);
  const be = dv.getUint32(0, false);
  if (be !== FAT && be !== FAT64) return [[0, b.length]];
  const n = dv.getUint32(4, false), out = [];
  for (let i = 0; i < n; i++) {
    if (be === FAT) { const o = 8 + i * 20; out.push([dv.getUint32(o + 8, false), dv.getUint32(o + 12, false)]); }
    else { const o = 8 + i * 32; out.push([Number(dv.getBigUint64(o + 8, false)), Number(dv.getBigUint64(o + 16, false))]); }
  }
  return out;
}

// One slice's header: whether 64-bit, the header size, ncmds, sizeofcmds.
function header(b, off) {
  const dv = view(b), m = dv.getUint32(off, true);
  if (m !== MH_MAGIC_64 && m !== MH_MAGIC) fail("A tweak or the app has a binary this can't read (not a Mach-O).");
  const is64 = m === MH_MAGIC_64;
  return { is64, size: is64 ? 32 : 28, ncmds: dv.getUint32(off + 16, true), sizeofcmds: dv.getUint32(off + 20, true) };
}

// A slice's load commands: [{ cmd, offset (in the file), size, name (dylib or rpath path) }].
function commandsAt(b, off) {
  const dv = view(b), h = header(b, off), out = [];
  let p = off + h.size;
  for (let i = 0; i < h.ncmds; i++) {
    const cmd = dv.getUint32(p, true), size = dv.getUint32(p + 4, true);
    if (size < 8 || p + size > b.length) fail("A binary's load commands are damaged.");
    let name = null;
    if (DYLIB_CMDS.has(cmd)) name = cstr(b, p + dv.getUint32(p + 8, true), p + size);
    else if (cmd === LC.RPATH) name = cstr(b, p + dv.getUint32(p + 8, true), p + size);
    out.push({ cmd, offset: p, size, name });
    p += size;
  }
  return out;
}

export function loadCommands(b) { return commandsAt(b, slices(b)[0][0]); }
// What the first slice links (otool -L), its own ID left out.
export function dylibsOf(b) {
  return loadCommands(b).filter((c) => DYLIB_CMDS.has(c.cmd) && c.cmd !== LC.ID_DYLIB).map((c) => c.name);
}
export function idOf(b) { return loadCommands(b).find((c) => c.cmd === LC.ID_DYLIB)?.name ?? null; }

// Where a slice's load commands must end: the first section's data (or a later segment's), relative to the slice.
function roomEnd(b, off, size) {
  const dv = view(b), h = header(b, off);
  let end = size;
  for (const c of commandsAt(b, off)) {
    if (c.cmd !== LC.SEGMENT_64 && c.cmd !== LC.SEGMENT) continue;
    const is64 = c.cmd === LC.SEGMENT_64;
    const fileoff = is64 ? Number(dv.getBigUint64(c.offset + 40, true)) : dv.getUint32(c.offset + 32, true);
    const filesize = is64 ? Number(dv.getBigUint64(c.offset + 48, true)) : dv.getUint32(c.offset + 36, true);
    if (fileoff > 0 && filesize > 0) end = Math.min(end, fileoff);
    const nsects = dv.getUint32(c.offset + (is64 ? 64 : 48), true);
    for (let s = 0; s < nsects; s++) {
      const so = c.offset + (is64 ? 72 + s * 80 : 56 + s * 68);
      const ssize = is64 ? Number(dv.getBigUint64(so + 40, true)) : dv.getUint32(so + 36, true);
      const sOff = dv.getUint32(so + (is64 ? 48 : 40), true);
      const type = dv.getUint32(so + (is64 ? 64 : 56), true) & 0xff;
      if (sOff > 0 && ssize > 0 && type !== 1 && type !== 0x0c && type !== 0x12) end = Math.min(end, sOff);
    }
  }
  return Math.max(end, h.size + h.sizeofcmds);
}

const align = (n, a) => Math.ceil(n / a) * a;

function dylibCommand(cmd, name, { timestamp = 2, current = 0, compat = 0 } = {}) {
  const s = new TextEncoder().encode(name);
  const size = align(24 + s.length + 1, 8);
  const c = new Uint8Array(size), dv = view(c);
  dv.setUint32(0, cmd, true); dv.setUint32(4, size, true); dv.setUint32(8, 24, true);
  dv.setUint32(12, timestamp, true); dv.setUint32(16, current, true); dv.setUint32(20, compat, true);
  c.set(s, 24);
  return c;
}

function rpathCommand(path) {
  const s = new TextEncoder().encode(path);
  const size = align(12 + s.length + 1, 8);
  const c = new Uint8Array(size), dv = view(c);
  dv.setUint32(0, LC.RPATH, true); dv.setUint32(4, size, true); dv.setUint32(8, 12, true);
  c.set(s, 12);
  return c;
}

// Rewrites every slice's load commands with `edit(list)` -> list, where list is [{ cmd, name, bytes }] (bytes: the
// command as it is; a changed one gets new bytes). Fails when the new commands don't fit before the first section.
export function editCommands(bin, edit, what = "the binary") {
  const b = bin.slice();
  for (const [off, size] of slices(b)) {
    const h = header(b, off);
    const list = commandsAt(b, off).map((c) => ({ ...c, bytes: b.slice(c.offset, c.offset + c.size) }));
    const next = edit(list, { is64: h.is64 });
    if (next === list) continue;
    const total = next.reduce((n, c) => n + c.bytes.length, 0);
    // section and segment offsets are the slice's own, so the room is too
    if (h.size + total > roomEnd(b, off, size)) fail(`There's no room in ${what} for more load commands.`);
    let p = off + h.size;
    for (const c of next) { b.set(c.bytes, p); p += c.bytes.length; }
    b.fill(0, p, Math.max(p, off + h.size + h.sizeofcmds));
    view(b).setUint32(off + 16, next.length, true);
    view(b).setUint32(off + 20, total, true);
  }
  return b;
}

// Each dylib command's path through `map(path) -> path | null` (null keeps it), and the ID set to `id` when given.
export function rewriteDylibs(bin, map, { id = null, what } = {}) {
  return editCommands(bin, (list) => {
    let changed = false;
    const out = list.map((c) => {
      if (!DYLIB_CMDS.has(c.cmd)) return c;
      const to = c.cmd === LC.ID_DYLIB ? id : map(c.name);
      if (!to || to === c.name) return c;
      changed = true;
      const dv = view(c.bytes);
      return { ...c, name: to, bytes: dylibCommand(c.cmd, to, { timestamp: dv.getUint32(12, true), current: dv.getUint32(16, true), compat: dv.getUint32(20, true) }) };
    });
    return changed ? out : list;
  }, what);
}

// The weak load commands (and the Frameworks rpath) added to the main executable, skipping any it already has.
export function injectInto(bin, inject, { rpath = RPATH, what = "the app's executable" } = {}) {
  if (!inject?.length) return bin;
  return editCommands(bin, (list) => {
    const have = new Set(list.filter((c) => DYLIB_CMDS.has(c.cmd)).map((c) => c.name));
    const rp = new Set(list.filter((c) => c.cmd === LC.RPATH).map((c) => c.name));
    const add = [];
    if (!rp.has(rpath)) add.push({ cmd: LC.RPATH, name: rpath, bytes: rpathCommand(rpath) });
    for (const p of inject) if (!have.has(p)) { have.add(p); add.push({ cmd: LC.LOAD_WEAK_DYLIB, name: p, bytes: dylibCommand(LC.LOAD_WEAK_DYLIB, p) }); }
    return add.length ? [...list, ...add] : list;
  }, what);
}

// ---- .deb and the plan ---------------------------------------------------------------------------------------------

const base = (p) => p.split("/").pop();
const clean = (p) => p.replace(/^\.?\/+/, "").replace(/^(\.\/)+/, "").replace(/^var\/jb\//, "").replace(/^private\/preboot\/[^/]+\/[^/]+\/procursus\//, "");
const safe = (p) => p && !p.startsWith("/") && !p.split("/").some((s) => s === ".." || s === "." || s === "");

function controlField(text, key) {
  const m = new RegExp(`^${key}:\\s*(.+)$`, "mi").exec(text);
  return m ? m[1].trim() : null;
}

// A .deb's files, sorted into the app: [{ path, data, inject }], with its package name and what was left out.
export function unpackDeb(data, name = "tweak.deb") {
  const members = readAr(data);
  if (!members.some((m) => m.name === "debian-binary")) fail(`${name} isn't a .deb (no debian-binary).`);
  const dataTar = members.find((m) => /^data\.tar(\.|$)/.test(m.name));
  if (!dataTar) fail(`${name} has no data.tar.`);
  let pkg = null;
  const control = members.find((m) => /^control\.tar(\.|$)/.test(m.name));
  if (control) {
    try {
      const c = readTar(decompress(control.name, control.data, 1 << 20)).find((e) => base(e.path) === "control" && e.type === "file");
      if (c) pkg = controlField(new TextDecoder().decode(c.data), "Name") || controlField(new TextDecoder().decode(c.data), "Package");
    } catch { /* the name is a nicety */ }
  }
  const entries = readTar(decompress(dataTar.name, dataTar.data, TWEAK_LIMIT));
  return { pkg, ...sortFiles(entries.filter((e) => e.type === "file").map((e) => ({ path: clean(e.path), data: e.data })), name) };
}

// Files from a package's tree (paths as installed, rootless prefix gone) -> what goes into the app.
function sortFiles(list, name) {
  const files = [], ignored = new Set();
  let m;
  for (const f of list) {
    const p = f.path;
    if ((m = /^(?:Library\/MobileSubstrate\/DynamicLibraries|usr\/lib\/TweakInject)\/([^/]+\.dylib)$/.exec(p))) {
      files.push({ path: `Frameworks/${m[1]}`, data: f.data, inject: true });
    } else if ((m = /^(?:Library\/Frameworks|usr\/lib)\/([^/]+\.framework\/.+)$/.exec(p))) {
      files.push({ path: `Frameworks/${m[1]}`, data: f.data, inject: false });
    } else if ((m = /^usr\/lib\/([^/]+\.dylib)$/.exec(p))) {
      files.push({ path: `Frameworks/${m[1]}`, data: f.data, inject: false });
    } else if ((m = /^Library\/Application Support\/([^/]+\.bundle\/.+)$/.exec(p))) {
      files.push({ path: m[1], data: f.data, inject: false });
    } else if (!/\.plist$/.test(p) || !/^Library\/MobileSubstrate\/DynamicLibraries\//.test(p)) {
      const top = p.split("/").slice(0, 3).join("/");
      if (!/^(DEBIAN|usr\/share\/doc)/.test(top)) ignored.add(top);
    }
  }
  if (!files.some((f) => f.inject || /\.framework\//.test(f.path) || /\.dylib$/.test(f.path))) {
    fail(`${name} has nothing to inject (no .dylib in Library/MobileSubstrate/DynamicLibraries).`);
  }
  return { files, ignored: [...ignored].sort() };
}

// A zipped .framework (or a zip holding .dylibs and frameworks) -> files.
function unpackZip(data, name) {
  const files = [];
  for (const e of readZip(data, TWEAK_LIMIT)) {
    if (e.dir || e.symlink || e.path.startsWith("__MACOSX/") || base(e.path).startsWith("._")) continue;
    const parts = e.path.split("/");
    const fw = parts.findIndex((s) => s.endsWith(".framework"));
    if (fw >= 0 && fw < parts.length - 1) files.push({ path: `Frameworks/${parts.slice(fw).join("/")}`, data: e.data, frameworkRoot: parts[fw] });
    else if (e.path.endsWith(".dylib")) files.push({ path: `Frameworks/${base(e.path)}`, data: e.data, inject: true });
    else if (e.path.endsWith(".deb")) files.push(...unpackDeb(e.data, base(e.path)).files);
  }
  if (!files.length) fail(`${name} holds no .framework, .dylib or .deb.`);
  // a framework the user added (not one a .deb brought) is injected, by its executable
  for (const fwName of new Set(files.map((f) => f.frameworkRoot).filter(Boolean))) {
    const stem = fwName.replace(/\.framework$/, "");
    const exe = files.find((f) => f.path === `Frameworks/${fwName}/${stem}`)
      ?? files.find((f) => f.path.startsWith(`Frameworks/${fwName}/`) && f.path.split("/").length === 3 && isMachO(f.data));
    if (exe && stem !== "CydiaSubstrate") exe.inject = true;
  }
  return files.map(({ frameworkRoot, ...f }) => f);
}

const SUBSTRATE_RE = /(^|\/)(CydiaSubstrate\.framework\/CydiaSubstrate|libsubstrate\.dylib|libellekit\.dylib|libhooker\.dylib|libblackjack\.dylib)$/;

// What problem stops a sign, in words; null when there's none.
export function tweakProblem(prepared) {
  if (!prepared?.missing?.length) return null;
  const who = prepared.missingBy?.length ? prepared.missingBy.join(", ") : "A tweak";
  return `${who} needs CydiaSubstrate, which isn't among the tweaks. Add ElleKit's .deb (or a CydiaSubstrate.framework) too.`;
}

// The user's files -> the plan. Later files win over earlier ones at the same path.
export function prepareTweaks(items) {
  const byPath = new Map(), ignored = [], names = [];
  let total = 0;
  for (const it of items ?? []) {
    const data = it.data instanceof Uint8Array ? it.data : new Uint8Array(it.data);
    const n = String(it.name ?? "tweak");
    const lower = n.toLowerCase();
    let files;
    if (lower.endsWith(".deb")) { const d = unpackDeb(data, n); files = d.files; ignored.push(...d.ignored.map((p) => `${n}: ${p}`)); }
    else if (lower.endsWith(".dylib")) {
      if (!isMachO(data)) fail(`${n} isn't a dylib.`);
      files = [{ path: `Frameworks/${base(n)}`, data, inject: true }];
    } else if (lower.endsWith(".zip") || lower.endsWith(".framework")) files = unpackZip(data, n);
    else fail(`${n}: add a .dylib, a .deb or a zipped .framework.`);
    names.push(n);
    for (const f of files) {
      if (!safe(f.path)) fail(`${n} has a file outside its folder (${f.path}).`);
      total += f.data.length;
      if (total > TWEAK_LIMIT) fail("The tweaks are too big (64 MB in all at most).");
      const had = byPath.get(f.path);
      byPath.set(f.path, { ...f, inject: Boolean(f.inject || had?.inject), from: n });
    }
  }
  const all = [...byPath.values()];
  const frameworks = new Set(all.map((f) => /^Frameworks\/([^/]+)\.framework\//.exec(f.path)?.[1]).filter(Boolean));
  const dylibs = new Set(all.filter((f) => /^Frameworks\/[^/]+\.dylib$/.test(f.path)).map((f) => base(f.path)));
  const hasSubstrate = all.some((f) => f.path === "Frameworks/CydiaSubstrate.framework/CydiaSubstrate");
  const substrate = hasSubstrate ? SUBSTRATE : dylibs.has("libellekit.dylib") ? "@rpath/libellekit.dylib" : null;
  const missingBy = new Set();
  // where a load command should point, or null to leave it
  const target = (p) => {
    const fw = /([^/]+)\.framework\/([^/]+)$/.exec(p);
    if (fw && frameworks.has(fw[1])) return `@rpath/${fw[1]}.framework/${fw[2]}`;
    if (!fw && dylibs.has(base(p))) return `@rpath/${base(p)}`;
    if (SUBSTRATE_RE.test(p)) return substrate ?? false;
    return null;
  };
  for (const f of all) {
    if (!isMachO(f.data)) continue;
    const rel = f.path.replace(/^Frameworks\//, "");
    const own = f.path.startsWith("Frameworks/") ? `@rpath/${rel}` : null;
    let lacks = false;
    f.data = rewriteDylibs(f.data, (p) => {
      const t = target(p);
      if (t === false) { lacks = true; return null; }
      return t === own ? null : t;
    }, { id: idOf(f.data) !== null && own ? own : null, what: base(f.path) });
    if (lacks) missingBy.add(f.from);
  }
  const inject = all.filter((f) => f.inject && isMachO(f.data)).map((f) => `@rpath/${f.path.replace(/^Frameworks\//, "")}`);
  if (items?.length && !inject.length) fail("None of these has a .dylib to inject.");
  return {
    files: all.map((f) => ({ path: f.path, data: f.data })),
    inject,
    names,
    ignored,
    missing: missingBy.size ? ["CydiaSubstrate"] : [],
    missingBy: [...missingBy],
  };
}

// For the app's bridge (signing.install, library.options): base64 file contents.
export function tweakParams(prepared, toBase64) {
  if (!prepared?.files?.length) return null;
  return { files: prepared.files.map((f) => ({ path: f.path, data: toBase64(f.data) })), inject: [...prepared.inject], names: [...prepared.names] };
}

// A short line for a row: "Tweak (.deb)", "Dynamic Library", "Framework".
export function tweakKind(name) {
  const n = String(name).toLowerCase();
  if (n.endsWith(".deb")) return "Package (.deb)";
  if (n.endsWith(".dylib")) return "Dynamic Library";
  return "Framework (.zip)";
}
