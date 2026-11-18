// The Home Screen web app can't hand an https link to the app that claims it (a universal link): iOS gives a web page
// no way to, and x-safari- (app.js) lands in Safari. For sites whose app has its own URL scheme, open that instead;
// app.js falls back to Safari when the app doesn't come up. X, YouTube, GitHub. The native shell needs none of this (LinkOut.open asks iOS
// for the universal link first).
// ponytail: only schemes known to take these paths; add a site here when iFizBox links to it.

export function appSchemeFor(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^(www\.|mobile\.)/, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "x.com" || host === "twitter.com") { // X still answers twitter://
    if (parts[1] === "status" && /^\d+$/.test(parts[2] ?? "")) return `twitter://status?id=${parts[2]}`;
    if (parts.length === 1 && /^\w{1,15}$/.test(parts[0])) return `twitter://user?screen_name=${parts[0]}`;
    return null;
  }
  if (host === "youtube.com" || host === "youtu.be") return `youtube://${u.host}${u.pathname}${u.search}`;
  // Discord stays https: a re-signed Unbound opens on discord:// but drops the invite (user 2026-11-18).
  if (host === "github.com" && parts.length) return `github://github.com${u.pathname}`; // the GitHub app (user 2026-11-18)
  return null;
}
