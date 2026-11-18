// Certificates for the phone's own install server (I6, docs/signing.md "Installing"): a root CA made on the phone and
// a TLS certificate for 127.0.0.1/localhost it issues. iOS only opens itms-services manifests over HTTPS it trusts;
// the user installs this CA once and turns on full trust for it. Its keys are made in the Keychain and never leave
// it, and the CA is name-constrained to localhost and 127.0.0.1, so even its own key can't vouch for any other site.
// Both certificates follow Apple's rules for TLS server certificates (RSA 2048+ or ECDSA P-256, SHA-256, the name in
// subjectAltName, serverAuth EKU, at most 825 days for the leaf).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

// An ECDSA P-256 key pair: SecKey on the phone, openssl in the Linux tests.
protocol CertKey {
    var publicKey: Data { get }                 // X9.63 uncompressed point, 65 bytes
    func sign(_ message: Data) throws -> Data   // ECDSA with SHA-256, DER signature
}

enum LocalCA {
    static let hosts = ["localhost"]
    static let ips: [[UInt8]] = [[127, 0, 0, 1]]
    static let leafDays = 365
    static let caDays = 3650

    static func name(_ cn: String) -> Data {
        DER.seq([
            DER.set([DER.seq([DER.oid("2.5.4.3"), DER.utf8(cn)])]),
            DER.set([DER.seq([DER.oid("2.5.4.10"), DER.utf8("Cydian")])]),
        ])
    }

    static func spki(_ point: Data) -> Data {
        DER.seq([DER.seq([DER.oid("1.2.840.10045.2.1"), DER.oid("1.2.840.10045.3.1.7")]), DER.bits(point)])
    }

    static func ext(_ oid: String, critical: Bool, _ value: Data) -> Data {
        DER.seq([DER.oid(oid)] + (critical ? [DER.bool(true)] : []) + [DER.octets(value)])
    }

    static func randomSerial() -> Data {
        var b = (0..<16).map { _ in UInt8.random(in: 0...255) }
        b[0] &= 0x7f
        b[0] |= 0x01
        return Data(b)
    }

    static func certificate(subject: Data, issuer: Data, subjectKey: Data, issuerKey: CertKey, serial: Data,
                            notBefore: Date, notAfter: Date, extensions: [Data]) throws -> Data {
        let alg = DER.seq([DER.oid("1.2.840.10045.4.3.2")]) // ecdsa-with-SHA256
        let tbs = DER.seq([
            DER.explicit(0, DER.int(2)),
            DER.uint(serial),
            alg,
            issuer,
            DER.seq([DER.time(notBefore), DER.time(notAfter)]),
            subject,
            spki(subjectKey),
            DER.explicit(3, DER.seq(extensions)),
        ])
        return DER.seq([tbs, alg, DER.bits(try issuerKey.sign(tbs))])
    }

    static func keyID(_ point: Data) -> Data { sha1(point) }

    // The root: CA, may sign certificates only, and only for localhost and 127.0.0.1 (critical name constraints).
    static func makeCA(key: CertKey, label: String, now: Date = Date()) throws -> Data {
        let n = name("Cydian Local Install CA (\(label))")
        let subtrees = DER.seq([DER.tlv(0x82, Data("localhost".utf8))])                // dNSName
            + DER.seq([DER.tlv(0x87, Data([127, 0, 0, 1, 255, 255, 255, 255]))])          // iPAddress/mask
        let exts = [
            ext("2.5.29.19", critical: true, DER.seq([DER.bool(true), DER.int(0)])),   // basicConstraints CA, pathLen 0
            ext("2.5.29.15", critical: true, DER.namedBits(0x06)),                   // keyCertSign | cRLSign
            ext("2.5.29.14", critical: false, DER.octets(keyID(key.publicKey))),       // subjectKeyIdentifier
            ext("2.5.29.30", critical: true, DER.seq([DER.tlv(0xA0, subtrees)])),     // nameConstraints, permitted only
        ]
        return try certificate(subject: n, issuer: n, subjectKey: key.publicKey, issuerKey: key, serial: randomSerial(),
                               notBefore: now.addingTimeInterval(-86400), notAfter: now.addingTimeInterval(Double(caDays) * 86400),
                               extensions: exts)
    }

