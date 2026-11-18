// The sideload build's signing identity (I6): the user's .p12 goes into the iOS Keychain (this device only, never
// synced or backed up) and is used there. F73: the imported .p12 file and its password are also kept, as one Keychain
// generic-password item (this device only), so signing.export can hand them to the Signing Server when Cydian updates
// itself (essential-ui.js installSelf); signing.remove deletes it with the identity. The profile is a plain file in
// Application Support (it holds no secret). Also the keys of the phone's local install CA
// (native/sign/LocalCA.swift), made in the Keychain and never exported. docs/signing.md, "On the phone (I6)".
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
    static let certKey = "cydian.signing.certSHA256"
    static let label = "Cydian signing identity"

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

    static let p12Service = "com.ryha.cydian.signing.p12"
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
        add[kSecAttrLabel as String] = "Cydian signing .p12"
        let st = SecItemAdd(add as CFDictionary, nil)
        guard st == errSecSuccess else { throw SignError("keychain", "The Keychain refused the .p12 (\(st)).") }
    }

    // The kept .p12 and password, when they belong to the identity in use; nil when there is none (no certificate,
    // or one imported before F73: the user imports it again for Cydian to update itself through the Signing Server).
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

    // ---- keys made on the phone (the local install CA and its TLS key)

    static func key(tag: String, create: Bool) -> SecKey? {
        let t = Data(tag.utf8)
        let q: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: t,
                                kSecAttrKeyClass as String: kSecAttrKeyClassPrivate, kSecReturnRef as String: true]
        var out: CFTypeRef?
        if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let k = out { return (k as! SecKey) } // swiftlint:disable:this force_cast
        guard create else { return nil }
        let attrs: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: t,
                                            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly],
        ]
        return SecKeyCreateRandomKey(attrs as CFDictionary, nil)
    }

    static func deleteKey(tag: String) {
        SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: Data(tag.utf8)] as CFDictionary)
    }
}

// The Keychain identity as the signer sees it: the key signs inside Security.framework, the certificates go into
// the CMS with Apple's WWDR intermediate and root (bundled in Cydian.app/certs/, public certificates from
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

struct KeychainCertKey: CertKey {
    let key: SecKey
    var publicKey: Data {
        guard let pub = SecKeyCopyPublicKey(key), let d = SecKeyCopyExternalRepresentation(pub, nil) else { return Data() }
        return d as Data
    }
    func sign(_ message: Data) throws -> Data {
        var err: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, message as CFData, &err) else {
            throw SignError("keychain", "The Keychain couldn't sign: \(err?.takeRetainedValue().localizedDescription ?? "?")")
        }
        return sig as Data
    }
}

// The phone's own install CA (LocalCA.swift): made once, installed by the user as a profile and trusted in Settings >
// General > About > Certificate Trust Settings. The TLS certificate it issues is renewed a month before it ends.
enum LocalTrust {
    static let caTag = "com.ryha.cydian.localca"
    static let tlsTag = "com.ryha.cydian.localtls"
    static var caURL: URL { SignStore.dir.appendingPathComponent("localca.der") }
    static var leafURL: URL { SignStore.dir.appendingPathComponent("localtls.der") }
    static let leafLabel = "Cydian local install TLS"

    static func ca() -> Data? { try? Data(contentsOf: caURL) }

    // The CA, made if there is none yet.
    static func ensureCA() throws -> Data {
        if let d = ca(), SignStore.key(tag: caTag, create: false) != nil { return d }
        guard let key = SignStore.key(tag: caTag, create: true) else { throw SignError("keychain", "Couldn't make a key for the local CA.") }
        let label = String(format: "%04X", UInt16.random(in: 0...0xFFFF))
        let der = try LocalCA.makeCA(key: KeychainCertKey(key: key), label: "iPhone \(label)")
        try der.write(to: caURL, options: .atomic)
        try? FileManager.default.removeItem(at: leafURL)
        return der
    }

    // The install server's TLS identity: the leaf certificate in the Keychain beside its key, so iOS pairs them.
    static func tlsIdentity() throws -> SecIdentity {
        let ca = try ensureCA()
        guard let caKey = SignStore.key(tag: caTag, create: false) else { throw SignError("keychain", "The local CA's key is gone.") }
        var leaf = try? Data(contentsOf: leafURL)
        if let l = leaf, let c = try? Certificate(der: l), (c.notAfter ?? .distantPast) > Date().addingTimeInterval(30 * 86400),
           c.issuer == (try Certificate(der: ca)).subject {
            // still good
        } else {
            leaf = nil
        }
        if leaf == nil {
            SignStore.deleteKey(tag: tlsTag)
            SecItemDelete([kSecClass as String: kSecClassCertificate, kSecAttrLabel as String: leafLabel] as CFDictionary)
            guard let k = SignStore.key(tag: tlsTag, create: true) else { throw SignError("keychain", "Couldn't make the TLS key.") }
            let der = try LocalCA.makeLeaf(key: KeychainCertKey(key: k).publicKey, ca: ca, caKey: KeychainCertKey(key: caKey))
            guard let cert = SecCertificateCreateWithData(nil, der as CFData) else { throw SignError("internal", "Bad TLS certificate.") }
            let st = SecItemAdd([kSecClass as String: kSecClassCertificate, kSecValueRef as String: cert,
                                 kSecAttrLabel as String: leafLabel,
                                 kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly] as CFDictionary, nil)
            guard st == errSecSuccess || st == errSecDuplicateItem else { throw SignError("keychain", "The Keychain refused the TLS certificate (\(st)).") }
            try der.write(to: leafURL, options: .atomic)
            leaf = der
        }
        let q: [String: Any] = [kSecClass as String: kSecClassIdentity, kSecMatchLimit as String: kSecMatchLimitAll,
                                kSecReturnRef as String: true]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let all = out as? [SecIdentity],
              let id = all.first(where: { SignStore.certificateDER($0) == leaf }) else {
            throw SignError("keychain", "The Keychain didn't pair the TLS certificate with its key.")
        }
        return id
    }

    // Whether iOS trusts the local CA for TLS to 127.0.0.1: the user installed the profile and turned on full trust.
    static func trusted() -> Bool {
        guard let ca = ca() else { return false }
        let leafDER = (try? Data(contentsOf: leafURL)) ?? (try? tlsIdentity()).flatMap(SignStore.certificateDER)
        guard let leaf = leafDER, let lc = SecCertificateCreateWithData(nil, leaf as CFData), let cc = SecCertificateCreateWithData(nil, ca as CFData)
        else { return false }
        var trust: SecTrust?
        guard SecTrustCreateWithCertificates([lc, cc] as CFArray, SecPolicyCreateSSL(true, "127.0.0.1" as CFString), &trust) == errSecSuccess,
              let t = trust else { return false }
        return SecTrustEvaluateWithError(t, nil)
    }

    static func label() -> String? {
        ca().flatMap { try? Certificate(der: $0) }?.commonName
    }

    static func reset() {
        SignStore.deleteKey(tag: caTag)
        SignStore.deleteKey(tag: tlsTag)
        SecItemDelete([kSecClass as String: kSecClassCertificate, kSecAttrLabel as String: leafLabel] as CFDictionary)
        try? FileManager.default.removeItem(at: caURL)
        try? FileManager.default.removeItem(at: leafURL)
    }
}
