// B246: the This iPhone route (IDevice.install) when the connection to iOS drops mid-install. Leaving the app during
// a big install over Tailscale (user 2026-11-20, a 383.7 MB IPA) ended with "install_failed: Socket(Kind(
// UnexpectedEof)) (1)" while iOS went on and installed the app. A dropped connection is not iOS refusing the app:
// the install connects again, finishes the copy from where iOS's file ends, and once the install was sent asks iOS
// for the app (installation_proxy Browse) instead of calling it failed. Only installd's own error fails.
// Pure, no UIKit or idevice: native/sign/tests/sideload/main.swift tests it on Linux.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum HereRecheck {
    /// How often one install connects again after a drop, and the pause before each try (the tunnel or the
    /// Tailscale node coming back after the app returns to the front).
    static let reconnects = 4
    static func pause(_ attempt: Int) -> TimeInterval { [2, 4, 8, 15][min(max(attempt, 1), 4) - 1] }
    /// How long to keep asking iOS for the app after a drop, and how often.
    static let askFor: TimeInterval = 180
    static let askEvery: TimeInterval = 3

    /// idevice error codes for a connection that went away, not an answer from iOS: Socket (1, UnexpectedEof, reset,
    /// refused), SessionInactive (17), NoEstablishedConnection (19), CdTunnel (101), RemotePairing (103),
    /// Timeout (109). installd's refusals come as other codes (InstallationProxy 107, ApplicationVerificationFailed
    /// 203, UnexpectedResponse 13, …).
    static let droppedCodes: Set<Int32> = [1, 17, 19, 101, 103, 109]

    /// `code` is IDevice.Failure's prefix, `lib` idevice's error code when the failure came from idevice. The
    /// watchdog's "timeout" (a step went quiet and the tunnel was closed) is a drop too.
    static func isDropped(code: String, lib: Int32?) -> Bool {
        code == "timeout" || lib.map { droppedCodes.contains($0) } == true
    }

    /// What iOS lists for the app (installation_proxy Browse).
    struct AppState: Equatable {
        var path: String?          // the app's bundle folder; a new install gets a new one
        var version: String?       // CFBundleVersion
        var shortVersion: String?  // CFBundleShortVersionString

        func has(_ v: String) -> Bool { version == v || shortVersion == v }
    }

    /// What iOS listed before the install started.
    enum Before: Equatable { case unknown, absent, present(AppState) }

    enum Verdict: Equatable {
        case installed    // iOS lists the new copy
        case notYet       // not listed, or listed with another version: installd may still be at it
        case sameAsBefore // listed exactly as before the install: the new copy hasn't replaced it (yet)
        case cannotTell   // listed with this version, and nothing tells it from what was there before
    }

    /// Whether iOS has the copy being installed: `version` is the signed app's, `now` what iOS lists now (nil: no
    /// such app).
    static func verdict(version: String, before: Before, now: AppState?) -> Verdict {
        guard let now = now, now.has(version) else { return .notYet }
        switch before {
        case .absent: return .installed
        case .unknown: return .cannotTell
        case .present(let old):
            if !old.has(version) { return .installed }
            if let a = old.path, let b = now.path { return a == b ? .sameAsBefore : .installed }
            return .cannotTell
        }
    }

    /// Where to carry on copying after a drop: iOS's file size, never past what was sent, down to a whole chunk so a
    /// chunk cut off mid-write is sent again.
    static func resumeAt(remoteSize: Int, sent: Int, chunk: Int) -> Int {
        let have = max(0, min(remoteSize, sent))
        return chunk > 0 ? have / chunk * chunk : have
    }

    /// "Copied 383.7 MB in 61 s: 9.8 MB/s in front, 0.6 MB/s in the background", for the log and the page.
    struct CopySpeed {
        private(set) var frontBytes = 0, backBytes = 0
        private(set) var frontSecs: TimeInterval = 0, backSecs: TimeInterval = 0

        mutating func add(_ bytes: Int, _ secs: TimeInterval, front: Bool) {
            if front { frontBytes += bytes; frontSecs += secs } else { backBytes += bytes; backSecs += secs }
        }

        static func rate(_ b: Int, _ s: TimeInterval) -> String {
            String(format: "%.1f MB/s", Double(b) / 1_048_576 / max(s, 0.001))
        }

        var summary: String {
            var parts: [String] = []
            if frontBytes > 0 { parts.append("\(Self.rate(frontBytes, frontSecs)) in front") }
            if backBytes > 0 { parts.append("\(Self.rate(backBytes, backSecs)) in the background") }
            return parts.joined(separator: ", ")
        }
    }
}
