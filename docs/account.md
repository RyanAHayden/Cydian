# Cydian Account (F97)

A free, minimal account that keeps a device's sources, the settings that travel (`core/settings.js` TRAVELS),
Ignored Upgrades, installed-app records (`core/installed.js`) and the signing certificate on cydian.dev, so a new
phone, a reinstall or the website gets them back.

## The key

- 128 random bits made on the device, shown as 26 Crockford base32 characters in groups of four
  (`XXXX-XXXX-…-XX`), and as `cydian://account?k=<code>` (link and QR code). Typing is forgiving: case, spaces,
  dashes, O/0 and I/L/1.
- Kept in the Keychain in the app (`account.key.get/set/remove`, `native/Sources/Account.swift`: this device only,
  after first unlock, no Face ID) and in IndexedDB (`cydian-account`) on the website or in an older shell.
- HKDF-SHA256 (salt `cydian-account-v1`) gives two things: `info "id"` → the 64-hex id in the URL;
  `info "encrypt"` → the AES-GCM-256 key. The server keys KV by `acct:` + SHA-256(id), so neither the key nor the
  URL's id is stored. Losing the key loses the data; nobody can recover it.

## The server (`worker/src/account.js`)

`GET|PUT|DELETE /api/account/<id>`. The body is 12-byte IV + AES-GCM ciphertext, at most 256 KB. The version is a
counter in KV metadata, sent as `ETag: "<n>"`. A PUT needs `If-Match: "<n>"` to replace version n, or
`If-None-Match: *` to create. Anything else gets 409 with the current ETag, and the device reads, merges and
tries again (3 times). Rate limits per address are kept in the isolate's memory (not KV, whose free tier has
1,000 writes a day): 60 requests a minute, 12 of them writes. Bodies are never logged. `worker/node.mjs` has the
same routes, with accounts kept in memory.

## Sync (`web/app/core/account.js`, `web/app/screens/account.js`)

- **When**: one read at launch. One save when the app goes to the background or the page is hidden (`visibilitychange`
  / `pagehide`), but only if something changed since the last sync, or a read found this device ahead of the
  account. Sync Now does both. Signing in is a read only.
- **Merge**: sources, holds, the Wish List (`wishlist`, F102) and apps are sets merged three ways against `seen` (what the account held after this
  device's last sync, kept in localStorage `cydian.account` with the certificate only as a fingerprint): the
  account's list, plus this device's additions, minus this device's removals. So a removal travels to the other
  devices too, and a device that has never synced only adds. Settings and the certificate are last-write-wins per
  field: what this device changed since `seen` wins (stamp = now); otherwise the account's value stands. Syncing
  never removes a certificate from a device.
- **Sync Certificate** (on by default): when off, this device sends `identity: null`, which takes the certificate
  out of the account, and it takes no certificate in. The jailbreak build doesn't sign, so it leaves the account's
  certificate as it is.
- Purchases stay with each repo's own account (Havoc, Chariz). They are not part of this.
