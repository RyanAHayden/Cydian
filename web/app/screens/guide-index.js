// C32: what Home's root and Settings need of the User Guides without loading them: the guide list (GUIDES, Home's
// User Guides rows), the lite test and the links into a guide. The guides themselves (screens/guides.js: the FAQ,
// steps, terminals) load at #/home/guides (lazy.js, router.js lazyFor). screens/guides.js re-exports every name here.
//
// SPDX-License-Identifier: GPL-3.0-or-later
import { format } from "../router.js";
import { GUIDE_ID as KEEP_GUIDE } from "../core/keepid.js";

export const ASC_GUIDE = "asc-key";
export const JAILBREAK_INFO_URL = "https://jailbreakme.dev/";

// Lite: what a Not Jailbroken device sees. `type` is settings.deviceType() ("none" in the sideload build).
export const isLite = (type) => type === "none";

// Whether a guide or an answer (`only`: "lite" / "full" / "link") shows in this mode.
export const shows = (item, lite) => !item.only || item.only === (lite ? "lite" : "full");

export const GUIDES = {
  faq: { title: "Frequently Asked Questions", row: "Frequently Asked Questions" },
  copying: { title: "Copying Files", row: "Copying Files to/from Device" },
  openssh: { title: "OpenSSH", row: "OpenSSH Access How-To", only: "full" },
  password: { title: "Root Password", row: "Root Password How-To", only: "full" },
  // F237: listed where apps are signed (lite); `linked`: Settings > Signing and Custom Install open it in any mode
  [KEEP_GUIDE]: { title: "Notifications", row: "Notifications for Signed Apps", only: "lite", linked: true },
  // F277: opened only from screens/devaccount.js's footer (`only: "link"`: listed nowhere)
  [ASC_GUIDE]: { title: "API Key", row: "Use an App Store Connect API Key", only: "link", linked: true },
};
export const guideIds = (lite) => Object.keys(GUIDES).filter((id) => shows(GUIDES[id], lite));

export const keepGuideHref = (fmt = format) => fmt({ tab: "home", path: ["guides", KEEP_GUIDE] });
export const ascGuideHref = (fmt = format) => fmt({ tab: "home", path: ["guides", ASC_GUIDE] });

// Home's User Guides group: one row per guide, in Cydia's order; lite leaves out the jailbreak ones.
export const guideRows = (fmt = format, lite = false) =>
  guideIds(lite).map((id) => ({ label: GUIDES[id].row, href: fmt({ tab: "home", path: ["guides", id] }) }));
