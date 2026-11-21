// F344: the tweak index's fixture .debs, built in memory (ar of debian-binary, control.tar.gz, data.tar.gz) for
// web/app/core/tweakindex.test.js and worker/test-tweakindex.mjs: an app tweak (YouTube), a SpringBoard tweak, a
// UIKit-wide tweak and a paid tweak's stanza, plus the Packages text a source would carry for them.
// SPDX-License-Identifier: GPL-3.0-or-later
import { gzipSync } from "node:zlib";

const enc = (s) => new TextEncoder().encode(s);
function tar(files) {
  const blocks = [];
  for (const [path, data] of files) {
    const body = typeof data === "string" ? enc(data) : data;
    const h = new Uint8Array(512);
    h.set(enc(path).subarray(0, 100), 0);
    h.set(enc("0000644\0"), 100);
    h.set(enc("0000000\0"), 108);
    h.set(enc("0000000\0"), 116);
    h.set(enc(body.length.toString(8).padStart(11, "0") + "\0"), 124);
    h.set(enc("00000000000\0"), 136);
    h.set(enc("        "), 148);
    h[156] = 0x30;
    h.set(enc("ustar\x0000"), 257);
    let sum = 0;
    for (const b of h) sum += b;
    h.set(enc(sum.toString(8).padStart(6, "0") + "\0 "), 148);
    blocks.push(h, body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  return Buffer.concat(blocks);
}
function ar(members) {
  const parts = [enc("!<arch>\n")];
  for (const [name, data] of members) {
    const head = `${name}/`.padEnd(16) + "0".padEnd(12) + "0".padEnd(6) + "0".padEnd(6) + "100644".padEnd(8) + String(data.length).padEnd(10) + "`\n";
    parts.push(enc(head), data, data.length % 2 ? enc("\n") : new Uint8Array(0));
  }
  return new Uint8Array(Buffer.concat(parts));
}
export const makeDeb = (files, control = "Package: x\n") => ar([["debian-binary", enc("2.0\n")],
  ["control.tar.gz", gzipSync(tar([["./control", control]]))], ["data.tar.gz", gzipSync(tar(files))]]);
const filter = (ids) => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Filter</key><dict>`
  + `<key>Bundles</key><array>${ids.map((i) => `<string>${i}</string>`).join("")}</array></dict></dict></plist>`;
const dl = (name, ids, root = "./var/jb/Library/MobileSubstrate/DynamicLibraries") => [[`${root}/${name}.dylib`, "\xcf\xfa\xed\xfe"],
  [`${root}/${name}.plist`, filter(ids)]];

// filename -> .deb bytes
export const DEBS = {
  "debs/ytplus_1.0.deb": makeDeb(dl("YTPlus", ["com.google.ios.youtube"])),
  "debs/sbcolor_2.0.deb": makeDeb(dl("SBColor", ["com.apple.springboard"])),
  "debs/anyfont_1.1.deb": makeDeb(dl("AnyFont", ["com.apple.UIKit"], "./Library/MobileSubstrate/DynamicLibraries")),
  "debs/ytplus_0.9.deb": makeDeb(dl("YTPlus", ["com.google.ios.youtube"])),
};

const stanza = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v}`).join("\n") + "\n";
export const PACKAGES = [
  stanza({ Package: "com.x.ytplus", Name: "YTPlus", Version: "0.9", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "mobilesubstrate", Filename: "debs/ytplus_0.9.deb" }),
  stanza({ Package: "com.x.ytplus", Name: "YTPlus", Version: "1.0", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "mobilesubstrate, preferenceloader", Filename: "debs/ytplus_1.0.deb" }),
  stanza({ Package: "com.x.sbcolor", Name: "SBColor", Version: "2.0", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "mobilesubstrate", Filename: "debs/sbcolor_2.0.deb" }),
  stanza({ Package: "com.x.anyfont", Name: "AnyFont", Version: "1.1", Architecture: "iphoneos-arm", Section: "Tweaks", Depends: "mobilesubstrate", Filename: "debs/anyfont_1.1.deb" }),
  stanza({ Package: "com.x.instapro", Name: "InstaPro", Version: "3.0", Architecture: "iphoneos-arm64", Section: "Tweaks", Tag: "cydia::commercial",
    Description: "Download stories and reels in Instagram", Depends: "mobilesubstrate", Filename: "debs/instapro_3.0.deb" }),
  stanza({ Package: "com.x.theme", Name: "A Theme", Version: "1", Architecture: "iphoneos-arm64", Section: "Themes", Filename: "debs/theme_1.deb" }),
].join("\n");
