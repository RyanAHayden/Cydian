import Foundation

// A URL string from a source made one URL(string:) takes on every iOS: characters a URL can't hold (a space,
// quotes, <>, {}, |, ^, `, \, [ ] after the host, non-ASCII, a % that doesn't start %XX) are percent-encoded
// (UTF-8); existing %XX escapes are kept, so an encoded URL comes back unchanged. Before iOS 17 URL(string:) returns
// nil for "…/YouTube Icon.png", and iOS 15 has no encodingInvalidCharacters. Only the part after the host is
// touched. The page does the same first (web/app/core/urlencode.js); Apt.httpURL calls this as a backstop.
// Foundation only, so native/test_urlencode.py builds and runs it on Linux.
enum URLText {
    private static let allowed: Set<UInt8> = Set(Array(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#@!$&'()*+,;=".utf8))

    private static func isHex(_ b: UInt8) -> Bool {
        (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66)
    }

    static func encoded(_ raw: String) -> String {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let sep = s.range(of: "://") else { return s }
        let scheme = s[..<sep.lowerBound]
        guard let first = scheme.unicodeScalars.first, first.isASCII, CharacterSet.letters.contains(first),
              scheme.unicodeScalars.allSatisfy({ $0.isASCII && (CharacterSet.alphanumerics.contains($0) || "+.-".unicodeScalars.contains($0)) })
        else { return s }
        let hostEnd = s[sep.upperBound...].firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) ?? s.endIndex
        let tail = Array(s[hostEnd...].utf8)
        var out = String(s[..<hostEnd])
        var i = 0
        while i < tail.count {
            let b = tail[i]
            if b == 0x25, i + 2 < tail.count, isHex(tail[i + 1]), isHex(tail[i + 2]) {
                out += "%"; i += 1; continue
            }
            if b != 0x25, allowed.contains(b) { out.unicodeScalars.append(Unicode.Scalar(b)) } else { out += String(format: "%%%02X", b) }
            i += 1
        }
        return out
    }
}
