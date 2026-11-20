// Mach-O code signing for the on-device signer (I6): the embedded signature Apple's codesign writes (a SuperBlob of
// a CodeDirectory, an empty requirement set, XML and DER entitlements and a CMS signature over the CodeDirectory),
// built from scratch so the private key never leaves the Keychain and no OpenSSL is linked into the app.
// Formats: Apple's xnu osfmk/kern/cs_blobs.h and cctools' mach-o/loader.h (APSL, read for the layouts only).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct SignError: Error, CustomStringConvertible {
    let code: String
    let message: String
    init(_ code: String, _ message: String) { self.code = code; self.message = message }
    var description: String { "\(code): \(message)" }
}

// Whoever holds the private key: the Keychain identity on the phone, openssl in the Linux tests.
protocol SigningIdentity {
    var certificate: Data { get }          // the leaf, DER
    var chain: [Data] { get }              // its issuers up to the root, DER (Apple's WWDR CA and root on the phone)
    var signatureAlgorithm: String { get } // 1.2.840.113549.1.1.1 (RSA, PKCS#1 v1.5) or 1.2.840.10045.4.3.2 (ECDSA)
    func sign(_ message: Data) throws -> Data // over SHA-256 of message
}

struct CodeSignParams {
    var identifier: String
    var team: String?
    var entitlements: [String: Any]?  // nil: none (dylibs, frameworks)
    var infoPlist: Data?              // special slot -1
    var codeResources: Data?          // special slot -3
}

enum MachO {
    static let fatMagic: UInt32 = 0xCAFEBABE
    static let magic64: UInt32 = 0xFEEDFACF
    static let magic32: UInt32 = 0xFEEDFACE

    static func isMachO(_ head: [UInt8]) -> Bool {
        guard head.count >= 4 else { return false }
        let le = le32(head, 0)
        let be = UInt32(head[0]) << 24 | UInt32(head[1]) << 16 | UInt32(head[2]) << 8 | UInt32(head[3])
        return le == magic64 || le == magic32 || be == fatMagic
    }

    // Signs a thin or fat Mach-O. A fat file keeps its 64-bit slices only (iFizBox's sideload build targets
    // iOS 15+, where 32-bit code can't run) and each is signed with the same parameters.
    // R41: `file` is consumed, so a caller that passes its last copy (`consume`) isn't holding a second one while
    // signThin changes it (a 300 MB binary was in memory twice).
    static func sign(_ file: __owned Data, _ p: CodeSignParams, _ id: SigningIdentity?, time: Date = Date()) throws -> Data {
        let b = [UInt8](file.prefix(8))
        guard b.count >= 8 else { throw SignError("bad_macho", "\(p.identifier): not a Mach-O file") }
        let be = UInt32(b[0]) << 24 | UInt32(b[1]) << 16 | UInt32(b[2]) << 8 | UInt32(b[3])
        if be == fatMagic {
            let n = Int(file.be32(at: 4))
            var slices = [(cpu: UInt32, sub: UInt32, align: UInt32, data: Data)]()
            for i in 0..<n {
                let o = 8 + i * 20
                let cpu = file.be32(at: o), sub = file.be32(at: o + 4)
                let off = Int(file.be32(at: o + 8)), size = Int(file.be32(at: o + 12)), align = file.be32(at: o + 16)
                guard off + size <= file.count else { throw SignError("bad_macho", "\(p.identifier): slice past the end") }
                guard cpu & 0x0100_0000 != 0 else { continue } // CPU_ARCH_ABI64
                let slice = file.subdata(in: file.startIndex + off..<file.startIndex + off + size)
                slices.append((cpu, sub, max(align, 14), try signThin(slice, p, id, time: time)))
            }
            guard !slices.isEmpty else { throw SignError("bad_macho", "\(p.identifier) has no 64-bit code") }
            var out = Data()
            out.be32(fatMagic); out.be32(UInt32(slices.count))
            var off = 0x4000
            var places = [Int]()
            for s in slices {
                let a = 1 << Int(s.align)
                off = (off + a - 1) / a * a
                places.append(off)
                out.be32(s.cpu); out.be32(s.sub); out.be32(UInt32(off)); out.be32(UInt32(s.data.count)); out.be32(s.align)
                off += s.data.count
            }
            for (i, s) in slices.enumerated() {
                out.append(Data(count: places[i] - out.count))
                out.append(s.data)
            }
            return out
        }
        return try signThin(consume file, p, id, time: time)
    }

