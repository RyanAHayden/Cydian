// F205: the 29pt row icons of iOS 6's Settings app, redrawn as SVG (no Apple artwork): a flat rounded square tile in
// one colour per row and a white glyph, the same simple style as Home's tiles (home.css .home-glyph; user
// 2026-11-18: no gloss, keep the colours).
//
//   rowIcon("general")  -> { cls: "row-icon", src: "data:image/svg+xml,…" }   a grouped()/plain() row's `icon`
//   tileSvg("general")  -> the SVG text
//   SETTING_ICONS       core/settings.js keys -> icon names (screens/settings.js draws them)
//
// Measured off the 4S (Preferences.app's Settings icons, 58x58 @2x, and a screenshot of Settings' root):
//   tile      29 x 29pt, corners ~5pt (the first opaque pixel 9px in on the top row @2x)
//   glyph     white, ~19pt, centred
//   spacing   the tile 7pt in from the cell's left edge, the label 11pt after it (ios6.css .cell-icon.row-icon)
// Tiles look the same in both themes, as iOS 6's did.

const SIZE = 29;
const R = 6; // home.css / ios6.css .cell-icon's corners

// Tile colours.
const C = {
  grey: "#8c9097", blue: "#3f80e0", sky: "#3ea2e8", green: "#40ae4c", red: "#e2382f", orange: "#f08b1d",
  purple: "#7650cc", indigo: "#4650b4", dark: "#55595f", teal: "#22a6b5", gold: "#e8ad1a", brown: "#a6763f",
  pink: "#e04a86",
};

// Glyphs on a 24-unit square. Parts: ["f", d] filled, ["e", d] filled even-odd (holes), ["s", d, width] stroked.
const disc = "M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 0 1 0-19z";
function gear() {
  const pts = [];
  const teeth = 8, ro = 10.5, ri = 7.9;
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2 + Math.PI / (teeth * 4);
    const r = i % 4 < 2 ? ro : ri;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}zM12 8.4a3.6 3.6 0 1 0 0 7.2a3.6 3.6 0 0 0 0-7.2z`;
}
function star() {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 4.3 : 10;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12.8 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}z`;
}
const person = "M12 2.8a4.7 4.7 0 1 1 0 9.4a4.7 4.7 0 0 1 0-9.4zM2.8 21.5c.4-5 4.3-7.8 9.2-7.8s8.8 2.8 9.2 7.8z";
const arrows = [["s", "M19.2 9.2A7.6 7.6 0 0 0 5.2 8.6", 2.6], ["f", "M3.2 4.2v7h7z"],
  ["s", "M4.8 14.8a7.6 7.6 0 0 0 14 .6", 2.6], ["f", "M20.8 19.8v-7h-7z"]];
const eye = [["s", "M2.2 12s3.6-6.3 9.8-6.3S21.8 12 21.8 12s-3.6 6.3-9.8 6.3S2.2 12 2.2 12z", 2.2],
  ["f", "M12 8.8a3.2 3.2 0 1 1 0 6.4a3.2 3.2 0 0 1 0-6.4z"]];

