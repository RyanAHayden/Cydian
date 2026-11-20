// Tweak injection (F288): the tweaks the user added in the sign options, already unpacked and with their install
// names pointed at @rpath by the page (web/app/core/tweaks.js prepareTweaks: .debs, CydiaSubstrate/ElleKit), arrive
// as files to put in the app and the load paths the main executable gets. IPASigner copies the files in, adds the
// LC_LOAD_WEAK_DYLIB commands (and LC_RPATH @executable_path/Frameworks when it lacks one) to every slice of the
// app's executable, then signs everything as usual: the tweaks' dylibs and frameworks like any other in Frameworks/.
// The load command insertion follows Feather's TweakHandler (GPL-3.0, khcrysalis/Feather) and insert_dylib; the
// same rules as core/tweaks.js injectInto, which the website's signer uses before zsign.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct TweakFile: Codable, Equatable {
    var path: String // under the app: "Frameworks/X.dylib", "Frameworks/Y.framework/Y", "Z.bundle/Info.plist"
    var data: Data
}

struct TweakSet: Codable, Equatable {
    var files: [TweakFile] = []
    var inject: [String] = []   // "@rpath/X.dylib", "@rpath/Y.framework/Y"
    var names: [String] = []    // the files the user added, for the page

    static let limit = 64 << 20
    static let rpath = "@executable_path/Frameworks"

    init(files: [TweakFile] = [], inject: [String] = [], names: [String] = []) {
        self.files = files; self.inject = inject; self.names = names
    }

    // From a bridge call's `tweaks`: {files: [{path, data (base64)}], inject: [path], names: [name]}. Nil when it
    // holds nothing; bad_options when a path leaves the app or an inject names no file.
    init?(json p: Any?) throws {
        guard let p = p as? [String: Any] else { return nil }
        var total = 0
        for f in p["files"] as? [[String: Any]] ?? [] {
            guard let path = f["path"] as? String, TweakSet.safe(path) else {
                throw SignError("bad_options", "A tweak has a file outside the app (\(f["path"] as? String ?? "?")).")
            }
            guard let s = f["data"] as? String, let d = Data(base64Encoded: s) else { throw SignError("bad_options", "A tweak's file \(path) can't be read.") }
            total += d.count
            guard total <= TweakSet.limit else { throw SignError("bad_options", "The tweaks are too big (64 MB in all at most).") }
            files.append(TweakFile(path: path, data: d))
        }
        inject = (p["inject"] as? [String] ?? [])
        names = (p["names"] as? [String] ?? [])
        if files.isEmpty { return nil }
        for i in inject {
            guard i.hasPrefix("@rpath/"), files.contains(where: { $0.path == "Frameworks/" + i.dropFirst(7) }) else {
                throw SignError("bad_options", "A tweak to inject (\(i)) isn't among the tweak files.")
            }
        }
    }

    // Under Frameworks/, or a top-level .bundle; no "..", no absolute paths.
    static func safe(_ p: String) -> Bool {
        let parts = p.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count >= 2, !p.hasPrefix("/"), !parts.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else { return false }
        return parts[0] == "Frameworks" || parts[0].hasSuffix(".bundle")
    }

    var json: [String: Any] { ["names": names, "inject": inject, "files": files.map(\.path)] }
}

enum MachOEdit {
    static let loadWeakDylib: UInt32 = 0x8000_0018
    static let rpathCmd: UInt32 = 0x8000_001C
    static let dylibCmds: Set<UInt32> = [0xC, 0xD, 0x8000_0018, 0x8000_001F, 0x20, 0x8000_0023]

    // The slices as (offset, size): the file itself when thin.
    static func slices(_ d: Data) -> [(Int, Int)] {
        guard d.count >= 8, d.be32(at: 0) == MachO.fatMagic else { return [(0, d.count)] }
        return (0..<Int(d.be32(at: 4))).map { i in (Int(d.be32(at: 8 + i * 20 + 8)), Int(d.be32(at: 8 + i * 20 + 12))) }
    }

    // A slice's load commands: (cmd, offset in the file, size, path for dylib and rpath commands).
    static func commands(_ d: Data, at off: Int) throws -> [(cmd: UInt32, offset: Int, size: Int, name: String?)] {
        let m = d.le32(at: off)
        guard m == MachO.magic64 || m == MachO.magic32 else { throw SignError("bad_macho", "The app's executable isn't a Mach-O.") }
        var p = off + (m == MachO.magic64 ? 32 : 28)
        var out = [(cmd: UInt32, offset: Int, size: Int, name: String?)]()
        for _ in 0..<Int(d.le32(at: off + 16)) {
            let cmd = d.le32(at: p), size = Int(d.le32(at: p + 4))
            guard size >= 8, p + size <= d.count else { throw SignError("bad_macho", "The app's executable has damaged load commands.") }
            var name: String?
            if dylibCmds.contains(cmd) || cmd == rpathCmd {
                let s = p + Int(d.le32(at: p + 8))
                if s < p + size {
                    let bytes = d[(d.startIndex + s)..<(d.startIndex + p + size)].prefix { $0 != 0 }
                    name = String(decoding: bytes, as: UTF8.self)
                }
            }
            out.append((cmd, p, size, name))
            p += size
        }
        return out
    }

