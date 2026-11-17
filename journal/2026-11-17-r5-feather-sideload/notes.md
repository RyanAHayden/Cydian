# R5: how Feather signs and installs IPAs on the phone

## What I did
- Shallow-cloned into the scratchpad (not the repo): Feather `31ab6de`, Zsign-Package `c4ba9da` (package
  branch), IDeviceKit `837cf1e`, AppSync Unified `235aca6`, TrollStore `88424f6`. Licences checked from the
  LICENSE files and the GitHub API.
- Read Feather's certificate import, the signing pipeline (SigningHandler → ZsignHandler → zsign's
  `zsign()`/`ZSignAsset::Init`/`ZBundle`), the three install modes (Fully Local, Semi Local, idevice), the
  keep-alive and progress code; AppSync's installd hook and `appinst`; TrollStore's RootHelper `installApp` and
  TrollStore Lite.
- Fetched `https://backloop.dev/pack.json` (public; only printed `info`, didn't keep the key) and resolved
  `*.backloop.dev` / `localhost.backloop.dev`.
- Wrote docs/sideload.md: licences table, each step with file pointers, what touches the internet per mode,
  jailbreak routes, a reuse table, what N9 and I2 need, Not verified.
- Plan: noted N9 and I2 (their sidedrop steps are overruled by the user's 2026-11-17 rule), filed F14
  (on-device signer + local install server, after I2) and F15 (idevice route, later).

## Findings worth keeping
- Fully Local = public domain `*.backloop.dev` → 127.0.0.1 plus a publicly trusted wildcard cert whose private
  key is published. **The live pack expired on 2026-10-29**: Fully Local is broken for everyone until it
  rotates. Cydian must check `notAfter` and must never publish a key itself.
- Semi Local = plain-HTTP server on the phone, with the manifest made by `api.palera.in/genPlist` (third party
  sees bundle ID, name, version, LAN IP).
- TrollStore's `RootHelper/uicache.m` is BSD-4-Clause: GPL-incompatible, don't copy it.
- AppSync Unified's control caps `firmware (<= 18.2)`.
- Feather calls private `LSApplicationWorkspace` methods (install progress, open app) from a sideloaded app.
  docs/ipa.md's blanket "blocked" is too strong. I noted that in sideload.md rather than editing ipa.md (not
  in R5's files).

## Decisions made without asking
- Recommended SwiftNIO + NIOSSL over all of Vapor for the server: same PEM loading, much smaller.
- Server modes first (F14, normal), idevice later (F15). idevice is the most robust, but it needs a computer
  once for the pairing file plus the LocalDevVPN app.
- Didn't recommend Feather's `export-certificate` URL route: it hands the private key to any caller.

## Tried and failed
- My first `ls` of the TrollStore tree used a relative path from the wrong folder. Re-ran it; nothing else failed.

## Not verified
- No phone was used (desk research; the 4S is iOS 6). Not checked: itms-services on iOS 26 with a loopback
  HTTPS manifest, an HTTP payload, and the literal `*.backloop.dev` host; revocation checks on the backloop
  cert; how often the backloop pack rotates; AppSync/TrollStore Lite on iOS 26/27 jailbreaks; Apple's
  OCSP/PPQ traffic; upstream zsign per-extension profiles (README only). The same list is in
  docs/sideload.md.
