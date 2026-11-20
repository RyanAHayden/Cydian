// F205: the 29pt row icons of iOS 6's Settings app, redrawn as SVG (no Apple artwork): a flat rounded square tile in
// one colour per row and a white glyph, the same simple style as Home's tiles (home.css .home-glyph; user
// 2026-11-18: no gloss, keep the colours).
//
//   rowIcon("general")  -> { cls: "row-icon", src: "data:image/svg+xml,…" }   a grouped()/plain() row's `icon`
//   tileSvg("general")  -> the SVG text
//   SETTING_ICONS       core/settings.js keys -> icon names (screens/settings.js draws them)
//   ICON_SETS           the per-style icon map: these tiles and every other SVG the screens draw (below, C51)
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
  showExpiryWarning: [C.gold, "seal"], expiryWarning: [C.gold, "clock"], // F244: Home's certificate warning
  otherLinks: [C.purple, "link"], lockHome: [C.dark, "lock"], websiteApps: [C.blue, "apps"],
  help: [C.blue, "question"], server: [C.teal, "globe"], checkServer: [C.green, "pulse"], runYourOwn: [C.orange, "cloud"],
  shareCert: [C.green, "personPlus"], // Share Your Certificate (SideDrop)
  sources: [C.blue, "list"], transfer: [C.green, "transfer"], hidden: [C.grey, "eyeSlash"], recommended: [C.gold, "star"],
  findMore: [C.purple, "globe"], // Manage > Find More Sources (Canister's repo index)
  share: [C.blue, "share"], copy: [C.grey, "copy"], saveFile: [C.teal, "save"], qr: [C.dark, "qr"],
  fromFile: [C.teal, "file"], fromClipboard: [C.brown, "clipboard"],
  installation: [C.blue, "phone"], // Settings > Installation (Signing Server / This iPhone)
};

// core/settings.js's setting keys -> their row's icon. A key not here is a row with no icon (Appearance's choices).
export const SETTING_ICONS = {
  device: "device", iosVersion: "iosVersion", worksOnMyPhone: "worksOnMyPhone", compatMarks: "compatMarks",
  refreshOnLaunch: "refresh", returnHome: "returnHome", holds: "holds", upgradeNotifications: "notifications",
  autoInstall: "autoInstall", autoInstallIdle: "idle", respring: "respring", keepVersions: "keepVersions",
  showExpiry: "showExpiry", resignReminder: "resignReminder", keepBundleId: "keepBundleId",
  showExpiryWarning: "showExpiryWarning", expiryWarning: "expiryWarning", // F244
};

// Settings' pages (core/settings.js PAGES) -> their root row's icon.
export const PAGE_ICONS = { general: "general", theme: "theme", updates: "updates", installation: "installation", signing: "signing" };