    // Where a slice's load commands must end: its first section's data, or a later segment's (slice-relative).
    static func roomEnd(_ d: Data, at off: Int, size: Int) throws -> Int {
        var end = size
        for c in try commands(d, at: off) where c.cmd == 0x19 {
            let fileoff = Int(d.le64(at: c.offset + 40)), filesize = Int(d.le64(at: c.offset + 48))
            if fileoff > 0 && filesize > 0 { end = min(end, fileoff) }
            for s in 0..<Int(d.le32(at: c.offset + 64)) {
                let so = c.offset + 72 + s * 80
                let ssize = d.le64(at: so + 40), sOff = Int(d.le32(at: so + 48)), type = d.le32(at: so + 64) & 0xFF
                if sOff > 0 && ssize > 0 && ![1, 0x0C, 0x12].contains(type) { end = min(end, sOff) }
            }
        }
        return end
    }

    static func command(_ cmd: UInt32, _ name: String) -> Data {
        let s = Array(name.utf8) + [0]
        let head = cmd == rpathCmd ? 12 : 24
        let size = (head + s.count + 7) / 8 * 8
        var c = Data(count: size)
        c.putLE32(cmd, at: 0); c.putLE32(UInt32(size), at: 4); c.putLE32(UInt32(head), at: 8)
        if cmd != rpathCmd { c.putLE32(2, at: 12) } // timestamp 2, versions 0, as insert_dylib writes them
        c.replaceSubrange(head..<head + s.count, with: s)
        return c
    }

    // The main executable with LC_LOAD_WEAK_DYLIB for each of `paths` it doesn't load yet, and the Frameworks rpath
    // when it has none, in every 64-bit slice; the file keeps its size (the commands go in the header's room).
    static func inject(_ input: Data, _ paths: [String], rpath: String = TweakSet.rpath) throws -> (Data, [String]) {
        guard !paths.isEmpty else { return (input, []) }
        var d = input.startIndex == 0 ? input : Data(input)
        var added = [String]()
        for (off, size) in slices(d) {
            guard off + 32 <= d.count, d.le32(at: off) == MachO.magic64 else { continue } // 32-bit slices: never signed (B162)
            let cmds = try commands(d, at: off)
            let have = Set(cmds.compactMap { dylibCmds.contains($0.cmd) ? $0.name : nil })
            var add = Data(), n = 0
            if !cmds.contains(where: { $0.cmd == rpathCmd && $0.name == rpath }) { add.append(command(rpathCmd, rpath)); n += 1 }
            var here = [String]()
            for p in paths where !have.contains(p) && !here.contains(p) { add.append(command(loadWeakDylib, p)); n += 1; here.append(p) }
            guard n > 0 else { continue }
            let sizeofcmds = Int(d.le32(at: off + 20))
            let end = off + 32 + sizeofcmds
            let reserve = cmds.contains(where: { $0.cmd == 0x1D }) ? 0 : 16 // an unsigned one still needs LC_CODE_SIGNATURE
            guard 32 + sizeofcmds + add.count + reserve <= (try roomEnd(d, at: off, size: size)) else {
                throw SignError("tweak_no_room", "The app's executable has no room for more load commands, so tweaks can't be injected into it.")
            }
            d.replaceSubrange(end..<end + add.count, with: add)
            d.putLE32(d.le32(at: off + 16) + UInt32(n), at: off + 16)
            d.putLE32(UInt32(sizeofcmds + add.count), at: off + 20)
            for p in here where !added.contains(p) { added.append(p) }
        }
        return (d, added)
    }

    // What the first slice loads (otool -L), for tests and the log.
    static func dylibs(_ d: Data) -> [String] {
        guard let (off, _) = slices(d).first, let cmds = try? commands(d, at: off) else { return [] }
        return cmds.filter { dylibCmds.contains($0.cmd) && $0.cmd != 0xD }.compactMap(\.name)
    }
    static func rpaths(_ d: Data) -> [String] {
        guard let (off, _) = slices(d).first, let cmds = try? commands(d, at: off) else { return [] }
        return cmds.filter { $0.cmd == rpathCmd }.compactMap(\.name)
    }
}