export const GLYPHS = {
  person: [["f", person]],
  personPlus: [["f", "M9.5 3.5a4.3 4.3 0 1 1 0 8.6a4.3 4.3 0 0 1 0-8.6zM1.5 21c.4-4.6 3.8-7.2 8-7.2s7.6 2.6 8 7.2z"],
    ["f", "M18 4.5h2.4v3.1h3.1V10h-3.1v3.1H18V10h-3.1V7.6H18z"]],
  gear: [["e", gear()]],
  contrast: [["e", `${disc}M12 4.8a7.2 7.2 0 0 0 0 14.4z`]],
  download: [["e", `${disc}M10.6 6.2h2.8v6.2h3.2L12 17.4l-4.6-5h3.2z`]],
  refresh: [["s", "M19.4 12a7.4 7.4 0 1 1-2.3-5.4", 2.8], ["f", "M21 3v7.4h-7.4z"]],
  arrows,
  pen: [["f", "M15.6 3.4a1.8 1.8 0 0 1 2.6 0l2.4 2.4a1.8 1.8 0 0 1 0 2.6L9.3 19.7 2.8 21.2l1.5-6.5z"]],
  terminal: [["s", "M4.5 7l5.5 5-5.5 5", 3], ["s", "M12 18h7.5", 3]],
  install: [["f", "M10.5 2.5h3v9.7l3.4-3.4 2.1 2.1L12 17.9l-7-7 2.1-2.1 3.4 3.4zM3.5 19h17v2.8h-17z"]],
  list: [["f", "M3.3 5.5a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM9.3 4.2h11.6v2.6H9.3z"
    + "M3.3 12a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM9.3 10.7h11.6v2.6H9.3z"
    + "M3.3 18.5a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM9.3 17.2h11.6v2.6H9.3z"]],
  transfer: [["f", "M7.5 2.5l5.3 5.8H9.2v6H5.8v-6H2.2zM16.5 21.5l-5.3-5.8h3.6v-6h3.4v6h3.6z"]],
  eyeSlash: [...eye, ["s", "M4 20.5L20 3.5", 2.4]],
  eye,
  star: [["f", star()]],
  phone: [["e", "M7.6 1.5h8.8a2.1 2.1 0 0 1 2.1 2.1v16.8a2.1 2.1 0 0 1-2.1 2.1H7.6a2.1 2.1 0 0 1-2.1-2.1V3.6a2.1 2.1 0 0 1 2.1-2.1z"
    + "M7.7 4.3v13.6h8.6V4.3zM12 18.9a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 0 0 0-2.4z"]],
  info: [["e", `${disc}M10.6 10.2h2.8v8h-2.8zM12 5.4a1.7 1.7 0 1 0 0 3.4a1.7 1.7 0 0 0 0-3.4z`]],
  check: [["s", "M4 12.6l5.2 5.2L20 6.6", 3.4]],
  checkCircle: [["s", "M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18z", 2], ["s", "M7.2 12.4l3.3 3.3 6.3-6.6", 2.6]],
  home: [["f", "M12 2.6l10.2 9.2H19v9.4h-5.2v-6.4h-3.6v6.4H5v-9.4H1.8z"]],
  minusCircle: [["e", `${disc}M6.5 10.6h11v2.8h-11z`]],
  bell: [["f", "M12 2.4c.9 0 1.6.7 1.6 1.6v.6c2.9.7 4.8 3.3 4.8 6.4v4.4l2.1 2.6v1.1H3.5V18l2.1-2.6V11c0-3.1 1.9-5.7 4.8-6.4V4c0-.9.7-1.6 1.6-1.6zM9.5 20h5a2.5 2.5 0 0 1-5 0z"]],
  bolt: [["f", "M14 1.8L4.8 13.6h6.1L9.6 22.2l9.6-12.1h-6.2z"]],
  battery: [["e", "M3.2 6.8h15.6a1.6 1.6 0 0 1 1.6 1.6v7.2a1.6 1.6 0 0 1-1.6 1.6H3.2a1.6 1.6 0 0 1-1.6-1.6V8.4a1.6 1.6 0 0 1 1.6-1.6zM3.9 9v6h14.2V9z"],
    ["f", "M21.2 10h1.3v4h-1.3zM12.2 9.8l-4 3.2h2.8l-1 2.3 4-3.3h-2.8z"]],
  lock: [["e", "M6.8 10.4V8a5.2 5.2 0 0 1 10.4 0v2.4h1.6v11.2H5.2V10.4zM9.5 10.4h5V8a2.5 2.5 0 0 0-5 0z"]],
  clock: [["e", `${disc}M10.8 5.8h2.4v5.6l3.9 2.6-1.3 2-5-3.4z`]],
  calendar: [["e", "M3 4.6h18V21H3zM5.2 9.2v9.6h13.6V9.2z"], ["f", "M6.8 2.4h2.4v4.4H6.8zM14.8 2.4h2.4v4.4h-2.4zM7.2 11.2h3.4v3.2H7.2z"]],
  hourglass: [["f", "M5.5 2.2h13v2.2h-1.1c0 3.4-2.4 5.6-4 7.6 1.6 2 4 4.2 4 7.6h1.1v2.2h-13v-2.2h1.1c0-3.4 2.4-5.6 4-7.6-1.6-2-4-4.2-4-7.6H5.5z"]],
  link: [["s", "M10.2 13.8a4 4 0 0 0 5.7 0l3.6-3.6a4 4 0 0 0-5.7-5.7l-1.3 1.3", 2.6],
    ["s", "M13.8 10.2a4 4 0 0 0-5.7 0l-3.6 3.6a4 4 0 0 0 5.7 5.7l1.3-1.3", 2.6]],
  question: [["s", "M8.4 8.8a3.6 3.6 0 1 1 5.2 3.3c-1.1.6-1.6 1.4-1.6 2.6v.8", 3], ["f", "M12 17.4a1.9 1.9 0 1 0 0 3.8a1.9 1.9 0 0 0 0-3.8z"]],
  globe: [["s", "M12 2.9a9.1 9.1 0 1 0 0 18.2a9.1 9.1 0 0 0 0-18.2z", 1.9],
    ["s", "M12 2.9c-2.6 2.5-3.9 5.6-3.9 9.1s1.3 6.6 3.9 9.1c2.6-2.5 3.9-5.6 3.9-9.1S14.6 5.4 12 2.9z", 1.9], ["s", "M3 12h18", 1.9]],
  cloud: [["f", "M6.8 19.6a4.6 4.6 0 0 1-.5-9.2 6 6 0 0 1 11.5-.9 5.1 5.1 0 0 1 .3 10.1z"]],
  pulse: [["s", "M2 12.5h4.2l2.6-6.2 4.2 12 2.6-5.8H22", 2.6]],
  share: [["s", "M8.2 9.6H5.8v11h12.4v-11h-2.4", 2.4], ["s", "M12 15V5", 2.6], ["f", "M12 1.8l4.6 4.8H7.4z"]],
  copy: [["e", "M8.5 7.5h11.5v14H8.5zM10.8 9.8v9.4h6.9V9.8z"], ["f", "M4 2.5h11.5v3H6.4V17H4z"]],
  save: [["e", "M5 2.5h9.2L19 7.3v14.2H5zM7.4 4.9v14.2h9.2V8.3h-3.4V4.9z"], ["f", "M10.8 9.5h2.4v4.4h2.3L12 17.6l-3.5-3.7h2.3z"]],
  qr: [["e", "M2.5 2.5h8v8h-8zM4.7 4.7v3.6h3.6V4.7zM13.5 2.5h8v8h-8zM15.7 4.7v3.6h3.6V4.7zM2.5 13.5h8v8h-8zM4.7 15.7v3.6h3.6v-3.6z"],
    ["f", "M13.5 13.5h3v3h-3zM18.5 13.5h3v3h-3zM16 16.2h2.6v2.6H16zM13.5 18.5h3v3h-3zM18.5 18.5h3v3h-3z"]],
  file: [["e", "M5 2.5h9.2L19 7.3v14.2H5zM13.2 4.2v4.1h4.1z"]],
  clipboard: [["e", "M5 4.4h3V3.6A1.6 1.6 0 0 1 9.6 2h4.8A1.6 1.6 0 0 1 16 3.6v.8h3v17.1H5zM7.4 6.8v12.3h9.2V6.8h-.6v1.8H8v-1.8z"]],
  key: [["e", "M14.6 2.6a6.2 6.2 0 1 1-2.2 12l-1.6 1.6H8.4v2.4H6v2.4H2.6v-3.6l6.9-6.9a6.2 6.2 0 0 1 5.1-7.9zM16 6.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 0 0 0-3.6z"]],
  seal: [["f", "M7.8 13.6 5.4 22l3.3-1.5 2.2 2.3 1.2-7.1zM16.2 13.6l2.4 8.4-3.3-1.5-2.2 2.3-1.2-7.1z"],
    ["e", "M12 1.6a7 7 0 1 1 0 14a7 7 0 0 1 0-14zM12 4.6a4 4 0 1 0 0 8a4 4 0 0 0 0-8z"]],
  power: [["s", "M7.4 6.4a8 8 0 1 0 9.2 0", 2.8], ["s", "M12 2.4v9", 2.8]],
  apps: [["f", "M3 3h7.5v7.5H3zM13.5 3H21v7.5h-7.5zM3 13.5h7.5V21H3zM13.5 13.5H21V21h-7.5z"]],
};

