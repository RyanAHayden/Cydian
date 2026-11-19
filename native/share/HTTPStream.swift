// F238: one HTTP/1.1 answer decoded as its bytes arrive, for a download that streams to a file (a .deb from a plain
// http repo, App/ShareBridge.swift's share.debFetch through Sources/Icons.swift's PlainDownload). Kept apart from
// Network.framework so the Linux tests (tests/main.swift) run it.
//
//   let d = HTTPStream()
//   let body = try d.feed(bytes)   // the body bytes this piece completes (none until the head is in)
//   d.status, d.headers, d.length  // once d.headed: the final answer's status, lower-cased headers, Content-Length
//   d.finished                     // the body is whole (Content-Length reached, the last chunk read)
//   try d.end()                    // the connection closed: throws unless the body is whole or close-delimited
//
// 1xx answers before the final one are skipped. Errors are HTTPStreamError, its text the bridge's "<code>: <message>".
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct HTTPStreamError: Error, Equatable {
    let text: String
    init(_ code: String, _ message: String) { text = "\(code): \(message)" }
}

final class HTTPStream {
    static let maxHead = 32 << 10

    private(set) var headed = false
    private(set) var status = 0
    private(set) var headers: [String: String] = [:]
    private(set) var length: Int64?
    private(set) var finished = false
    private(set) var received: Int64 = 0 // body bytes handed out so far

    private enum Body { case length(Int64), chunked, close }
    private enum Chunk { case size, data(Int64), dataEnd, trailer }
    private var buf = [UInt8]()
    private var body = Body.close
    private var chunk = Chunk.size

    func feed(_ data: Data) throws -> Data {
        if finished { return Data() }
        buf.append(contentsOf: data)
        if !headed {
            while true {
                guard let end = HTTPStream.find(buf, [13, 10, 13, 10], from: 0) else {
                    if buf.count > HTTPStream.maxHead { throw HTTPStreamError("upstream", "the answer's header is too long") }
                    return Data()
                }
                let head = String(decoding: buf[0..<end], as: UTF8.self).components(separatedBy: "\r\n")
                buf.removeFirst(end + 4)
                let parts = head.first?.split(separator: " ") ?? []
                guard parts.count >= 2, parts[0].hasPrefix("HTTP/1."), let st = Int(parts[1]), (100...999).contains(st) else {
                    throw HTTPStreamError("upstream", "not an HTTP answer")
                }
                if (100..<200).contains(st) && st != 101 { continue } // 100 Continue and friends: the real one follows
                var hs: [String: String] = [:]
                for line in head.dropFirst() {
                    guard let colon = line.firstIndex(of: ":") else { continue }
                    hs[line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                }
                status = st
                headers = hs
                headed = true
                if hs["transfer-encoding"]?.lowercased().contains("chunked") == true {
                    body = .chunked
                } else if let cl = hs["content-length"] {
                    guard let n = Int64(cl), n >= 0 else { throw HTTPStreamError("upstream", "a bad Content-Length") }
                    length = n
                    body = .length(n)
                } else if st == 204 || st == 304 {
                    body = .length(0)
                } else {
                    body = .close
                }
                break
            }
        }
        var out = [UInt8]()
        switch body {
        case .close:
            out = buf
            buf.removeAll()
        case .length(let n):
            let take = Int(min(Int64(buf.count), n - received))
            out = Array(buf[0..<take])
            buf.removeAll()
            if received + Int64(take) >= n { finished = true }
        case .chunked:
            out = try dechunk()
        }
        received += Int64(out.count)
        return Data(out)
    }

    // The chunked body so far: whole chunks and the part of the current one that came.
    private func dechunk() throws -> [UInt8] {
        var out = [UInt8]()
        var i = 0
        defer { buf.removeFirst(i) }
        while i < buf.count {
            switch chunk {
            case .size:
                guard let eol = HTTPStream.find(buf, [13, 10], from: i) else {
                    if buf.count - i > 1024 { throw HTTPStreamError("upstream", "a broken chunked body") }
                    return out
                }
                let line = String(decoding: buf[i..<eol], as: UTF8.self)
                let hex = line.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
                guard !hex.isEmpty, hex.count <= 15, let n = Int64(hex, radix: 16), n >= 0 else {
                    throw HTTPStreamError("upstream", "a broken chunked body")
                }
                i = eol + 2
                chunk = n == 0 ? .trailer : .data(n)
            case .data(let left):
                let take = Int(min(Int64(buf.count - i), left))
                out.append(contentsOf: buf[i..<(i + take)])
                i += take
                chunk = left - Int64(take) == 0 ? .dataEnd : .data(left - Int64(take))
            case .dataEnd:
                guard buf.count - i >= 2 else { return out }
                guard buf[i] == 13 && buf[i + 1] == 10 else { throw HTTPStreamError("upstream", "a broken chunked body") }
                i += 2
                chunk = .size
            case .trailer:
                // trailer lines until an empty one
                guard let eol = HTTPStream.find(buf, [13, 10], from: i) else {
                    if buf.count - i > HTTPStream.maxHead { throw HTTPStreamError("upstream", "a broken chunked body") }
                    return out
                }
                let empty = eol == i
                i = eol + 2
                if empty { finished = true; i = buf.count; return out }
            }
        }
        return out
    }

    // The connection ended (closed by the server).
    func end() throws {
        if finished { return }
        guard headed else { throw HTTPStreamError("network", "the connection closed before an answer") }
        switch body {
        case .close: finished = true
        case .length, .chunked: throw HTTPStreamError("network", "the connection closed early")
        }
    }

    static func find(_ b: [UInt8], _ needle: [UInt8], from: Int) -> Int? {
        guard b.count >= needle.count, from <= b.count - needle.count else { return nil }
        var i = from
        while i <= b.count - needle.count {
            if b[i] == needle[0] && Array(b[i..<(i + needle.count)]) == needle { return i }
            i += 1
        }
        return nil
    }
}
