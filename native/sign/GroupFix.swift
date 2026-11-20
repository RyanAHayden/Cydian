// B211: signed apps keep their own app-group folders and keychain. The same rules as the website's signer
// (web/app/core/groupfix.js): the original executable's entitlements are read before signing, and an app that asks
// for app groups the profile can't give, or names keychain access groups, gets the fix dylib (native/groupfix/,
// committed built at web/app/vendor/groupfix/ and bundled with web/) through the tweak path (Tweaks.swift), with
// its config beside it: { groups, target (the profile's first group, or "" for a folder of the app's own), keychain }.
// iFizBox's own IPA never gets it.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum GroupFix {
    static let dylibPath = "Frameworks/ifizbox-groupfix.dylib"
    static let configPath = "Frameworks/ifizbox-groupfix.plist"
    static let inject = "@rpath/ifizbox-groupfix.dylib"
    // The dylib's bytes, from the app's bundled web/ (the tests set their own); nil signs without it.
    static var dylib: () -> Data? = {
        try? Data(contentsOf: Bundle.main.bundleURL.appendingPathComponent("web/vendor/groupfix/ifizbox-groupfix.dylib"))
    }

    struct Plan: Equatable {
        var groups: [String]
        var target: String
        var keychain: Bool
    }

    private static func strings(_ v: Any?) -> [String] { (v as? [Any] ?? []).compactMap { $0 as? String }.filter { !$0.isEmpty } }

    // The original's groups the profile doesn't have, to the profile's first group; nil when there's nothing to fix.
    static func plan(original: [String: Any]?, profile: [String: Any]) -> Plan? {
        guard let o = original else { return nil }
        let have = strings(profile["com.apple.security.application-groups"])
        let groups = strings(o["com.apple.security.application-groups"]).filter { !have.contains($0) }
        let keychain = !strings(o["keychain-access-groups"]).isEmpty
        guard !groups.isEmpty || keychain else { return nil }
        return Plan(groups: groups, target: have.first ?? "", keychain: keychain)
    }

    // The tweak set with the dylib and its config added (after the user's own tweaks).
    static func adding(_ p: Plan, dylib: Data, to tweaks: TweakSet?) throws -> TweakSet {
        let config = try PropertyListSerialization.data(fromPropertyList: ["groups": p.groups, "target": p.target, "keychain": p.keychain],
                                                        format: .xml, options: 0)
        var t = tweaks ?? TweakSet()
        t.files.removeAll { $0.path == dylibPath || $0.path == configPath }
        t.files += [TweakFile(path: dylibPath, data: dylib), TweakFile(path: configPath, data: config)]
        t.inject = t.inject.filter { $0 != inject } + [inject]
        return t
    }
}