// Icon name -> tile colour and glyph. One name per thing a row is about, so the same thing looks the same everywhere.
export const ROW_ICONS = {
  account: [C.sky, "person"], createAccount: [C.green, "personPlus"], signInKey: [C.gold, "key"],
  syncNow: [C.blue, "arrows"], lastSynced: [C.grey, "clock"], syncCert: [C.orange, "seal"], showKey: [C.dark, "eye"],
  general: [C.grey, "gear"], theme: [C.indigo, "contrast"], updates: [C.green, "download"], signing: [C.orange, "pen"],
  logs: [C.dark, "terminal"], ipa: [C.blue, "install"], openInApp: [C.pink, "share"],
  device: [C.grey, "phone"], iosVersion: [C.blue, "info"], worksOnMyPhone: [C.green, "check"], compatMarks: [C.teal, "checkCircle"],
  refresh: [C.sky, "refresh"], returnHome: [C.blue, "home"],
  holds: [C.red, "minusCircle"], notifications: [C.red, "bell"], autoInstall: [C.purple, "bolt"], idle: [C.green, "battery"],
  respring: [C.dark, "power"], keepVersions: [C.brown, "clock"], showExpiry: [C.red, "calendar"], resignReminder: [C.orange, "hourglass"],
  keepBundleId: [C.indigo, "copy"], // F237: Keep Bundle IDs (no duplicate copies)
  otherLinks: [C.purple, "link"], lockHome: [C.dark, "lock"], websiteApps: [C.blue, "apps"],
  help: [C.blue, "question"], server: [C.teal, "globe"], checkServer: [C.green, "pulse"], runYourOwn: [C.orange, "cloud"],
  sources: [C.blue, "list"], transfer: [C.green, "transfer"], hidden: [C.grey, "eyeSlash"], recommended: [C.gold, "star"],
  share: [C.blue, "share"], copy: [C.grey, "copy"], saveFile: [C.teal, "save"], qr: [C.dark, "qr"],
  fromFile: [C.teal, "file"], fromClipboard: [C.brown, "clipboard"],
};

