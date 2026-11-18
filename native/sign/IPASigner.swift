// Signs a whole IPA on the phone (I6): every bundle inside out (frameworks and extensions before the app), each with
// its _CodeSignature/CodeResources, embedded.mobileprovision and Mach-O signatures. It works zip to zip: entries
// that signing doesn't change are copied compressed as they are, so a big game is read once and never unpacked to
// disk. What it does follows zsign (MIT) and Feather's SigningHandler (GPL-3.0) as docs/sideload.md (R5) read them.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct SignedApp {
    let bundleID: String
    let originalBundleID: String
    let name: String
    let version: String
    let removed: [String]     // what was left out (extensions an explicit profile can't cover, leftovers)
    var fixedArm64e: [String] = [] // binaries whose old-ABI arm64e slice was fixed up (F14, SignOptions.swift)
}

final class IPASigner {
    let profile: Profile
    let identity: SigningIdentity
    var time = Date()
    var maxMachO: UInt64 = 1 << 31   // a single binary held in memory while it's signed
    var options = SignOptions()      // the user's edits (F14): name, bundle ID, icon, extensions left out

    init(profile: Profile, identity: SigningIdentity) {
        self.profile = profile
        self.identity = identity
    }

    private enum File {
        case entry(ZipEntry, sha1: Data, sha256: Data)
        case data(Data, mode: UInt32)
        case symlink(String, ZipEntry)
    }

    private struct BundleInfo {
        let dir: String           // "Payload/X.app/PlugIns/Y.appex/"
        var plist: [String: Any]
        var format: PropertyListSerialization.PropertyListFormat
        var kind: String { (dir.dropLast() as Substring).split(separator: ".").last.map(String.init) ?? "" }
    }

