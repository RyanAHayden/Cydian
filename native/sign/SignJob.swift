// F196: the sideload shell's running signing job (signing.install, library.sign, library.install), so the progress
// page's Cancel (signing.cancel, web/app/signing-client.js stopNative) can stop it: the download is cancelled, the
// signer stops at its next file or bundle (IPASigner.stop), and an IPA already handed to iOS stops being served (the
// install server's route goes, KeepAlive is released). One job runs at a time (the page allows one install); a new
// job replaces the old one as `current`. Foundation only, so the host tests (native/sign/tests/sideload) cover it.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

final class SignJob {
    private static let lock = NSLock()
    private static var running: SignJob?

    private let lock = NSLock()
    private var stopped = false
    private var stops = [() -> Void]()

    static let cancelledError = SignError("cancelled", "Cancelled")

    // A new job, now the one signing.cancel stops.
    static func begin() -> SignJob {
        let j = SignJob()
        lock.lock(); running = j; lock.unlock()
        return j
    }

    static var current: SignJob? { lock.lock(); defer { lock.unlock() }; return running }

    // Stops the current job. False when none runs (or it was already cancelled).
    @discardableResult
    static func cancelCurrent() -> Bool {
        lock.lock(); let j = running; running = nil; lock.unlock()
        return j?.cancel() ?? false
    }

    // The job has ended on its own: no longer the one Cancel stops (a newer job is left alone).
    func end() {
        SignJob.lock.lock(); if SignJob.running === self { SignJob.running = nil }; SignJob.lock.unlock()
        lock.lock(); stops.removeAll(); lock.unlock()
    }

    var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return stopped }

    // Throws code "cancelled" once Cancel was tapped.
    func check() throws { if cancelled { throw SignJob.cancelledError } }

    // Runs `f` on Cancel (at once when it was cancelled already). Ignored once the job ended.
    func onCancel(_ f: @escaping () -> Void) {
        lock.lock()
        if stopped { lock.unlock(); return f() }
        stops.append(f)
        lock.unlock()
    }

    @discardableResult
    func cancel() -> Bool {
        lock.lock()
        if stopped { lock.unlock(); return false }
        stopped = true
        let fs = stops
        stops.removeAll()
        lock.unlock()
        for f in fs { f() }
        return true
    }
}
