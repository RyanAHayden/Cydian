// A URL from a source, made one that every URL parser takes: characters that aren't allowed in a URL (a space,
// quotes, <>, {}, |, ^, `, \, [ ] after the host, non-ASCII, a % that doesn't start %XX) are percent-encoded
// (UTF-8), and existing %XX escapes are kept as they are, so an already encoded URL comes back unchanged.
// Sources write "assets/YouTube Icon.png" with a raw space: browsers fix that themselves, but iOS's URL(string:)
// before iOS 17 returns nil for it (native/Sources/Apt.swift httpURL does the same as a backstop).
// Only the part after the host is touched; the scheme and host are left as written.
//
//   encodeUrl("https://a.dev/assets/YouTube Icon.png")   -> "https://a.dev/assets/YouTube%20Icon.png"
//   encodeUrl("https://a.dev/assets/YouTube%20Icon.png") -> the same
//   encodeUrl("not a url")                               -> "not a url" (trimmed, nothing else)

const BAD = /%(?![0-9A-Fa-f]{2})|[^A-Za-z0-9\-._~:/?#@!$&'()*+,;=%]/gu;

const enc = (c) => {
  try { return encodeURIComponent(c); } catch { return "%EF%BF%BD"; } // a lone surrogate: U+FFFD
};

export function encodeUrl(v) {
  const s = typeof v === "string" ? v.trim() : "";
  const m = s.match(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)([\s\S]*)$/i);
  if (!m) return s;
  return m[1] + m[2].replace(BAD, enc);
}
