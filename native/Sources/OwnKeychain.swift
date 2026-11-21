// iFizBox's own secrets (the signing identity and its .p12, the App Store Connect key, the account key, the review
// token, payment secrets) go in the app's own Keychain group, TEAM.<its bundle ID>, when the signature lists it.
// A signer that keeps an app's data puts that group first and TEAM.<App ID> second (Profile.keychainGroups); under an
// explicit App ID (one App ID for many apps, as a signing service's profile) every app signed with that profile has the second group too, so an item
// written there (no access group: the default group, which older signs made TEAM.<App ID>) is readable and
// deletable by all of them. Signed without our own group (SideDrop's signer, the jailbreak build), group is nil and
// items are written as before.
//
//   OwnKeychain.group          TEAM.<bundle ID> from keychain-access-groups, or nil
//   OwnKeychain.scoped(attrs)  attrs + kSecAttrAccessGroup = group, for SecItemAdd
//   OwnKeychain.move(query)    what query finds in another group goes to ours (SecItemUpdate of the access group)
//   OwnKeychain.moveAll()      at launch (sideload build): every store's items, the payment secrets excepted (they
//                              move when read: Keychain.get, Paid.swift, as reading them already asks for Face ID)
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Security

enum OwnKeychain {
    static let group: String? = pick(entitlement("keychain-access-groups") as? [String] ?? [],
                                     bundleID: Bundle.main.bundleIdentifier ?? "")

    // "TEAM.<bundleID>": a team prefix (no dots) before the bundle ID.
    static func pick(_ groups: [String], bundleID: String) -> String? {
        guard !bundleID.isEmpty else { return nil }
        return groups.first { g in
            guard g.hasSuffix("." + bundleID) else { return false }
            let team = g.dropLast(bundleID.count + 1)
            return !team.isEmpty && !team.contains(".")
        }
    }

    static func scoped(_ attrs: [String: Any]) -> [String: Any] {
        var a = attrs
        if let g = group { a[kSecAttrAccessGroup as String] = g }
        return a
    }

    // Moves the items `query` matches out of every other group the app can reach into its own. An item already in
    // ours wins (it was written later); the other copy is deleted.
    static func move(_ query: [String: Any]) {
        guard let g = group else { return }
        var q = query
        q[kSecReturnAttributes as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitAll
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let items = out as? [[String: Any]] else { return }
        for old in Set(items.compactMap { $0[kSecAttrAccessGroup as String] as? String }) where old != g {
            var from = query
            from[kSecAttrAccessGroup as String] = old
            let st = SecItemUpdate(from as CFDictionary, [kSecAttrAccessGroup as String: g] as CFDictionary)
            if st == errSecDuplicateItem { SecItemDelete(from as CFDictionary) }
            NSLog("\(Brand.name) keychain: moved \(query[kSecAttrService as String] ?? query[kSecClass as String] ?? "?") from \(old) to \(g): \(st)")
        }
    }

    static func moveAll() {
        guard group != nil else { return }
        move(SignStore.p12Query)
        for q in SignStore.identityQueries() { move(q) }
        move(ASC.query)
        move(AccountKey.query)
        move(ReviewToken.query)
    }

    // The running signature's entitlement (SecTask, looked up at run time: not in the iOS SDK's headers).
    static func entitlement(_ key: String) -> Any? {
        typealias Create = @convention(c) (CFAllocator?) -> UnsafeMutableRawPointer?
        typealias Copy = @convention(c) (UnsafeMutableRawPointer, CFString, UnsafeMutablePointer<Unmanaged<CFError>?>?) -> Unmanaged<CFTypeRef>?
        guard let h = dlopen(nil, RTLD_NOW), let c = dlsym(h, "SecTaskCreateFromSelf"), let v = dlsym(h, "SecTaskCopyValueForEntitlement")
        else { return nil }
        let create = unsafeBitCast(c, to: Create.self), copy = unsafeBitCast(v, to: Copy.self)
        guard let task = create(nil) else { return nil }
        defer { Unmanaged<CFTypeRef>.fromOpaque(task).release() }
        return copy(task, key as CFString, nil)?.takeRetainedValue()
    }
}
