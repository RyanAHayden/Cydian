// SPDX-License-Identifier: GPL-3.0-or-later
// net.packages' checks on a repo's answer (Sources/Apt.swift decompress): Foundation and libbz2 only, so
// native/test_packages_index.py builds it on Linux with tests/packagesindex/main.swift.
import Foundation

enum PackagesIndex {
    // The first byte after leading whitespace (and a UTF-8 BOM) is "<": a web page, not a Packages index.
    // BigBoss's plain Packages redirects to one that starts with blank lines.
    static func looksLikeHTML(_ data: Data) -> Bool {
        var rest = data.prefix(4096)[...]
        if rest.starts(with: [0xEF, 0xBB, 0xBF]) { rest = rest.dropFirst(3) }
        let first = rest.first { !($0 == 0x20 || $0 == 0x09 || $0 == 0x0A || $0 == 0x0D || $0 == 0x0B || $0 == 0x0C) }
        return first == UInt8(ascii: "<")
    }

    // bzip2 through libbz2, concatenated streams included (pbzip2 writes those). nil when it isn't bzip2 or doesn't
    // unpack whole (a truncated or damaged file).
    static func bunzip2(_ d: Data) -> Data? {
        guard d.starts(with: [0x42, 0x5A, 0x68]) else { return nil }  // "BZh"
        var input = [UInt8](d)
        var out = Data()
        var chunk = [UInt8](repeating: 0, count: 1 << 16)
        var offset = 0
        while offset < input.count {
            var s = bz_stream()
            guard BZ2_bzDecompressInit(&s, 0, 0) == BZ_OK else { return nil }
            defer { BZ2_bzDecompressEnd(&s) }
            var rc: Int32 = BZ_OK
            let start = offset
            let used: Int = input.withUnsafeMutableBufferPointer { inp in
                s.next_in = UnsafeMutableRawPointer(inp.baseAddress! + start).assumingMemoryBound(to: CChar.self)
                s.avail_in = UInt32(inp.count - start)
                repeat {
                    rc = chunk.withUnsafeMutableBufferPointer { buf in
                        s.next_out = UnsafeMutableRawPointer(buf.baseAddress!).assumingMemoryBound(to: CChar.self)
                        s.avail_out = UInt32(buf.count)
                        let r = BZ2_bzDecompress(&s)
                        out.append(buf.baseAddress!, count: buf.count - Int(s.avail_out))
                        return r
                    }
                } while rc == BZ_OK && (s.avail_in > 0 || s.avail_out == 0)
                return inp.count - start - Int(s.avail_in)
            }
            guard rc == BZ_STREAM_END else { return nil }
            offset += used
            // Another stream follows only if it starts with "BZh"; anything else after the end is padding.
            if !input[offset...].starts(with: [0x42, 0x5A, 0x68]) { break }
        }
        return out
    }
}