    func sign(_ input: URL, to output: URL, progress: ((String, Double) -> Void)? = nil) throws -> SignedApp {
        let zip = try ZipReader(url: input)
        for e in zip.entries where e.name.hasPrefix("/") || e.name.split(separator: "/").contains("..") || e.name.contains("\\") {
            throw SignError("bad_ipa", "The IPA has a file outside its folder (\(e.name)).")
        }
        let infos = zip.entries.filter {
            let parts = $0.name.split(separator: "/", omittingEmptySubsequences: false)
            return parts.count == 3 && parts[0] == "Payload" && parts[1].hasSuffix(".app") && parts[2] == "Info.plist"
        }
        guard infos.count == 1 else {
            throw SignError("bad_ipa", infos.isEmpty ? "That isn't an IPA (no Payload/<App>.app/Info.plist)." : "The IPA holds more than one app.")
        }
        let appDir = String(infos[0].name.dropLast("Info.plist".count))

        // What goes: old signatures and profiles (made again below), Watch placeholders, macOS litter.
        var removed = [String]()
        func dropped(_ name: String) -> Bool {
            if name.hasPrefix("__MACOSX/") || name.hasSuffix("/.DS_Store") || name == ".DS_Store" { return true }
            guard name.hasPrefix(appDir) else { return false }
            let rel = name.dropFirst(appDir.count)
            if rel.contains("com.apple.WatchPlaceholder/") || rel.hasSuffix("SignedByEsign") { return true }
            if rel.hasSuffix("_CodeSignature/CodeResources") || rel.hasSuffix("_CodeSignature/") { return true }
            if rel.hasSuffix("embedded.mobileprovision") { return true }
            return false
        }

        // Bundles: any folder under the app with its own Info.plist and an executable.
        var bundles = [String: BundleInfo]()
        for e in zip.entries where e.name.hasPrefix(appDir) && e.name.hasSuffix("/Info.plist") && !dropped(e.name) {
            let dir = String(e.name.dropLast("Info.plist".count))
            let ext = dir.dropLast().split(separator: ".").last ?? ""
            guard dir == appDir || ["app", "appex", "framework", "xctest", "bundle"].contains(String(ext)) else { continue }
            if dir.dropFirst(appDir.count).contains("Resources/") && ext != "app" && ext != "appex" && ext != "framework" { continue }
            var format = PropertyListSerialization.PropertyListFormat.binary
            guard let pl = try? PropertyListSerialization.propertyList(from: try zip.data(e, limit: 16 << 20), format: &format) as? [String: Any]
            else { if dir == appDir { throw SignError("bad_ipa", "The app's Info.plist can't be read.") }; continue }
            if dir != appDir && pl["CFBundleExecutable"] == nil { continue } // a resource bundle: sealed as files
            bundles[dir] = BundleInfo(dir: dir, plist: pl, format: format)
        }
        guard var main = bundles[appDir], let oldID = main.plist["CFBundleIdentifier"] as? String else {
            throw SignError("bad_ipa", "The app has no bundle ID.")
        }
        let newID = try profile.bundleID(for: options.bundleID ?? oldID)

        // An explicit profile covers one app ID: extensions (and Watch apps) would need their own, so they go.
        var cut = [String]()
        if !profile.isWildcard {
            for dir in bundles.keys.sorted() where dir != appDir && (dir.hasSuffix(".appex/") || dir.hasSuffix(".app/")) { // sorted: a Dictionary's order changes per run
                cut.append(dir)
            }
        }
        for path in options.removeExtensions { // the ones the user left out (F14)
            let dir = appDir + path + "/"
            guard bundles[dir] != nil, path.hasSuffix(".appex") || path.hasSuffix(".app") else {
                throw SignError("bad_options", "The app has no extension \(path).")
            }
            cut.append(dir)
        }
        cut = cut.filter { c in !cut.contains { $0 != c && c.hasPrefix($0) } }
        for c in cut { removed.append(String(c.dropFirst(appDir.count).dropLast())); }
        bundles = bundles.filter { k, _ in !cut.contains { k.hasPrefix($0) } }
        func gone(_ name: String) -> Bool { dropped(name) || cut.contains { name.hasPrefix($0) } }

        // New bundle IDs: the app's, and the extensions' that start with the app's old one.
        func moved(_ id: String) -> String { id == oldID ? newID : id.hasPrefix(oldID + ".") ? newID + id.dropFirst(oldID.count) : id }
        var changed = [String: Data]() // path -> new contents
        for (dir, var b) in bundles where dir.hasSuffix(".app/") || dir.hasSuffix(".appex/") {
            var pl = b.plist
            if let id = pl["CFBundleIdentifier"] as? String { pl["CFBundleIdentifier"] = moved(id) }
            if let id = pl["WKCompanionAppBundleIdentifier"] as? String { pl["WKCompanionAppBundleIdentifier"] = moved(id) }
            if var ext = pl["NSExtension"] as? [String: Any], var at = ext["NSExtensionAttributes"] as? [String: Any],
               let id = at["WKAppBundleIdentifier"] as? String {
                at["WKAppBundleIdentifier"] = moved(id); ext["NSExtensionAttributes"] = at; pl["NSExtension"] = ext
            }
            pl.removeValue(forKey: "UISupportedDevices")
            if dir == appDir { options.apply(toApp: &pl) }
            if !NSDictionary(dictionary: pl).isEqual(to: b.plist) {
                changed[dir + "Info.plist"] = try PropertyListSerialization.data(fromPropertyList: pl, format: b.format, options: 0)
                b.plist = pl
                bundles[dir] = b
            }
        }
        main = bundles[appDir]!

        // One pass over every kept file: hashes for CodeResources, and which ones are Mach-O.
        var files = [String: File]()
        var order = [String]()
        var machos = Set<String>()
        let kept = zip.entries.filter { !gone($0.name) }
        let totalBytes = max(1, kept.reduce(UInt64(0)) { $0 + $1.size })
        var doneBytes: UInt64 = 0
        for e in kept {
            order.append(e.name)
            if e.isDirectory { continue }
            if e.isSymlink {
                files[e.name] = .symlink(String(decoding: try zip.data(e, limit: 4096), as: UTF8.self), e)
                continue
            }
            var h = Hasher2()
            var head = [UInt8]()
            try zip.read(e) { piece in
                if head.count < 4 { head += piece.prefix(4 - head.count) }
                h.update(piece)
            }
            let (s1, s256) = h.final()
            files[e.name] = .entry(e, sha1: s1, sha256: s256)
            if e.name.hasPrefix(appDir) && MachO.isMachO(head) { machos.insert(e.name) }
            doneBytes += e.size
            progress?("reading", Double(doneBytes) / Double(totalBytes))
        }
        for (path, d) in changed { files[path] = .data(d, mode: 0o100644) }
        // The user's name in the app's own localisations, and the user's icon (F14).
        if options.name != nil {
            for e in kept where e.name.hasPrefix(appDir) && !e.isDirectory {
                let rel = e.name.dropFirst(appDir.count).split(separator: "/")
                guard rel.count == 2, rel[0].hasSuffix(".lproj"), rel[1] == "InfoPlist.strings" else { continue }
                if let d = options.renamedStrings(try zip.data(e, limit: 1 << 20)) { files[e.name] = .data(d, mode: 0o100644) }
            }
        }
        if let icon = options.icon { for f in options.iconFiles { files[appDir + f] = .data(icon, mode: 0o100644) } }

        var fixedArm64e = [String]()
        func fixed(_ path: String, _ data: Data) -> Data {
            guard options.fixArm64e else { return data }
            let (d, changed) = Arm64e.fixup(data)
            if changed { fixedArm64e.append(String(path.dropFirst(appDir.count))) }
            return d
        }

        // Sign inside out: deepest bundles first, the app last.
        let dirs = bundles.keys.sorted { $0.split(separator: "/").count > $1.split(separator: "/").count }
        for (n, dir) in dirs.enumerated() {
            let b = bundles[dir]!
            let inner = dirs.filter { $0 != dir && $0.hasPrefix(dir) }
            let exe = (b.plist["CFBundleExecutable"] as? String).map { dir + $0 }
            let isApp = dir.hasSuffix(".app/") || dir.hasSuffix(".appex/")
            let id = b.plist["CFBundleIdentifier"] as? String ?? (dir.dropLast().split(separator: "/").last.map { String($0.split(separator: ".")[0]) } ?? "unknown")

            // Loose Mach-Os of this bundle (dylibs in Frameworks/, helpers): signed with no entitlements.
            for path in machos.sorted() where path.hasPrefix(dir) && path != exe && !inner.contains(where: { path.hasPrefix($0) }) {
                let data = fixed(path, try contents(path, files, zip))
                guard let ft = MachO.filetype(data), [2, 6, 8].contains(ft) else { continue } // executables, dylibs, bundles
                let name = String(path.split(separator: "/").last!)
                let ident = name.hasSuffix(".dylib") ? String(name.dropLast(6)) : name
                files[path] = .data(try MachO.sign(data, CodeSignParams(identifier: ident, team: profile.team), identity, time: time),
                                    mode: mode(path, files))
            }
            if isApp { files[dir + "embedded.mobileprovision"] = .data(profile.data, mode: 0o100644) }
            let infoData = try contents(dir + "Info.plist", files, zip)
            let resources = try codeResources(dir: dir, exe: exe, files: files, order: order + newPaths(files, order))
            files[dir + "_CodeSignature/CodeResources"] = .data(resources, mode: 0o100644)
            if let exe = exe {
                guard files[exe] != nil else { throw SignError("bad_ipa", "\(exe.dropFirst(appDir.count)) is missing.") }
                let data = fixed(exe, try contents(exe, files, zip))
                let params = CodeSignParams(identifier: id, team: profile.team,
                                            entitlements: isApp ? profile.entitlements(for: id) : nil,
                                            infoPlist: infoData, codeResources: resources)
                files[exe] = .data(try MachO.sign(data, params, identity, time: time), mode: mode(exe, files))
            }
            progress?("signing", Double(n + 1) / Double(dirs.count))
        }

        // Write: kept entries in their order (copied raw when untouched), then the new files.
        let out = try ZipWriter(url: output)
        var written = Set<String>()
        for name in order + newPaths(files, order) where !written.contains(name) {
            written.insert(name)
            if name.hasSuffix("/") {
                if let e = kept.first(where: { $0.name == name }) { try out.copy(e, from: zip) }
                continue
            }
            switch files[name] {
            case .entry(let e, _, _)?: try out.copy(e, from: zip)
            case .symlink(_, let e)?: try out.copy(e, from: zip)
            case .data(let d, let m)?: try out.add(name, d, mode: m)
            case nil: break
            }
        }
        out.close()
        return SignedApp(bundleID: newID, originalBundleID: oldID,
                         name: main.plist["CFBundleDisplayName"] as? String ?? main.plist["CFBundleName"] as? String ?? "",
                         version: main.plist["CFBundleShortVersionString"] as? String ?? main.plist["CFBundleVersion"] as? String ?? "",
                         removed: removed.sorted(), fixedArm64e: fixedArm64e.sorted())
    }