    static func signThin(_ input: __owned Data, _ p: CodeSignParams, _ id: SigningIdentity?, time: Date) throws -> Data {
        var file: Data
        if input.startIndex == 0 { file = consume input } else { file = Data([UInt8](input)) } // zero-based
        guard file.count >= 32, file.le32(at: 0) == magic64 else {
            throw SignError("bad_macho", "\(p.identifier): only 64-bit Mach-O files can be signed")
        }
        let filetype = file.le32(at: 12)
        var ncmds = Int(file.le32(at: 16))
        var sizeofcmds = Int(file.le32(at: 20))
        var off = 32
        var linkedit = -1, sigCmd = -1
        var textOff: UInt64 = 0, textSize: UInt64 = 0
        var firstSection = Int.max
        for _ in 0..<ncmds {
            guard off + 8 <= file.count else { throw SignError("bad_macho", "\(p.identifier): load commands cut short") }
            let cmd = file.le32(at: off), size = Int(file.le32(at: off + 4))
            guard size >= 8, off + size <= file.count else { throw SignError("bad_macho", "\(p.identifier): bad load command") }
            switch cmd {
            case 0x19: // LC_SEGMENT_64
                let name = String(decoding: file[off + 8..<off + 24].prefix { $0 != 0 }, as: UTF8.self)
                if name == "__LINKEDIT" { linkedit = off }
                if name == "__TEXT" { textOff = file.le64(at: off + 40); textSize = file.le64(at: off + 48) }
                let nsects = Int(file.le32(at: off + 64))
                for s in 0..<nsects {
                    let so = off + 72 + s * 80
                    let fo = Int(file.le32(at: so + 48))
                    let flags = file.le32(at: so + 64)
                    // zerofill sections (S_ZEROFILL 1, S_GB_ZEROFILL 0xc, S_THREAD_LOCAL_ZEROFILL 0x12) have no bytes
                    if fo > 0 && ![1, 0xc, 0x12].contains(flags & 0xff) { firstSection = min(firstSection, fo) }
                }
            case 0x1D: sigCmd = off // LC_CODE_SIGNATURE
            case 0x2C: // LC_ENCRYPTION_INFO_64
                if file.le32(at: off + 16) != 0 {
                    throw SignError("encrypted", "\(p.identifier) is encrypted by the App Store (a decrypted IPA is needed)")
                }
            default: break
            }
            off += size
        }
        guard linkedit >= 0 else { throw SignError("bad_macho", "\(p.identifier) has no __LINKEDIT segment") }
        let leFileOff = Int(file.le64(at: linkedit + 40))
        var dataOff: Int
        if sigCmd >= 0 {
            dataOff = Int(file.le32(at: sigCmd + 8))
            guard dataOff >= leFileOff, dataOff <= file.count else { throw SignError("bad_macho", "\(p.identifier): signature outside __LINKEDIT") }
        } else {
            // Add LC_CODE_SIGNATURE in the gap between the load commands and the first section.
            guard 32 + sizeofcmds + 16 <= firstSection else {
                throw SignError("bad_macho", "\(p.identifier) has no room for a code signature")
            }
            sigCmd = 32 + sizeofcmds
            file.replaceSubrange(sigCmd..<sigCmd + 16, with: Data(count: 16))
            file.putLE32(0x1D, at: sigCmd); file.putLE32(16, at: sigCmd + 4)
            ncmds += 1; sizeofcmds += 16
            file.putLE32(UInt32(ncmds), at: 16); file.putLE32(UInt32(sizeofcmds), at: 20)
            dataOff = (Int(file.le64(at: linkedit + 40) + file.le64(at: linkedit + 48)) + 15) & ~15
        }
        if file.count > dataOff { file.removeSubrange(dataOff...) }
        if file.count < dataOff { file.append(Data(count: dataOff - file.count)) }

        let codeLimit = dataOff
        let page = 4096
        let nCode = (codeLimit + page - 1) / page

        // The blobs other than the CodeDirectory and the CMS don't depend on the file's hashes.
        let requirements = blob(0xFADE0C01, Data([0, 0, 0, 0])) // an empty requirement set
        var ents: Data? = nil, entsDER: Data? = nil
        if let e = p.entitlements {
            let xml = try PropertyListSerialization.data(fromPropertyList: e, format: .xml, options: 0)
            ents = blob(0xFADE7171, xml)
            entsDER = blob(0xFADE7172, try EntitlementsDER.encode(e))
        }
        var special = [Int: Data]() // slot -> hash of what's in it
        if let info = p.infoPlist { special[1] = sha256(info) }
        special[2] = sha256(requirements)
        if let cr = p.codeResources { special[3] = sha256(cr) }
        if let e = ents { special[5] = sha256(e) }
        if let d = entsDER { special[7] = sha256(d) }
        let nSpecial = special.keys.max() ?? 0

        var execFlags: UInt64 = 0
        if filetype == 2 { execFlags |= 0x1 } // CS_EXECSEG_MAIN_BINARY
        if p.entitlements?["get-task-allow"].flatMap(plistBool) == true { execFlags |= 0x10 } // CS_EXECSEG_ALLOW_UNSIGNED
        let cdSize = 88 + p.identifier.utf8.count + 1 + (p.team.map { $0.utf8.count + 1 } ?? 0) + (nSpecial + nCode) * 32
        let cmsReserve = id == nil ? 0 : try CMS.reserve(id!, time: time)
        var blobs: [(UInt32, Int)] = [(0, cdSize), (2, requirements.count)]
        if let e = ents { blobs.append((5, e.count)) }
        if let d = entsDER { blobs.append((7, d.count)) }
        blobs.append((0x10000, 8 + cmsReserve))
        let sbSize = 12 + 8 * blobs.count + blobs.reduce(0) { $0 + $1.1 }
        let dataSize = (sbSize + 15) & ~15

        // Point LC_CODE_SIGNATURE and __LINKEDIT at the new signature before hashing the pages: they're code too.
        file.putLE32(UInt32(dataOff), at: sigCmd + 8)
        file.putLE32(UInt32(dataSize), at: sigCmd + 12)
        let leSize = UInt64(dataOff + dataSize - leFileOff)
        file.putLE64(leSize, at: linkedit + 48)
        file.putLE64((leSize + 0x3FFF) & ~0x3FFF, at: linkedit + 32)

        var cd = Data()
        cd.be32(0xFADE0C02); cd.be32(UInt32(cdSize)); cd.be32(0x20400)
        cd.be32(id == nil ? 0x2 : 0) // CS_ADHOC when there's no identity
        let identOff = 88
        let teamOff = p.team == nil ? 0 : identOff + p.identifier.utf8.count + 1
        let hashOff = 88 + p.identifier.utf8.count + 1 + (p.team.map { $0.utf8.count + 1 } ?? 0) + nSpecial * 32
        cd.be32(UInt32(hashOff)); cd.be32(UInt32(identOff)); cd.be32(UInt32(nSpecial)); cd.be32(UInt32(nCode))
        cd.be32(UInt32(codeLimit))
        cd.append(contentsOf: [32, 2, 0, 12]) // hashSize, CS_HASHTYPE_SHA256, platform, log2(page)
        cd.be32(0) // spare2
        cd.be32(0) // scatterOffset
        cd.be32(UInt32(teamOff))
        cd.be32(0) // spare3
        cd.be64(0) // codeLimit64
        cd.be64(textOff); cd.be64(textSize); cd.be64(execFlags)
        cd.append(Data(p.identifier.utf8)); cd.append(0)
        if let t = p.team { cd.append(Data(t.utf8)); cd.append(0) }
        for slot in stride(from: nSpecial, through: 1, by: -1) { cd.append(special[slot] ?? Data(count: 32)) }
        // R41: each page hashed where it lies (a copy of every page cost as much as the hashing on a big binary)
        file.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            var i = 0
            while i < codeLimit {
                cd.append(sha256(UnsafeRawBufferPointer(rebasing: raw[i..<min(i + page, codeLimit)])))
                i += page
            }
        }
        precondition(cd.count == cdSize)