// F176: Copying Files' app and system tiles (screens/guides.js): our own glyphs on a 58-unit tile, never Apple's,
// Microsoft's or LocalSend's artwork (AGENTS.md): a folder, radio waves, swap arrows, a monitor, a window, a penguin
// of our own. Name -> [light colour, tile colour, the white glyph's SVG body].
const GUIDE_TILES = {
  files: ["#7cc0fb", "#1a6fd8", "<path d='M11 18h13l4 4h19v22H11z'/><path d='M11 25h36' stroke='#1a6fd8' stroke-width='2' fill='none' opacity='.35'/>"],
  airdrop: ["#7fd0f7", "#1f8fd6", "<circle cx='29' cy='38' r='4.5'/><g fill='none' stroke='#fff' stroke-width='4' stroke-linecap='round'><path d='M20 31a12 12 0 0 1 18 0'/><path d='M14 25a20 20 0 0 1 30 0'/><path d='M9 19a28 28 0 0 1 40 0'/></g>"],
  localsend: ["#6fe0bf", "#14916f", "<g fill='none' stroke='#fff' stroke-width='4.5' stroke-linecap='round' stroke-linejoin='round'><path d='M21 44V15m-8 8 8-8 8 8'/><path d='M37 14v29m-8-8 8 8 8-8'/></g>"],
  pairdrop: ["#b9a3f7", "#5b3fc9", "<rect x='9' y='15' width='16' height='28' rx='3'/><rect x='33' y='15' width='16' height='28' rx='3'/><g fill='none' stroke='#5b3fc9' stroke-width='3' stroke-linecap='round'><path d='M17 37h0M41 37h0'/></g><path d='M27 29h4' stroke='#fff' stroke-width='3.5' stroke-linecap='round'/>"],
  mac: ["#d9dde3", "#7c8592", "<rect x='9' y='12' width='40' height='27' rx='3'/><rect x='12' y='15' width='34' height='21' fill='#5e7fa8'/><path d='M24 39h10l2 7H22z'/><rect x='18' y='45' width='22' height='3' rx='1.5'/>"],
  windows: ["#74b6f2", "#1d5fc0", "<rect x='9' y='13' width='40' height='32' rx='3'/><rect x='12' y='20' width='34' height='22' fill='#2f74d0'/><g fill='#1d5fc0'><circle cx='14' cy='16.5' r='1.5'/><circle cx='19' cy='16.5' r='1.5'/></g><path d='M15 24h12v7H15zM30 24h13v15H30zM15 34h12v5H15z' fill='#bcd8f6'/>"],
  linux: ["#5d5d5d", "#1d1d1d", "<ellipse cx='29' cy='34' rx='13' ry='15'/><ellipse cx='29' cy='35' rx='8.5' ry='11' fill='#1d1d1d'/><circle cx='29' cy='19' r='9'/><g fill='#1d1d1d'><circle cx='25.5' cy='18' r='1.6'/><circle cx='32.5' cy='18' r='1.6'/></g><path d='M25 22h8l-4 4z' fill='#f6b73c'/><path d='M17 48h9l-2-4h-6zM32 48h9l-1-4h-6z' fill='#f6b73c'/>"],
  filza: ["#ffc66b", "#e07e14", "<path d='M11 16h12l4 4h20v24H11z'/><g fill='none' stroke='#e07e14' stroke-width='3' stroke-linecap='round'><path d='M19 27v11h8M19 32h8'/></g><rect x='29' y='25' width='10' height='5' rx='1' fill='#e07e14'/><rect x='29' y='35' width='10' height='5' rx='1' fill='#e07e14'/>"],
};