    // The install server's certificate, issued by the root above.
    static func makeLeaf(key: Data, ca: Data, caKey: CertKey, now: Date = Date()) throws -> Data {
        let caCert = try Certificate(der: ca)
        var san = Data()
        for h in hosts { san += DER.tlv(0x82, Data(h.utf8)) }
        for ip in ips { san += DER.tlv(0x87, Data(ip)) }
        let exts = [
            ext("2.5.29.19", critical: true, DER.seq([])),                                  // not a CA
            ext("2.5.29.15", critical: true, DER.namedBits(0x80)),                        // digitalSignature
            ext("2.5.29.37", critical: false, DER.seq([DER.oid("1.3.6.1.5.5.7.3.1")])),      // serverAuth
            ext("2.5.29.17", critical: false, DER.seq([san])),                  // subjectAltName
            ext("2.5.29.35", critical: false, DER.seq([DER.tlv(0x80, keyID(caKey.publicKey))])), // authorityKeyIdentifier
            ext("2.5.29.14", critical: false, DER.octets(keyID(key))),
        ]
        return try certificate(subject: name("localhost"), issuer: caCert.subject, subjectKey: key, issuerKey: caKey,
                               serial: randomSerial(), notBefore: now.addingTimeInterval(-86400),
                               notAfter: now.addingTimeInterval(Double(leafDays) * 86400), extensions: exts)
    }

    // A configuration profile holding the root, for Settings to install ("Profile Downloaded").
    static func mobileconfig(ca: Data, label: String, uuid: String = UUID().uuidString, payloadUUID: String = UUID().uuidString) throws -> Data {
        let cert: [String: Any] = [
            "PayloadType": "com.apple.security.root",
            "PayloadVersion": 1,
            "PayloadIdentifier": "com.ryha.cydian.localca.cert",
            "PayloadUUID": payloadUUID,
            "PayloadDisplayName": "Cydian Local Install CA (\(label))",
            "PayloadCertificateFileName": "cydian-local-install-ca.cer",
            "PayloadContent": ca,
        ]
        let top: [String: Any] = [
            "PayloadType": "Configuration",
            "PayloadVersion": 1,
            "PayloadIdentifier": "com.ryha.cydian.localca",
            "PayloadUUID": uuid,
            "PayloadDisplayName": "Cydian Local Install",
            "PayloadDescription": "Lets Cydian install apps you signed on this iPhone from its own server at 127.0.0.1. "
                + "The certificate only works for localhost and 127.0.0.1, and its key never leaves Cydian.",
            "PayloadOrganization": "Cydian",
            "PayloadRemovalDisallowed": false,
            "PayloadContent": [cert],
        ]
        return try PropertyListSerialization.data(fromPropertyList: top, format: .xml, options: 0)
    }

    // The itms-services manifest for one IPA.
    static func manifest(ipaURL: String, bundleID: String, version: String, title: String) throws -> Data {
        let item: [String: Any] = [
            "assets": [["kind": "software-package", "url": ipaURL]],
            "metadata": ["bundle-identifier": bundleID, "bundle-version": version.isEmpty ? "1.0" : version,
                         "kind": "software", "title": title.isEmpty ? bundleID : title],
        ]
        return try PropertyListSerialization.data(fromPropertyList: ["items": [item]], format: .xml, options: 0)
    }

    static func itmsURL(manifest: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return "itms-services://?action=download-manifest&url=" + (manifest.addingPercentEncoding(withAllowedCharacters: allowed) ?? manifest)
    }
}
