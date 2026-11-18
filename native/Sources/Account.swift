// F97: iFizBox Account's key in the Keychain (web/app/screens/account.js keyStore). The key is the whole account, so
// it lives where the certificate does: this device only, never in a backup, readable after the first unlock (the
// page reads it at every launch, so no Face ID). Everything else about the account is the page's (core/account.js).
//
//   account.key.get     -> the key's code | null
//   account.key.set {key}
//   account.key.remove
//
// F186: F182's review token (web/app/core/reviews.js deviceToken) beside it, so a reinstall keeps the same review.
// The token is only "this device wrote that review" (no account, no secret beyond it), kept the same way.
//
//   reviews.token.get   -> the token | null
//   reviews.token.set {token}
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Security

enum AccountKey {
    static let service = "com.ryha.ifizbox.account"
    static let account = "key"

    static func register(_ b: Bridge) {
        b.on("account.key.get") { c in Apt.work(c) { () throws -> Any? in try get() } }
        b.on("account.key.set") { c in
            Apt.work(c) { () throws -> Any? in
                guard let k = c.params["key"] as? String, !k.isEmpty, k.utf8.count <= 128 else { throw BridgeError("keychain", "no key") }
                try set(k)
                return true
            }
        }
        b.on("account.key.remove") { c in Apt.work(c) { () throws -> Any? in try remove(); return true } }
        ReviewToken.register(b) // F186: registered here so Bridge.swift keeps one line for this file
    }

    static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func get() throws -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &out)
        if st == errSecItemNotFound { return nil }
        guard st == errSecSuccess, let d = out as? Data else { throw BridgeError("keychain", "the Keychain refused (\(st))") }
        return String(decoding: d, as: UTF8.self)
    }

    static func set(_ key: String) throws {
        try remove()
        var add = query
        add[kSecValueData as String] = Data(key.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let st = SecItemAdd(add as CFDictionary, nil)
        guard st == errSecSuccess else { throw BridgeError("keychain", "the Keychain refused the account key (\(st))") }
    }

    static func remove() throws {
        let st = SecItemDelete(query as CFDictionary)
        guard st == errSecSuccess || st == errSecItemNotFound else { throw BridgeError("keychain", "the Keychain refused to remove it (\(st))") }
    }
}

enum ReviewToken {
    static let service = "com.ryha.ifizbox.reviews"
    static let account = "token"

    static func register(_ b: Bridge) {
        b.on("reviews.token.get") { c in Apt.work(c) { () throws -> Any? in try get() } }
        b.on("reviews.token.set") { c in
            Apt.work(c) { () throws -> Any? in
                // The same shape the Worker accepts (core/reviews.js TOKEN): 32-128 of [A-Za-z0-9_-].
                guard let t = c.params["token"] as? String, (32...128).contains(t.utf8.count),
                      t.utf8.allSatisfy({ ch in
                          (ch >= 0x30 && ch <= 0x39) || (ch >= 0x41 && ch <= 0x5A) || (ch >= 0x61 && ch <= 0x7A) || ch == 0x2D || ch == 0x5F
                      })
                else { throw BridgeError("keychain", "no token") }
                try set(t)
                return true
            }
        }
    }

    static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func get() throws -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &out)
        if st == errSecItemNotFound { return nil }
        guard st == errSecSuccess, let d = out as? Data else { throw BridgeError("keychain", "the Keychain refused (\(st))") }
        return String(decoding: d, as: UTF8.self)
    }

    static func set(_ token: String) throws {
        let st0 = SecItemDelete(query as CFDictionary)
        guard st0 == errSecSuccess || st0 == errSecItemNotFound else { throw BridgeError("keychain", "the Keychain refused (\(st0))") }
        var add = query
        add[kSecValueData as String] = Data(token.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let st = SecItemAdd(add as CFDictionary, nil)
        guard st == errSecSuccess else { throw BridgeError("keychain", "the Keychain refused the review token (\(st))") }
    }
}
