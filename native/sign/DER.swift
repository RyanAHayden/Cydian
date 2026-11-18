// ASN.1 DER, just what the on-device signer (I6) needs: building CMS signatures, X.509 certificates for the local
// install CA and DER entitlements, and reading the few certificate fields signing uses.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum DER {
    static func length(_ n: Int) -> [UInt8] {
        if n < 0x80 { return [UInt8(n)] }
        var bytes = [UInt8]()
        var v = n
        while v > 0 { bytes.insert(UInt8(v & 0xff), at: 0); v >>= 8 }
        return [0x80 | UInt8(bytes.count)] + bytes
    }

    static func tlv(_ tag: UInt8, _ body: Data) -> Data {
        var d = Data([tag])
        d.append(contentsOf: length(body.count))
        d.append(body)
        return d
    }

    static func seq(_ items: [Data]) -> Data { tlv(0x30, items.reduce(Data(), +)) }
    static func set(_ items: [Data]) -> Data { tlv(0x31, items.reduce(Data(), +)) }
    // A SET OF in DER order (sorted by encoding), as signed attributes must be.
    static func setOf(_ items: [Data]) -> Data {
        tlv(0x31, items.sorted { $0.lexicographicallyPrecedes($1) }.reduce(Data(), +))
    }
    static func explicit(_ n: UInt8, _ body: Data) -> Data { tlv(0xA0 | n, body) }
    static func implicitCons(_ n: UInt8, _ body: Data) -> Data { tlv(0xA0 | n, body) }
    static func octets(_ d: Data) -> Data { tlv(0x04, d) }
    static func bits(_ d: Data) -> Data { tlv(0x03, Data([0]) + d) }
    static func utf8(_ s: String) -> Data { tlv(0x0C, Data(s.utf8)) }
    static let null = Data([0x05, 0x00])
    static func bool(_ b: Bool) -> Data { Data([0x01, 0x01, b ? 0xFF : 0x00]) }

    static func int(_ v: Int) -> Data {
        var bytes = [UInt8]()
        var x = v
        repeat { bytes.insert(UInt8(truncatingIfNeeded: x), at: 0); x >>= 8 } while x != 0 && x != -1
        if v >= 0 && bytes[0] & 0x80 != 0 { bytes.insert(0, at: 0) }
        if v < 0 && bytes[0] & 0x80 == 0 { bytes.insert(0xFF, at: 0) }
        return tlv(0x02, Data(bytes))
    }

    static func oid(_ s: String) -> Data {
        let parts = s.split(separator: ".").map { UInt64($0)! }
        var body = [UInt8(parts[0] * 40 + parts[1])]
        for p in parts.dropFirst(2) {
            var chunk = [UInt8(p & 0x7f)]
            var v = p >> 7
            while v > 0 { chunk.insert(UInt8(v & 0x7f) | 0x80, at: 0); v >>= 7 }
            body += chunk
        }
        return tlv(0x06, Data(body))
    }

    // UTCTime until 2049, GeneralizedTime after (RFC 5280 4.1.2.5).
    static func time(_ date: Date) -> Data {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        let year = Calendar(identifier: .gregorian).dateComponents(in: f.timeZone, from: date).year ?? 2000
        if year < 2050 {
            f.dateFormat = "yyMMddHHmmss'Z'"
            return tlv(0x17, Data(f.string(from: date).utf8))
        }
        f.dateFormat = "yyyyMMddHHmmss'Z'"
        return tlv(0x18, Data(f.string(from: date).utf8))
    }

    // ---- reading

    struct Node {
        let tag: UInt8
        let header: Int     // bytes of tag + length
        let raw: Data       // the whole TLV
        var body: Data { raw.subdata(in: raw.startIndex + header..<raw.endIndex) }
        var children: [Node] { (try? DER.parseAll(body)) ?? [] }
    }

    struct Bad: Error {}

    static func parse(_ d: Data, at start: Int? = nil) throws -> Node {
        var i = start ?? d.startIndex
        guard i + 2 <= d.endIndex else { throw Bad() }
        let tag = d[i]
        i += 1
        var len = Int(d[i])
        i += 1
        if len & 0x80 != 0 {
            let n = len & 0x7f
            guard n > 0, n <= 4, i + n <= d.endIndex else { throw Bad() }
            len = 0
            for _ in 0..<n { len = len << 8 | Int(d[i]); i += 1 }
        }
        let s = start ?? d.startIndex
        guard i + len <= d.endIndex else { throw Bad() }
        return Node(tag: tag, header: i - s, raw: d.subdata(in: s..<i + len))
    }

    static func parseAll(_ d: Data) throws -> [Node] {
        var out = [Node]()
        var i = d.startIndex
        while i < d.endIndex {
            let n = try parse(d, at: i)
            out.append(n)
            i += n.raw.count
        }
        return out
    }

    static func oidString(_ n: Node) -> String {
        let b = [UInt8](n.body)
        guard let first = b.first else { return "" }
        var parts = [UInt64(first / 40), UInt64(first % 40)]
        var v: UInt64 = 0
        for x in b.dropFirst() {
            v = v << 7 | UInt64(x & 0x7f)
            if x & 0x80 == 0 { parts.append(v); v = 0 }
        }
        return parts.map(String.init).joined(separator: ".")
    }

    static func date(_ n: Node) -> Date? {
        guard let s = String(data: n.body, encoding: .ascii) else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = n.tag == 0x17 ? "yyMMddHHmmss'Z'" : "yyyyMMddHHmmss'Z'"
        return f.date(from: s)
    }
}

// The fields of an X.509 certificate the signer needs.
struct Certificate {
    let der: Data
    let serial: Data        // the INTEGER's TLV
    let issuer: Data        // the issuer Name's TLV
    let subject: Data       // the subject Name's TLV
    let notBefore: Date?
    let notAfter: Date?
    let spki: Data          // SubjectPublicKeyInfo TLV

    init(der: Data) throws {
        self.der = der
        let cert = try DER.parse(der)
        guard cert.tag == 0x30, let tbs = cert.children.first, tbs.tag == 0x30 else { throw DER.Bad() }
        var f = tbs.children
        if f.first?.tag == 0xA0 { f.removeFirst() } // version
        guard f.count >= 6 else { throw DER.Bad() }
        serial = f[0].raw
        issuer = f[2].raw
        let validity = f[3].children
        notBefore = validity.count == 2 ? DER.date(validity[0]) : nil
        notAfter = validity.count == 2 ? DER.date(validity[1]) : nil
        subject = f[4].raw
        spki = f[5].raw
    }

    // A name's attribute by OID (2.5.4.3 CN, 2.5.4.11 OU), as text.
    static func attribute(_ name: Data, _ oid: String) -> String? {
        guard let n = try? DER.parse(name) else { return nil }
        for rdn in n.children {
            for atv in rdn.children {
                let kv = atv.children
                if kv.count == 2, DER.oidString(kv[0]) == oid { return String(data: kv[1].body, encoding: .utf8) }
            }
        }
        return nil
    }

    var commonName: String? { Certificate.attribute(subject, "2.5.4.3") }
    var team: String? { Certificate.attribute(subject, "2.5.4.11") }
}
