# T66: iPhone 15 rig signs with the app's Keychain groups

`tools/ui-15.sh install` signed with zsign and the profile's entitlements unchanged, so a rig-installed build had
`keychain-access-groups [S8NFX3A2LT.*, com.apple.token]`. Items without an access group then went to the first
group the app could use, which isn't the one the app's own signer puts first (`TEAM.<Info.plist ID>`,
`Profile.keychainGroups`). After an in-app self-update or self re-sign, the identity and the RemotePairing record
couldn't be reached.

Now `install` writes `$XDG_RUNTIME_DIR/ifizbox-15/entitlements.plist` (`keychain_entitlements` in the script) and
passes it to zsign with `-e`. It mirrors `Profile.entitlements(for:keptID:)` with the bundle ID kept: the
profile's entitlements, with `keychain-access-groups` = `[TEAM.<Info.plist ID>, TEAM.<App ID>]` (the first only
when the profile's groups allow it), `application-identifier` = `TEAM.<App ID>` and `get-task-allow` false. With
a wildcard profile, the App ID is the app's own ID. The bundle ID comes from `Payload/*.app/Info.plist` in the IPA
(binary or XML, via plistlib), and the entitlements from the profile via `openssl smime -verify -noverify`.
docs/iphone15.md says what the groups are and that an `--as-is` install can still lose the items.

Checked offline (no phone): the function against `native/build/iFizBox.ipa` and the rig's profile gives
`[S8NFX3A2LT.com.ryha.ifizbox, S8NFX3A2LT.com.ryha.sideload]`, app ID `S8NFX3A2LT.com.ryha.sideload`. Signed with
zsign `-e` to a scratch IPA, the main binary and both extensions (iFizBoxWidget, iFizBoxShare) carry those groups
in their embedded entitlements. zsign applies `-e` to extensions too. That matches IPASigner, which gives
extensions the same `entitlements(for: entID, keptID: newID)` when it keeps the bundle ID. `sh -n` passes.

Tried and failed: nothing.

**Not verified**
- An install on the iPhone 15 Pro and a self-update after it, keeping Certificate and Paired. I left the shared test
  phone's state alone: it has an imported identity and a pairing, which took a person's help to set up
  (`iphone15-tailscale-login-needs-owner`). If this rig install got the groups wrong, it would lose both again.
  Whoever next runs a self-update test on the 15 checks it: Settings still shows the certificate and paired after.