// core/settings.js's setting keys -> their row's icon. A key not here is a row with no icon (Appearance's choices).
export const SETTING_ICONS = {
  device: "device", iosVersion: "iosVersion", worksOnMyPhone: "worksOnMyPhone", compatMarks: "compatMarks",
  refreshOnLaunch: "refresh", returnHome: "returnHome", holds: "holds", upgradeNotifications: "notifications",
  autoInstall: "autoInstall", autoInstallIdle: "idle", respring: "respring", keepVersions: "keepVersions",
  showExpiry: "showExpiry", resignReminder: "resignReminder", keepBundleId: "keepBundleId",
};

// Settings' pages (core/settings.js PAGES) -> their root row's icon.
export const PAGE_ICONS = { general: "general", theme: "theme", updates: "updates", signing: "signing" };


function glyphSvg(parts) {
  return parts.map(([kind, d, w]) => kind === "s"
    ? `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${d}" fill="#fff"${kind === "e" ? ' fill-rule="evenodd"' : ""}/>`).join("");
}

export function tileSvg(name) {
  const icon = ROW_ICONS[name];
  if (!icon) throw new Error(`no row icon ${name}`);
  const [colour, glyph] = icon;
  const g = 19 / 24; // the glyph's 24 units drawn 19pt across
  const off = (SIZE - 24 * g) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`
    + `<rect width="${SIZE}" height="${SIZE}" rx="${R}" fill="${colour}"/>`
    + `<g transform="translate(${off} ${off}) scale(${g})">${glyphSvg(GLYPHS[glyph])}</g></svg>`;
}

const cache = new Map();
// A row's `icon` for nav/ui.js grouped()/plain(): the tile as a picture in the .cell-icon (ios6.css .row-icon).
export function rowIcon(name) {
  if (!cache.has(name)) cache.set(name, "data:image/svg+xml," + encodeURIComponent(tileSvg(name)));
  return { cls: "row-icon", src: cache.get(name) };
}
