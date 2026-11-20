// B159: when iFizBox closes itself during its own update on the This iPhone route (Sideload.swift installHere). On
// iOS 17.4+ (RemotePairing) installd doesn't end the running copy: it takes the new IPA and then waits, its
// percentage standing still, until the old copy is gone (user 2026-11-20: stuck on "iOS is installing it" until the
// app was closed from the app switcher, then it finished). So once the IPA is copied, the clock runs: no percentage
// from installd for `firstQuiet`, or its percentage unchanged for `quiet`, means installd is waiting on this copy,
// and iFizBox closes (CloseForUpdate.hereReady). A repeated percentage doesn't restart the clock; a new one does.
// Pure, no UIKit: native/sign/tests/sideload/main.swift tests it on Linux.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct SelfCloseClock {
    static let firstQuiet: TimeInterval = 10 // the IPA is copied and installd hasn't said a percentage yet
    static let quiet: TimeInterval = 5 // installd's percentage hasn't moved

    private(set) var copiedAt: Date?
    private(set) var percent: Int?
    private(set) var movedAt: Date?

    // The IPA's copy to iOS has ended: the clock starts (once).
    mutating func copied(at t: Date) {
        if copiedAt == nil { copiedAt = t }
    }

    // installd's percentage (0...100). -> true when it moved (the caller re-arms its timer)
    @discardableResult
    mutating func installd(_ pct: Int, at t: Date) -> Bool {
        if copiedAt == nil { copiedAt = t } // a percentage means the copy is over
        guard pct != percent else { return false }
        percent = pct
        movedAt = t
        return true
    }

    // When iFizBox closes if nothing moves before then; nil while the IPA is still being copied.
    var closeAt: Date? {
        if let m = movedAt { return m.addingTimeInterval(Self.quiet) }
        return copiedAt?.addingTimeInterval(Self.firstQuiet)
    }

    func due(_ now: Date) -> Bool { closeAt.map { now >= $0 } ?? false }
}