    private func newPaths(_ files: [String: File], _ order: [String]) -> [String] {
        let known = Set(order)
        return files.keys.filter { !known.contains($0) }.sorted()
    }

    private func mode(_ path: String, _ files: [String: File]) -> UInt32 {
        if case .entry(let e, _, _)? = files[path] { return e.unixMode & 0o170000 == 0 ? 0o100755 : e.unixMode }
        if case .data(_, let m)? = files[path] { return m }
        return 0o100755
    }

    private func contents(_ path: String, _ files: [String: File], _ zip: ZipReader) throws -> Data {
        switch files[path] {
        case .entry(let e, _, _)?: return try zip.data(e, limit: maxMachO)
        case .data(let d, _)?: return d
        default: throw SignError("bad_ipa", "\(path) is missing.")
        }
    }

    // _CodeSignature/CodeResources: every file in the bundle but its executable and this file, nested bundles'
    // files included (as zsign seals them), with SHA-1 (files) and SHA-1 + SHA-256 (files2) hashes, and the rules
    // Xcode writes.
    private func codeResources(dir: String, exe: String?, files: [String: File], order: [String]) throws -> Data {
        var f1 = [String: Any](), f2 = [String: Any]()
        for path in Set(order) where path.hasPrefix(dir) && !path.hasSuffix("/") && path != exe {
            let rel = String(path.dropFirst(dir.count))
            if rel == "_CodeSignature/CodeResources" { continue }
            let optional = rel.range(of: #"(^|/)[^/]+\.lproj/"#, options: .regularExpression) != nil
                && !rel.hasPrefix("Base.lproj/")
            let omit2 = rel == "Info.plist" || rel == "PkgInfo" || rel.hasSuffix(".DS_Store")
            let h1: Data, h2: Data
            switch files[path] {
            case .entry(_, let a, let b)?: h1 = a; h2 = b
            case .data(let d, _)?: h1 = sha1(d); h2 = sha256(d)
            case .symlink(let target, _)?:
                if !omit2 { f2[rel] = ["symlink": target] }
                continue
            case nil: continue
            }
            if rel.hasSuffix("lproj/locversion.plist") { continue }
            f1[rel] = optional ? ["hash": h1, "optional": true] : h1
            if !omit2 { f2[rel] = optional ? ["hash": h1, "hash2": h2, "optional": true] : ["hash": h1, "hash2": h2] }
        }
        let rules: [String: Any] = [
            "^.*": true,
            "^.*\\.lproj/": ["optional": true, "weight": 1000],
            "^.*\\.lproj/locversion.plist$": ["omit": true, "weight": 1100],
            "^Base\\.lproj/": ["weight": 1010],
            "^version.plist$": true,
        ]
        let rules2: [String: Any] = [
            ".*\\.dSYM($|/)": ["weight": 11],
            "^(.*/)?\\.DS_Store$": ["omit": true, "weight": 2000],
            "^.*": true,
            "^.*\\.lproj/": ["optional": true, "weight": 1000],
            "^.*\\.lproj/locversion.plist$": ["omit": true, "weight": 1100],
            "^Base\\.lproj/": ["weight": 1010],
            "^Info\\.plist$": ["omit": true, "weight": 20],
            "^PkgInfo$": ["omit": true, "weight": 20],
            "^embedded\\.provisionprofile$": ["weight": 20],
            "^version\\.plist$": ["weight": 20],
        ]
        return try PropertyListSerialization.data(fromPropertyList: ["files": f1, "files2": f2, "rules": rules, "rules2": rules2],
                                                  format: .xml, options: 0)
    }
}
