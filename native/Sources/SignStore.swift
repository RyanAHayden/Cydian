// The sideload build's signing identity (I6): the user's .p12 goes into the iOS Keychain (this device only, never
// synced or backed up) and is used there. F73: the imported .p12 file and its password are also kept, as one Keychain
// generic-password item (this device only), so signing.export can hand them to iFizBox Account's certificate sync
// (screens/account.js); signing.remove deletes it with the identity. The profile is a plain file in
// Application Support (it holds no secret). docs/signing.md, "On the phone (I6)".
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Security

enum SignStore {
    static let dir: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Signing", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    static var profileURL: URL { dir.appendingPathComponent("profile.mobileprovision") }
    static let certKey = "ifizbox.signing.certSHA256"
    static let label = "\(Brand.name) signing identity"

    // ---- the user's identity

    static func importIdentity(p12: Data, password: String, profile profileData: Data) throws -> Profile {
        let profile = try Profile(profileData)
        var items: CFArray?
        let rc = SecPKCS12Import(p12 as CFData, [kSecImportExportPassphrase as String: password] as CFDictionary, &items)
        if rc == errSecAuthFailed { throw SignError("wrong_password", "The password doesn't open that .p12.") }
        guard rc == errSecSuccess, let first = (items as? [[String: Any]])?.first,
              let idRef = first[kSecImportItemIdentity as String] else {
            throw SignError("bad_p12", "That file isn't a .p12 with a certificate and its key (\(rc)).")
        }
        let identity = idRef as! SecIdentity // swiftlint:disable:this force_cast
        var certRef: SecCertificate?
        guard SecIdentityCopyCertificate(identity, &certRef) == errSecSuccess, let cert = certRef else {
            throw SignError("bad_p12", "The .p12 has no certificate.")
        }
        let der = SecCertificateCopyData(cert) as Data
        if let problem = profile.problem(with: der) { throw problem }
        removeIdentity()
        let add: [String: Any] = [kSecValueRef as String: identity, kSecAttrLabel as String: label,
                                  kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var st = SecItemAdd(add as CFDictionary, nil)
        if st == errSecDuplicateItem { // the same identity imported before: keep that one
            st = errSecSuccess
        }
        guard st == errSecSuccess else { throw SignError("keychain", "The Keychain refused the identity (\(st)).") }
        try keepP12(p12, password: password, certSHA256: sha256(der).base64EncodedString()) // F73
        try profileData.write(to: profileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        UserDefaults.standard.set(sha256(der).base64EncodedString(), forKey: certKey)
        return profile
    }

    static func identity() -> SecIdentity? {
        guard let want = UserDefaults.standard.string(forKey: certKey) else { return nil }
        let q: [String: Any] = [kSecClass as String: kSecClassIdentity, kSecMatchLimit as String: kSecMatchLimitAll,
                                kSecReturnRef as String: true]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let all = out as? [SecIdentity] else { return nil }
        return all.first { certificateDER($0).map { sha256($0).base64EncodedString() } == want }
    }

    static func certificateDER(_ id: SecIdentity) -> Data? {
        var c: SecCertificate?
        guard SecIdentityCopyCertificate(id, &c) == errSecSuccess, let cert = c else { return nil }
        return SecCertificateCopyData(cert) as Data
    }

    static func profile() -> Profile? {
        (try? Data(contentsOf: profileURL)).flatMap { try? Profile($0) }
    }

    static func removeIdentity() {
        if let id = identity() {
            var c: SecCertificate?
            var k: SecKey?
            if SecIdentityCopyCertificate(id, &c) == errSecSuccess, let c = c {
                SecItemDelete([kSecClass as String: kSecClassCertificate, kSecValueRef as String: c] as CFDictionary)
            }
            if SecIdentityCopyPrivateKey(id, &k) == errSecSuccess, let k = k {
                SecItemDelete([kSecClass as String: kSecClassKey, kSecValueRef as String: k] as CFDictionary)
            }
        }
        deleteP12() // F73
        UserDefaults.standard.removeObject(forKey: certKey)
        try? FileManager.default.removeItem(at: profileURL)
    }

    // ---- F73: the .p12 as imported, for signing.export

    static let p12Service = "com.ryha.ifizbox.signing.p12"
    static let p12Account = "identity"
    static var p12Query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: p12Service,
         kSecAttrAccount as String: p12Account]
    }