// Home tiles a screen styles itself (home.css .home-glyph): the tile's colour, its gradient, the glyph SVG.
const HOME_TILES = {
  why: { colour: "#d8820f", gradient: ["#f4b03f", "#d8820f"], // screens/why.js: the Why tile's star
    svg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='#fff' d='M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.5l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7z'/></svg>" },
};

// The tab bar's glyphs: masks over the tab's fill (ios6.css .tab-icon::before), reaching CSS as the `--glyph` token
// of `.tab[data-tab="<tab>"]`. ios6.css holds them as tabGlyphTokens("ios6") prints them (rowicons.test.js).
const TAB_GLYPHS = {
  home: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><path d='M14 3 1.5 14H5v11h7v-7h4v7h7V14h3.5z'/></svg>",
  sources: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><rect x='3' y='3' width='22' height='6' rx='2'/><rect x='3' y='11' width='22' height='6' rx='2'/><rect x='3' y='19' width='22' height='6' rx='2'/></svg>",
  changes: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><path fill-rule='evenodd' d='M14 2a12 12 0 1 0 0 24 12 12 0 1 0 0-24zm0 3a9 9 0 1 1 0 18 9 9 0 1 1 0-18z'/><path d='M12.6 7h2.8v6.3l4.4 3.1-1.6 2.3-5.6-4z'/></svg>",
  installed: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><path d='M11 2h6v8h5l-8 8-8-8h5z'/><path d='M2 17h6l2 3h8l2-3h6v9H2z'/></svg>",
  search: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><path fill-rule='evenodd' d='M11.5 2a9.5 9.5 0 1 0 0 19 9.5 9.5 0 1 0 0-19zm0 3a6.5 6.5 0 1 1 0 13 6.5 6.5 0 1 1 0-13z'/><path d='m17.6 19.7 2.1-2.1 6.6 6.6-2.1 2.1z'/></svg>",
  // our gear: a ring and eight teeth
  settings: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28' fill='none' stroke='#000'><circle cx='14' cy='14' r='7.4' stroke-width='5.2'/><circle cx='14' cy='14' r='10.9' stroke-width='3.4' stroke-dasharray='4.28 4.28'/></svg>",
};

// C51: the per-style icon map (docs/eras.md, "Icon map"). Every inline SVG the screens draw from JS comes from here,
// keyed by kind and icon name, so an era (outline or filled icons) ships its own set beside iOS 6's:
//   rows    name -> [tile colour, glyph name]   29pt row tiles (tileSvg, rowIcon)
//   glyphs  glyph name -> parts                 the white glyphs on row tiles, 24 units
//   guides  name -> [light, colour, body]       Copying Files' 58-unit tiles (guideSvg)
//   home    name -> { colour, gradient, svg }   Home tiles drawn by a screen's own CSS (homeTileCss)
//   tabs    tab -> SVG                          the tab bar's --glyph tokens (tabGlyphTokens)
//   tile    the row tile's size, corners and glyph size
// An era's set names only what it redraws: anything it leaves out falls back to iOS 6's entry.
export const ICON_SETS = {
  ios6: { rows: ROW_ICONS, glyphs: GLYPHS, guides: GUIDE_TILES, home: HOME_TILES, tabs: TAB_GLYPHS,
    tile: { size: SIZE, radius: R, glyph: 19 } },
};

// The style the page shows: <html data-style="ios7"> (docs/eras.md), iOS 6 when none is set.
export function iconStyle(doc = globalThis.document) {
  return doc?.documentElement?.dataset?.style || "ios6";
}

// One entry of the map: `kind` ("rows", "guides", …), `name`, for `style` (the page's by default).
export function icon(kind, name, style = iconStyle()) {
  const own = ICON_SETS[style]?.[kind];
  // hasOwnProperty, not Object.hasOwn: that needs iOS 15.4 and the app runs on 15.0
  return own && Object.prototype.hasOwnProperty.call(own, name) ? own[name] : ICON_SETS.ios6[kind]?.[name];
}

// An SVG as a CSS url() the way ios6.css writes them: only <, > and # escaped, the SVG's quotes single.
export const cssSvgUrl = (svg) => `url("data:image/svg+xml,${svg.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23")}")`;

// The tab bar's glyph tokens for `style`, one rule per tab: what ios6.css holds for iOS 6 and an era's stylesheet
// carries for its own set.
export function tabGlyphTokens(style = "ios6") {
  return Object.keys(TAB_GLYPHS).map((tab) => `.tab[data-tab="${tab}"] { --glyph: ${cssSvgUrl(icon("tabs", tab, style))}; }`).join("\n");
}

// A Home tile's paint (home.css .home-glyph): its colour, then the glyph over its gradient.
export function homeTileCss(name, style = iconStyle()) {
  const t = icon("home", name, style);
  if (!t) throw new Error(`no home tile ${name}`);
  return `background-color: ${t.colour}; background-image: ${cssSvgUrl(t.svg)}, linear-gradient(${t.gradient.join(", ")});`;
}

// The names of Copying Files' tiles, and one tile as a whole SVG: flat like Home's tiles (no gloss), the tile's
// colour, the white glyph.
export const GUIDE_TILE_NAMES = Object.keys(GUIDE_TILES);
export function guideSvg(name, style = iconStyle()) {
  const t = icon("guides", name, style);
  if (!t) throw new Error(`no guide tile ${name}`);
  const [, colour, body] = t;
  return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 58 58'>"
    + `<rect width='58' height='58' fill='${colour}'/><g fill='#fff'>${body}</g></svg>`;
}

function glyphSvg(parts) {
  return parts.map(([kind, d, w]) => kind === "s"
    ? `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${d}" fill="#fff"${kind === "e" ? ' fill-rule="evenodd"' : ""}/>`).join("");
}

export function tileSvg(name, style = iconStyle()) {
  const entry = icon("rows", name, style);
  if (!entry) throw new Error(`no row icon ${name}`);
  const [colour, glyph] = entry;
  const { size, radius, glyph: across } = { ...ICON_SETS.ios6.tile, ...ICON_SETS[style]?.tile };
  const g = across / 24; // the glyph's 24 units drawn 19pt across
  const off = (size - 24 * g) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" rx="${radius}" fill="${colour}"/>`
    + `<g transform="translate(${off} ${off}) scale(${g})">${glyphSvg(icon("glyphs", glyph, style))}</g></svg>`;
}

const cache = new Map();
// A row's `icon` for nav/ui.js grouped()/plain(): the tile as a picture in the .cell-icon (ios6.css .row-icon).
export function rowIcon(name, style = iconStyle()) {
  const key = `${style}:${name}`;
  if (!cache.has(key)) cache.set(key, "data:image/svg+xml," + encodeURIComponent(tileSvg(name, style)));
  return { cls: "row-icon", src: cache.get(key) };
}
