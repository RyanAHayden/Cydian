// The little HTTP/1.1 the phone's install server speaks (I6, Sources/InstallServer.swift): parse one GET or HEAD,
// answer it with a status, headers and a byte range. Kept apart from Network.framework so the Linux tests run it.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct HTTPRequest {
    let method: String
    let path: String
    let headers: [String: String] // lower-cased names

    static let maxHeader = 16 * 1024

    // nil while the header isn't complete; throws for anything this server won't answer.
    static func parse(_ buf: Data) throws -> HTTPRequest? {
        guard let end = buf.range(of: Data("\r\n\r\n".utf8)) else {
            if buf.count > maxHeader { throw SignError("bad_request", "header too long") }
            return nil
        }
        let text = String(decoding: buf[buf.startIndex..<end.lowerBound], as: UTF8.self)
        var lines = text.components(separatedBy: "\r\n")
        let parts = lines.removeFirst().split(separator: " ")
        guard parts.count == 3, parts[2].hasPrefix("HTTP/1.") else { throw SignError("bad_request", "bad request line") }
        var headers = [String: String]()
        for l in lines {
            guard let c = l.firstIndex(of: ":") else { continue }
            headers[l[..<c].trimmingCharacters(in: .whitespaces).lowercased()] = l[l.index(after: c)...].trimmingCharacters(in: .whitespaces)
        }
        var path = String(parts[1])
        if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }
        return HTTPRequest(method: String(parts[0]), path: path, headers: headers)
    }

    // The byte range asked for (one "bytes=a-b", "a-" or "-n"), clamped to size; nil for the whole thing.
    func range(size: UInt64) -> ClosedRange<UInt64>?? {
        guard let r = headers["range"] else { return .some(nil) }
        guard r.hasPrefix("bytes="), !r.contains(","), size > 0 else { return nil } // unsatisfiable
        let spec = r.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
        guard spec.count == 2 else { return nil }
        if spec[0].isEmpty {
            guard let n = UInt64(spec[1]), n > 0 else { return nil }
            return .some(size - min(n, size)...size - 1)
        }
        guard let a = UInt64(spec[0]), a < size else { return nil }
        let b = spec[1].isEmpty ? size - 1 : min(UInt64(spec[1]) ?? size - 1, size - 1)
        guard b >= a else { return nil }
        return .some(a...b)
    }
}

enum HTTPResponse {
    static func head(_ status: Int, _ headers: [(String, String)]) -> Data {
        let reason = [200: "OK", 206: "Partial Content", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed",
                      416: "Range Not Satisfiable"][status] ?? "OK"
        var s = "HTTP/1.1 \(status) \(reason)\r\n"
        for (k, v) in headers + [("Connection", "close"), ("Cache-Control", "no-store")] { s += "\(k): \(v)\r\n" }
        return Data((s + "\r\n").utf8)
    }
}
