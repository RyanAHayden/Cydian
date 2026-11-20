// SHA-1 and SHA-256 for the on-device signer (I6). CommonCrypto on Apple platforms; a plain Swift version elsewhere,
// so the same signer compiles and runs on Linux for native/test_sign.py.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
#if canImport(CommonCrypto)
import CommonCrypto
#endif

enum HashKind { case sha1, sha256 }

// A running hash: update() with pieces, then final(). Both kinds at once is what CodeResources wants.
struct Hasher2 {
    private var s1 = SHA1()
    private var s256 = SHA256()
    mutating func update(_ d: Data) { s1.update(d); s256.update(d) }
    mutating func final() -> (sha1: Data, sha256: Data) { (s1.final(), s256.final()) }
}

func sha1(_ d: Data) -> Data { var h = SHA1(); h.update(d); return h.final() }
func sha256(_ d: Data) -> Data { var h = SHA256(); h.update(d); return h.final() }
// R41: over bytes in place (a Mach-O's pages), with no Data made for each piece.
func sha256(_ p: UnsafeRawBufferPointer) -> Data { var h = SHA256(); h.update(p); return h.final() }

#if canImport(CommonCrypto)
struct SHA1 {
    private var ctx = CC_SHA1_CTX()
    init() { CC_SHA1_Init(&ctx) }
    mutating func update(_ d: Data) { d.withUnsafeBytes { update($0) } }
    mutating func update(_ p: UnsafeRawBufferPointer) { _ = CC_SHA1_Update(&ctx, p.baseAddress, CC_LONG(p.count)) }
    mutating func final() -> Data {
        var out = [UInt8](repeating: 0, count: 20)
        CC_SHA1_Final(&out, &ctx)
        return Data(out)
    }
}

struct SHA256 {
    private var ctx = CC_SHA256_CTX()
    init() { CC_SHA256_Init(&ctx) }
    mutating func update(_ d: Data) { d.withUnsafeBytes { update($0) } }
    mutating func update(_ p: UnsafeRawBufferPointer) { _ = CC_SHA256_Update(&ctx, p.baseAddress, CC_LONG(p.count)) }
    mutating func final() -> Data {
        var out = [UInt8](repeating: 0, count: 32)
        CC_SHA256_Final(&out, &ctx)
        return Data(out)
    }
}
#else
// FIPS 180-4, block by block.
private struct Block64 {
    var buf = [UInt8]()
    var length: UInt64 = 0
    mutating func feed(_ d: Data, _ compress: (UnsafePointer<UInt8>) -> Void) { d.withUnsafeBytes { feed($0, compress) } }
    mutating func feed(_ raw: UnsafeRawBufferPointer, _ compress: (UnsafePointer<UInt8>) -> Void) {
        length &+= UInt64(raw.count)
        guard var p = raw.bindMemory(to: UInt8.self).baseAddress else { return }
        var n = raw.count
        if !buf.isEmpty {
            let take = min(64 - buf.count, n)
            buf.append(contentsOf: UnsafeBufferPointer(start: p, count: take))
            p += take; n -= take
            if buf.count == 64 { buf.withUnsafeBufferPointer { compress($0.baseAddress!) }; buf.removeAll(keepingCapacity: true) }
        }
        while n >= 64 { compress(p); p += 64; n -= 64 }
        if n > 0 { buf.append(contentsOf: UnsafeBufferPointer(start: p, count: n)) }
    }
    mutating func pad(_ compress: (UnsafePointer<UInt8>) -> Void) {
        let bits = length &* 8
        var tail = buf
        tail.append(0x80)
        while tail.count % 64 != 56 { tail.append(0) }
        for i in (0..<8).reversed() { tail.append(UInt8(truncatingIfNeeded: bits >> (UInt64(i) * 8))) }
        tail.withUnsafeBufferPointer { b in
            var i = 0
            while i < b.count { compress(b.baseAddress! + i); i += 64 }
        }
    }
}

@inline(__always) private func rotl(_ x: UInt32, _ n: UInt32) -> UInt32 { (x << n) | (x >> (32 - n)) }
@inline(__always) private func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 { (x >> n) | (x << (32 - n)) }
@inline(__always) private func be32(_ p: UnsafePointer<UInt8>, _ i: Int) -> UInt32 {
    UInt32(p[i]) << 24 | UInt32(p[i + 1]) << 16 | UInt32(p[i + 2]) << 8 | UInt32(p[i + 3])
}
private func out(_ h: [UInt32]) -> Data {
    var d = Data(capacity: h.count * 4)
    for v in h { d.append(contentsOf: [UInt8(v >> 24), UInt8(v >> 16 & 0xff), UInt8(v >> 8 & 0xff), UInt8(v & 0xff)]) }
    return d
}

struct SHA1 {
    private var h: [UInt32] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]
    private var b = Block64()
    private static func compress(_ h: inout [UInt32], _ p: UnsafePointer<UInt8>) {
        var w = [UInt32](repeating: 0, count: 80)
        for i in 0..<16 { w[i] = be32(p, i * 4) }
        for i in 16..<80 { w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1) }
        var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4]
        for i in 0..<80 {
            let f: UInt32, k: UInt32
            switch i {
            case 0..<20: f = (bb & c) | (~bb & d); k = 0x5A827999
            case 20..<40: f = bb ^ c ^ d; k = 0x6ED9EBA1
            case 40..<60: f = (bb & c) | (bb & d) | (c & d); k = 0x8F1BBCDC
            default: f = bb ^ c ^ d; k = 0xCA62C1D6
            }
            let t = rotl(a, 5) &+ f &+ e &+ k &+ w[i]
            e = d; d = c; c = rotl(bb, 30); bb = a; a = t
        }
        h[0] &+= a; h[1] &+= bb; h[2] &+= c; h[3] &+= d; h[4] &+= e
    }
    mutating func update(_ d: Data) { b.feed(d) { SHA1.compress(&h, $0) } }
    mutating func update(_ p: UnsafeRawBufferPointer) { b.feed(p) { SHA1.compress(&h, $0) } }
    mutating func final() -> Data { b.pad { SHA1.compress(&h, $0) }; return out(h) }
}

struct SHA256 {
    private static let k: [UInt32] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]
    private var h: [UInt32] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                               0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
    private var b = Block64()
    private static func compress(_ h: inout [UInt32], _ p: UnsafePointer<UInt8>) {
        var w = [UInt32](repeating: 0, count: 64)
        for i in 0..<16 { w[i] = be32(p, i * 4) }
        for i in 16..<64 {
            let s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3)
            let s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10)
            w[i] = w[i - 16] &+ s0 &+ w[i - 7] &+ s1
        }
        var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]
        for i in 0..<64 {
            let s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
            let ch = (e & f) ^ (~e & g)
            let t1 = hh &+ s1 &+ ch &+ k[i] &+ w[i]
            let s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
            let maj = (a & bb) ^ (a & c) ^ (bb & c)
            let t2 = s0 &+ maj
            hh = g; g = f; f = e; e = d &+ t1; d = c; c = bb; bb = a; a = t1 &+ t2
        }
        h[0] &+= a; h[1] &+= bb; h[2] &+= c; h[3] &+= d; h[4] &+= e; h[5] &+= f; h[6] &+= g; h[7] &+= hh
    }
    mutating func update(_ d: Data) { b.feed(d) { SHA256.compress(&h, $0) } }
    mutating func update(_ p: UnsafeRawBufferPointer) { b.feed(p) { SHA256.compress(&h, $0) } }
    mutating func final() -> Data { b.pad { SHA256.compress(&h, $0) }; return out(h) }
}
#endif