        var cms = Data()
        if let id = id { cms = try CMS.sign(cd: cd, id: id, time: time) }
        guard cms.count <= cmsReserve else { throw SignError("internal", "CMS signature bigger than reserved") }
        var parts: [(UInt32, Data)] = [(0, cd), (2, requirements)]
        if let e = ents { parts.append((5, e)) }
        if let d = entsDER { parts.append((7, d)) }
        parts.append((0x10000, blob(0xFADE0B01, cms)))
        var sb = Data()
        let total = 12 + 8 * parts.count + parts.reduce(0) { $0 + $1.1.count }
        sb.be32(0xFADE0CC0); sb.be32(UInt32(total)); sb.be32(UInt32(parts.count))
        var at = 12 + 8 * parts.count
        for (t, d) in parts { sb.be32(t); sb.be32(UInt32(at)); at += d.count }
        for (_, d) in parts { sb.append(d) }
        sb.append(Data(count: dataSize - sb.count))
        file.append(sb)
        return file
    }

    static func blob(_ magic: UInt32, _ body: Data) -> Data {
        var d = Data()
        d.be32(magic); d.be32(UInt32(8 + body.count)); d.append(body)
        return d
    }

    static func filetype(_ file: Data) -> UInt32? {
        guard file.count >= 16 else { return nil }
        if file.le32(at: 0) == magic64 { return file.le32(at: 12) }
        if file.be32(at: 0) == fatMagic, file.count >= 28 {
            let off = Int(file.be32(at: 16))
            if off + 16 <= file.count, file.le32(at: off) == magic64 || file.le32(at: off) == magic32 { return file.le32(at: off + 12) }
        }
        if file.le32(at: 0) == magic32 { return file.le32(at: 12) }
        return nil
    }
}

