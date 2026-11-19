// B104: plain-http IPA links in the sideload app, the way http sources work (screens/manage.js addSecure). The shell
// (native/Sources/Sideload.swift download) tries the https twin of an http IPA URL first; when that fails it answers
// code "insecure", and the page asks with INSECURE_IPA_ALERT. Install Anyway sends the call again with
// `insecure: true`, and the shell downloads over plain http (F238's PlainDownload, Network.framework: the WKWebView's
// ATS stays as it is). Any other ATS refusal (an https link that redirects to http) comes as code "ats", or as iOS's
// raw text from an older shell, and gets ATS_TEXT instead of iOS's words.
//
//   isHttpIpa(url)      an http:// link (the ones that are tried over https first)
//   httpsTwin(url)      the same link over https (port 80 dropped), or null when it isn't http
//   INSECURE_IPA_ALERT  the alert: Cancel (cancel: 0, the darker safe button) | Install Anyway
//   isInsecure(err)     the shell's "no https twin" answer
//   isAts(err)          any other ATS refusal: code "ats", or iOS's own sentence
//   ATS_TITLE, atsText(name)   what is said for it; insecureText(name) for "insecure" where nothing asked
// SPDX-License-Identifier: GPL-3.0-or-later
import { NAME } from "../brand.js";

export function isHttpIpa(url) {
  return /^http:\/\/[^\s/?#]+/i.test(String(url ?? "").trim());
}

export function httpsTwin(url) {
  if (!isHttpIpa(url)) return null;
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  u.protocol = "https:";
  if (u.port === "80") u.port = "";
  return u.href;
}

export const INSECURE_IPA_ALERT = {
  title: "This Download Is Not Secure",
  message: `The app is sent without encryption, and someone on the same network could change it before ${NAME} signs it. Install anyway?`,
  buttons: ["Cancel", "Install Anyway"],
  cancel: 0,
};
export const INSTALL_ANYWAY = 1;

export const isInsecure = (err) => err?.code === "insecure";

const ATS_RAW = /App Transport Security/i; // iOS's English sentence (an older shell); the shell's code "ats" in any language
export const isAts = (err) => err?.code === "ats" || ATS_RAW.test(String(err?.message ?? err ?? ""));

// "insecure" where nothing asked (deviceError): what it means, in our words.
export const insecureText = (name = "") => `${name || "The app"} is only offered over plain http, without encryption. Add its link in Install IPAs to choose whether to install it anyway.`;

export const ATS_TITLE = "Download Not Secure";
export const atsText = (name = "") => `${name || "The app"} couldn't be downloaded: its link is, or leads to, a plain http address, which iOS blocks here. Ask for an https link to the IPA.`;
