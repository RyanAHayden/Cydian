// The product's name and identity, in one place (F170, user 2026-11-18: "should those references not all be hardcoded
// but have a ref to the name so a future change would be easier"). The frontend and worker/ import this; native/ and
// the Python tools read the same values from native/brand.env (native/test_brand.py keeps the two equal). Change the
// name here and in brand.env, then run `python3 native/brand.py sync` for the files that can't import it
// (native/sign/Brand.swift, index.html, manifest.json, source.json).
//
// F170 wires NAME everywhere a person reads it. The IDs, package name and storage keys move in F171, the domain
// and GitHub repo in F172: until then code that needs those still spells the old ones.

export const NAME = "iFizBox";
export const DOMAIN = "ifizbox.com";
export const SIGN_HOST = `sign.${DOMAIN}`;
export const BUNDLE_ID = "com.ryha.ifizbox";
export const PACKAGE = BUNDLE_ID; // the .deb's package name
export const GITHUB_REPO = "RyanAHayden/iFizBox";