enum CMS {
    static let sha256OID = "2.16.840.1.101.3.4.2.1"

    // The room a signature needs. Its size doesn't depend on the CodeDirectory (only its fixed-size digests go in),
    // so it's measured once per certificate and signing time instead of signing every binary twice (R41: an RSA
    // signature through the Keychain per binary); 64 bytes spare for ECDSA's few bytes of variation.
    private static let reserveLock = NSLock()
    private static var reserves = [Data: Int]()
    static func reserve(_ id: SigningIdentity, time: Date) throws -> Int {
        var key = id.certificate
        withUnsafeBytes(of: time.timeIntervalSinceReferenceDate) { key.append(contentsOf: $0) }
        reserveLock.lock()
        if let n = reserves[key] { reserveLock.unlock(); return n }
        reserveLock.unlock()
        let n = try sign(cd: Data(count: 128), id: id, time: time).count + 64
        reserveLock.lock()
        if reserves.count > 16 { reserves.removeAll() } // one entry per signing run
        reserves[key] = n
        reserveLock.unlock()
        return n
    }

    // A detached CMS SignedData over the CodeDirectory, with the signed attributes Apple's codesign adds: content
    // type, signing time, message digest, and the CodeDirectory hashes (as a plist, 1.2.840.113635.100.9.1, and as
    // DER, ...9.2) that iOS reads to pick the CodeDirectory.
    static func sign(cd: Data, id: SigningIdentity, time: Date) throws -> Data {
        let digest = sha256(cd)
        let plist = try PropertyListSerialization.data(fromPropertyList: ["cdhashes": [digest.prefix(20)]],
                                                       format: .xml, options: 0)
        func attr(_ oid: String, _ value: Data) -> Data { DER.seq([DER.oid(oid), DER.set([value])]) }
        let attrs = [
            attr("1.2.840.113549.1.9.3", DER.oid("1.2.840.113549.1.7.1")),
            attr("1.2.840.113549.1.9.5", DER.time(time)),
            attr("1.2.840.113549.1.9.4", DER.octets(digest)),
            attr("1.2.840.113635.100.9.1", DER.octets(plist)),
            attr("1.2.840.113635.100.9.2", DER.seq([DER.oid(sha256OID), DER.octets(digest)])),
        ]
        let signedSet = DER.setOf(attrs)
        let signature = try id.sign(signedSet)
        let leaf = try Certificate(der: id.certificate)
        var implicitAttrs = signedSet
        implicitAttrs[implicitAttrs.startIndex] = 0xA0
        let sigAlg = id.signatureAlgorithm == "1.2.840.113549.1.1.1"
            ? DER.seq([DER.oid(id.signatureAlgorithm), DER.null]) : DER.seq([DER.oid(id.signatureAlgorithm)])
        let signerInfo = DER.seq([
            DER.int(1),
            DER.seq([leaf.issuer, leaf.serial]),
            DER.seq([DER.oid(sha256OID), DER.null]),
            implicitAttrs,
            sigAlg,
            DER.octets(signature),
        ])
        let certs = ([id.certificate] + id.chain).reduce(Data(), +)
        let signedData = DER.seq([
            DER.int(1),
            DER.set([DER.seq([DER.oid(sha256OID), DER.null])]),
            DER.seq([DER.oid("1.2.840.113549.1.7.1")]),
            DER.implicitCons(0, certs),
            DER.set([signerInfo]),
        ])
        return DER.seq([DER.oid("1.2.840.113549.1.7.2"), DER.explicit(0, signedData)])
    }
}

