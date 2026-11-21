// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

/// B262: an IPA download's progress for the run page, at most once every `every` seconds: the Log's line
/// ("Downloaded 120.3 of 312.0 MB (38%), 21.4 MB/s") and the row's numbers (bytes, total, rate). The rate is the last
/// interval's, so a download that slows down shows it. Bytes going backwards (a redirect or the http fallback starting
/// the file again) start the count again. Not thread-safe: the caller holds a lock.
struct DownloadMeter {
    struct Tick {
        let bytes: Int64, total: Int64 // total 0: the server sent no length
        let rate: Double // bytes a second

        var fraction: Double { total > 0 ? min(1, Double(bytes) / Double(total)) : 0 }

        static func mb(_ n: Int64) -> String { String(format: "%.1f", Double(n) / 1_048_576) }

        var line: String {
            let speed = String(format: "%.1f MB/s", rate / 1_048_576)
            guard total > 0 else { return "Downloaded \(Self.mb(bytes)) MB, \(speed)" }
            return "Downloaded \(Self.mb(bytes)) of \(Self.mb(total)) MB (\(Int(fraction * 100))%), \(speed)"
        }

        /// The signing.* event the page reads (web/app/signing/queue.js prepareOnDevice).
        var event: [String: Any] {
            ["phase": "downloading", "progress": fraction, "bytes": bytes, "total": total, "rate": rate]
        }
    }

    let every: TimeInterval
    private var lastAt: Date?
    private var lastBytes: Int64 = 0

    init(every: TimeInterval = 1) { self.every = every }

    /// `bytes` written so far of `total` (0 or less: unknown), at `now`. A tick once `every` seconds have passed since
    /// the last one (the first call only starts the clock), else nil.
    mutating func add(_ bytes: Int64, of total: Int64, at now: Date = Date()) -> Tick? {
        guard let last = lastAt, bytes >= lastBytes else {
            lastAt = now; lastBytes = bytes
            return nil
        }
        let secs = now.timeIntervalSince(last)
        guard secs >= every else { return nil }
        let rate = Double(bytes - lastBytes) / secs
        lastAt = now; lastBytes = bytes
        return Tick(bytes: bytes, total: max(total, 0), rate: rate)
    }
}