    // One generic-password item: a binary plist {p12, password, cert} (cert: the certificate's SHA-256, base64, so a
    // stale item never goes out with another identity). This device only: never synced to iCloud or in a backup.
    static func keepP12(_ p12: Data, password: String, certSHA256: String) throws {
        deleteP12()
        let blob = try PropertyListSerialization.data(fromPropertyList: ["p12": p12, "password": password, "cert": certSHA256],
                                                      format: .binary, options: 0)
        var add = p12Query
        add[kSecValueData as String] = blob
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        add[kSecAttrLabel as String] = "\(Brand.name) signing .p12"
        let st = SecItemAdd(add as CFDictionary, nil)
        guard st == errSecSuccess else { throw SignError("keychain", "The Keychain refused the .p12 (\(st)).") }
    }

    // The kept .p12 and password, when they belong to the identity in use; nil when there is none (no certificate,
    // or one imported before F73: the user imports it again for iFizBox to update itself through the Signing Server).
    static func exportP12() -> (p12: Data, password: String)? {
        guard let want = UserDefaults.standard.string(forKey: certKey) else { return nil }
        var q = p12Query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let blob = out as? Data,
              let d = try? PropertyListSerialization.propertyList(from: blob, format: nil) as? [String: Any],
              let p12 = d["p12"] as? Data, let pw = d["password"] as? String, d["cert"] as? String == want else { return nil }
        return (p12, pw)
    }

    static func deleteP12() {
        SecItemDelete(p12Query as CFDictionary)
    }

    // ---- F75: what the old local HTTPS install mode left behind (its CA and TLS keys, their certificates)

    static func deleteKey(tag: String) {
        SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: Data(tag.utf8)] as CFDictionary)
    }

    // Once per launch at most, cheap when there is nothing: the CA and TLS keys, the TLS certificate and the two
    // DER files of 0.1.x's Local Install, which nothing uses any more. The user removes the old profile in Settings.
    static func removeOldInstallCA() {
        let ca = dir.appendingPathComponent("localca.der"), leaf = dir.appendingPathComponent("localtls.der")
        guard FileManager.default.fileExists(atPath: ca.path) || FileManager.default.fileExists(atPath: leaf.path) else { return }
        deleteKey(tag: "com.ryha.ifizbox.localca")
        deleteKey(tag: "com.ryha.ifizbox.localtls")
        SecItemDelete([kSecClass as String: kSecClassCertificate, kSecAttrLabel as String: "\(Brand.name) local install TLS"] as CFDictionary)
        try? FileManager.default.removeItem(at: ca)
        try? FileManager.default.removeItem(at: leaf)
    }
}

// The Keychain identity as the signer sees it: the key signs inside Security.framework, the certificates go into
// the CMS with Apple's WWDR intermediate and root (bundled in iFizBox.app/certs/, public certificates from
// apple.com/certificateauthority) so iOS can build the chain.
struct KeychainIdentity: SigningIdentity {
    let key: SecKey
    let certificate: Data
    let chain: [Data]
    let signatureAlgorithm: String

    init(_ id: SecIdentity) throws {
        var k: SecKey?
        guard SecIdentityCopyPrivateKey(id, &k) == errSecSuccess, let key = k, let der = SignStore.certificateDER(id) else {
            throw SignError("keychain", "The signing identity can't be read from the Keychain.")
        }
        self.key = key
        certificate = der
        let type = (SecKeyCopyAttributes(key) as? [String: Any])?[kSecAttrKeyType as String] as? String
        signatureAlgorithm = type == (kSecAttrKeyTypeECSECPrimeRandom as String) ? "1.2.840.10045.4.3.2" : "1.2.840.113549.1.1.1"
        chain = KeychainIdentity.issuers(of: der)
    }

    static func issuers(of leaf: Data) -> [Data] {
        guard let dir = Bundle.main.resourceURL?.appendingPathComponent("certs"),
              let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
        let pool = names.filter { $0.hasSuffix(".cer") }.compactMap { try? Data(contentsOf: dir.appendingPathComponent($0)) }
            .compactMap { try? Certificate(der: $0) }
        var out = [Data]()
        var cur = try? Certificate(der: leaf)
        while let c = cur, c.issuer != c.subject, let up = pool.first(where: { $0.subject == c.issuer }), !out.contains(up.der) {
            out.append(up.der)
            cur = up
        }
        return out
    }

    func sign(_ message: Data) throws -> Data {
        let alg: SecKeyAlgorithm = signatureAlgorithm == "1.2.840.10045.4.3.2"
            ? .ecdsaSignatureMessageX962SHA256 : .rsaSignatureMessagePKCS1v15SHA256
        var err: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(key, alg, message as CFData, &err) else {
            throw SignError("keychain", "The Keychain couldn't sign: \(err?.takeRetainedValue().localizedDescription ?? "?")")
        }
        return sig as Data
    }
}