// Entitlements as DER (the slot iOS 15+ reads; CS_SLOT_DER_ENTITLEMENTS): [APPLICATION 16] { INTEGER 1, value },
// a dictionary being [CONTEXT 16] { SEQUENCE { UTF8String key, value } ... } sorted by key, an array a SEQUENCE,
// strings UTF8String, booleans BOOLEAN, numbers INTEGER.
enum EntitlementsDER {
    static func encode(_ e: [String: Any]) throws -> Data {
        DER.tlv(0x70, DER.int(1) + (try value(e)))
    }

    static func value(_ v: Any) throws -> Data {
        if let b = plistBool(v) { return DER.bool(b) }
        if let s = v as? String { return DER.utf8(s) }
        if let n = v as? Int { return DER.int(n) }
        if let a = v as? [Any] { return DER.seq(try a.map(value)) }
        if let d = v as? [String: Any] {
            let pairs = try d.keys.sorted { Array($0.utf8).lexicographicallyPrecedes(Array($1.utf8)) }
                .map { DER.seq([DER.utf8($0), try value(d[$0]!)]) }
            return DER.tlv(0xB0, pairs.reduce(Data(), +))
        }
        throw SignError("bad_entitlements", "an entitlement value of type \(type(of: v)) can't be signed")
    }
}

// A property-list boolean, told apart from a number (NSNumber bridges both on Apple platforms).
func plistBool(_ v: Any) -> Bool? {
    #if canImport(Darwin)
    if let n = v as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue }
    return nil
    #else
    if let b = v as? Bool, !(v is Int) { return b }
    return nil
    #endif
}

extension Data {
    func le32(at i: Int) -> UInt32 {
        let s = startIndex + i
        return UInt32(self[s]) | UInt32(self[s + 1]) << 8 | UInt32(self[s + 2]) << 16 | UInt32(self[s + 3]) << 24
    }
    func le64(at i: Int) -> UInt64 { UInt64(le32(at: i)) | UInt64(le32(at: i + 4)) << 32 }
    func be32(at i: Int) -> UInt32 {
        let s = startIndex + i
        return UInt32(self[s]) << 24 | UInt32(self[s + 1]) << 16 | UInt32(self[s + 2]) << 8 | UInt32(self[s + 3])
    }
    mutating func putLE32(_ v: UInt32, at i: Int) {
        for k in 0..<4 { self[startIndex + i + k] = UInt8(truncatingIfNeeded: v >> (8 * UInt32(k))) }
    }
    mutating func putLE64(_ v: UInt64, at i: Int) {
        putLE32(UInt32(truncatingIfNeeded: v), at: i); putLE32(UInt32(truncatingIfNeeded: v >> 32), at: i + 4)
    }
}
