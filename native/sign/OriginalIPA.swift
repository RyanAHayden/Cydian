// F343: the IPA each signed app was signed from, as it came (unsigned), kept as Library/Caches/<bundle ID>.ipa (the
// bundle ID it was installed as), so Re-sign signs from it instead of downloading it again. iOS may purge Caches
// under storage pressure: Re-sign then downloads, as before. Kept only for apps whose IPA came from an http(s) URL:
// My IPAs files have the library's own copy, and iFizBox itself is signed from its bundle or its own download.
// Replaced on every install or upgrade: the signer's input is staged once it is signed and replaces the kept one when
// the install's record is written (Sideload.saveRecords), which also removes it with the record. The record's sha256 is the kept file's: Re-sign uses the file only when it still matches.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum OriginalIPA {
    static let dir: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]

    // Where `bundleID`'s IPA is kept; nil for an ID that isn't a plain file name (a bundle ID is letters, digits, . and -).
    static func url(_ bundleID: String, in dir: URL = dir) -> URL? {
        let ok = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_")
        guard !bundleID.isEmpty, bundleID.count <= 255, !bundleID.hasPrefix("."),
              bundleID.unicodeScalars.allSatisfy(ok.contains) else { return nil }
        return dir.appendingPathComponent(bundleID + ".ipa")
    }

    // Whether an app signed from `source` (the record's url) keeps its IPA: one downloaded over http(s), and not
    // iFizBox itself (`own`, its bundle ID).
    static func keeps(source: String, bundleID: String, originalBundleID: String, own: String?) -> Bool {
        let s = source.lowercased()
        guard s.hasPrefix("https://") || s.hasPrefix("http://") else { return false }
        if let me = own, !me.isEmpty, bundleID == me || originalBundleID == me { return false }
        return url(bundleID) != nil
    }

    // A signed IPA waiting for its install: <bundle ID>.<sha256>.pending, until its record is written (commit) or the
    // install doesn't happen (discard). The one kept before stays in place meanwhile.
    static func pending(_ bundleID: String, sha256: String, in dir: URL = dir) -> URL? {
        let sha = sha256.lowercased()
        guard url(bundleID, in: dir) != nil, sha.count == 64, sha.allSatisfy({ $0.isHexDigit }) else { return nil }
        return dir.appendingPathComponent("\(bundleID).\(sha).pending")
    }

    // Moves `input` aside for `bundleID` until its install is recorded. -> whether it is staged.
    @discardableResult
    static func stage(_ input: URL, bundleID: String, sha256: String, in dir: URL = dir) -> Bool {
        guard let dest = pending(bundleID, sha256: sha256, in: dir) else { return false }
        let fm = FileManager.default
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        try? fm.removeItem(at: dest)
        do { try fm.moveItem(at: input, to: dest); return true } catch { return false }
    }

    // The install is recorded: the staged IPA replaces the one kept before (nothing changes when none is staged).
    static func commit(_ bundleID: String, sha256: String, in dir: URL = dir) {
        guard let src = pending(bundleID, sha256: sha256, in: dir), let dest = url(bundleID, in: dir),
              FileManager.default.fileExists(atPath: src.path) else { return }
        try? FileManager.default.removeItem(at: dest)
        try? FileManager.default.moveItem(at: src, to: dest)
    }

    // The install didn't happen: the staged IPA goes, the one kept before stays.
    static func discard(_ bundleID: String, sha256: String, in dir: URL = dir) {
        guard let p = pending(bundleID, sha256: sha256, in: dir) else { return }
        try? FileManager.default.removeItem(at: p)
    }

    static func remove(_ bundleID: String, in dir: URL = dir) {
        guard let u = url(bundleID, in: dir) else { return }
        try? FileManager.default.removeItem(at: u)
    }

    enum Take: Equatable {
        case file(URL)  // a copy at the asked path, matching the record
        case missing    // never kept, or purged by iOS
        case mismatch   // there, but not the IPA the record was signed from (removed)
        case unknown    // the record has no hash to check it against (from before F343)
        case unreadable // there and matching, but it couldn't be linked or copied
    }

    // The kept IPA of `bundleID` at `to` (a hard link, else a copy: the signer deletes its input), when its SHA-256
    // (`hash`, lowercase hex) is the record's `sha256`. A file that doesn't match is removed, so it is downloaded again.
    static func take(_ bundleID: String, sha256: String?, to: URL, in dir: URL = dir, hash: (URL) -> String?) -> Take {
        guard let src = url(bundleID, in: dir), FileManager.default.fileExists(atPath: src.path) else { return .missing }
        guard let want = sha256?.lowercased(), !want.isEmpty else { return .unknown }
        guard hash(src) == want else { remove(bundleID, in: dir); return .mismatch }
        let fm = FileManager.default
        try? fm.removeItem(at: to)
        do { try fm.linkItem(at: src, to: to) } catch {
            do { try fm.copyItem(at: src, to: to) } catch { return .unreadable }
        }
        return .file(to)
    }

    // The bundle IDs whose kept IPA goes when `old` records become `new`: a record removed, or replaced by one that
    // keeps none (sha256 nil: a My IPAs install of the same app). A new hash means the file was already replaced.
    static func dropped(old: [SignedRecord], new: [SignedRecord]) -> [String] {
        let now = Dictionary(new.map { ($0.bundleID, $0) }, uniquingKeysWith: { _, b in b })
        return old.filter { $0.sha256 != nil && (now[$0.bundleID].map { $0.sha256 == nil } ?? true) }.map(\.bundleID)
    }
}
