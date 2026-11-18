// F75: what reaches the sideload build from the website, the pure half (the Linux tests build it; App.swift and
// SignBridge.swift do the UIKit and Keychain half). docs/signing.md, "From the website to the app (F75)".
//
//   BundledIdentity    Payload/Cydian.app/cydian-identity.plist: the user's .p12, password and profile, which the
//                      Signing Server adds to Cydian's own IPA when Install Cydian App asks (bring: true). Imported
//                      into the Keychain on the first launch that finds it, unless the Keychain already holds one;
//                      the bundle is read-only, so its digest is remembered and the same file is never looked at again.
//   IncomingLink       which cydian:// links the shell hands to the page: cydian://import?d=… (sources and settings)
//                      and cydian://signing-import#… (Import from Safari's ciphertext); nothing else, nothing huge.
//   gunzip(_:)         a gzip member's contents, for the page on an iOS without DecompressionStream (app.gunzip)
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum BundledIdentity {
    static let fileName = "cydian-identity.plist"
    static let seenKey = "cydian.bundledIdentity" // UserDefaults: the digest of the file last looked at

    struct Contents { let p12: Data; let password: String; let profile: Data }

    // { p12: data, password: string, profile: data } as a property list; nil for anything else.
    static func parse(_ data: Data) -> Contents? {
        guard data.count < 1 << 20,
              let d = (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any],
              let p12 = d["p12"] as? Data, !p12.isEmpty, let profile = d["profile"] as? Data, !profile.isEmpty else { return nil }
        return Contents(p12: p12, password: d["password"] as? String ?? "", profile: profile)
    }

    static func digest(_ data: Data) -> String { sha256(data).map { String(format: "%02x", $0) }.joined() }

    // Import this file? Only when it is new (not the one already looked at) and the Keychain holds no identity.
    static func shouldImport(digest: String, seen: String?, hasIdentity: Bool) -> Bool {
        !hasIdentity && digest != seen
    }
}

enum IncomingLink {
    static let hosts: Set<String> = ["import", "signing-import"]
    static let maxLength = 512 * 1024

    static func accepts(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "cydian", let host = url.host?.lowercased(), hosts.contains(host) else { return false }
        return url.absoluteString.utf8.count <= maxLength
    }
}

// RFC 1952: the header (with any optional fields), raw deflate, then CRC-32 and size, both checked. At most `limit`
// bytes out.
func gunzip(_ d: Data, limit: Int = 8 << 20) throws -> Data {
    let b = [UInt8](d)
    guard b.count >= 18, b[0] == 0x1f, b[1] == 0x8b, b[2] == 8 else { throw ZipError("not gzip data") }
    let flags = b[3]
    var i = 10
    if flags & 4 != 0 { guard i + 2 <= b.count else { throw ZipError("cut short") }; i += 2 + Int(b[i]) + Int(b[i + 1]) << 8 }
    for bit: UInt8 in [8, 16] where flags & bit != 0 { // a file name, a comment: zero-terminated
        while i < b.count && b[i] != 0 { i += 1 }
        i += 1
    }
    if flags & 2 != 0 { i += 2 }
    guard i + 8 <= b.count else { throw ZipError("cut short") }
    var out = Data()
    let inf = try Inflater()
    try inf.feed(Data(b[i..<(b.count - 8)])) { piece in
        out.append(piece)
        if out.count > limit { throw ZipError("too large") }
    }
    guard inf.done else { throw ZipError("cut short") }
    guard crc32Of(out) == le32(b, b.count - 8), UInt32(truncatingIfNeeded: out.count) == le32(b, b.count - 4) else {
        throw ZipError("checksum mismatch")
    }
    return out
}
