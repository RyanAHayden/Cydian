// The name texts give the certificate's page. The sideload build merged Installation and Signing into one page,
// Installation & Signing (screens/settings.js MERGED_TITLE); the website and the jailbreak app keep "Signing".
// Links (#settings/signing) land right in every build: only the words differ.
//
//   signingPage()                 "Settings > Installation & Signing" in the sideload build, else "Settings > Signing"
//   pageName(text)                `text` with "Settings > Signing" said the build's way (non-strings pass through)

// No imports, so core/signing.js can use it without a cycle (core/settings.js reaches core/signing.js): "sideload"
// exactly when core/settings.js detectMode() says so (the bridge's own mode), else "other".
const detectMode = (g = globalThis) => (g.ifizboxNative?.mode === "sideload" ? "sideload" : "other");

export const SIGNING_PAGE = "Settings > Signing";
export const MERGED_PAGE = "Settings > Installation & Signing";

export const signingPage = (mode = detectMode()) => (mode === "sideload" ? MERGED_PAGE : SIGNING_PAGE);

export const pageName = (text, mode = detectMode()) =>
  (mode === "sideload" && typeof text === "string" ? text.replaceAll(SIGNING_PAGE, MERGED_PAGE) : text);
