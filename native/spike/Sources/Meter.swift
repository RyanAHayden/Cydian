// Frame meter: CADisplayLink intervals in the app process per phase, plus the page's rAF intervals (source "js").
import UIKit

final class Meter: NSObject {
    static let shared = Meter()
    private(set) var spike = "-"
    private(set) var phase = "idle"
    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0
    private var samples: [String: [Double]] = [:]
    var probe: [String: Any]?
    var pool: [String: Any] = [:]

    func begin(spike: String) {
        self.spike = spike + (spike == "probe" || Settings.prefer60 ? "" : "-raf120")
        phase = "idle"
        guard Settings.nativeMeter, link == nil else { return }
        let l = CADisplayLink(target: self, selector: #selector(tick(_:)))
        l.preferredFrameRateRange = CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)
        l.add(to: .main, forMode: .common)
        link = l
    }

    func end() {
        link?.invalidate()
        link = nil
        phase = "idle"
        _ = save()
    }

    func setPhase(_ p: String) {
        phase = p
        last = 0
    }

    @objc private func tick(_ l: CADisplayLink) {
        defer { last = l.timestamp }
        guard phase != "idle", last > 0 else { return }
        samples["\(spike)|native|\(phase)", default: []].append((l.timestamp - last) * 1000)
    }

    func addJS(phase: String, ms: [Double]) {
        samples["\(spike)|js|\(phase)", default: []].append(contentsOf: ms)
    }

    func reset() {
        samples = [:]
        probe = nil
        pool = [:]
    }

    static func deviceModel() -> String {
        var u = utsname()
        uname(&u)
        return withUnsafeBytes(of: &u.machine) { String(decoding: $0.prefix(while: { $0 != 0 }), as: UTF8.self) }
    }

    var budget: Double { 1000 / Double(max(60, UIScreen.main.maximumFramesPerSecond)) }

    func rows() -> [[String: Any]] {
        samples.keys.sorted().compactMap { key in
            let s = samples[key, default: []].sorted()
            guard !s.isEmpty else { return nil }
            let parts = key.split(separator: "|").map(String.init)
            let total = s.reduce(0, +)
            let pct = { (q: Double) in s[min(s.count - 1, Int(Double(s.count) * q))] }
            let hitch = s.reduce(0) { $0 + max(0, $1 - budget) }
            return [
                "spike": parts[0], "source": parts[1], "phase": parts[2], "n": s.count,
                "fps": round1(1000 * Double(s.count) / total), "p50": round2(pct(0.5)), "p95": round2(pct(0.95)),
                "p99": round2(pct(0.99)), "max": round2(s.last!),
                "over1_5x": s.filter { $0 > 1.5 * budget }.count, "hitchMsPerS": round1(hitch / (total / 1000)),
            ]
        }
    }

    func table() -> String {
        let head = "budget \(round2(budget)) ms. over = frames > 1.5x budget; hitch = ms late per s\n"
        return head + rows().map { r in
            let name = "\(r["spike"]!)/\(r["source"]!)/\(r["phase"]!)".padding(toLength: 26, withPad: " ", startingAt: 0)
            return "\(name) n=\(r["n"]!) fps=\(r["fps"]!) p50=\(r["p50"]!) p95=\(r["p95"]!) p99=\(r["p99"]!) "
                + "max=\(r["max"]!) over=\(r["over1_5x"]!) hitch=\(r["hitchMsPerS"]!)"
        }.joined(separator: "\n")
    }

    func report() -> [String: Any] {
        var r: [String: Any] = [
            "device": Meter.deviceModel(), "ios": UIDevice.current.systemVersion,
            "maxFps": UIScreen.main.maximumFramesPerSecond, "budgetMs": round2(budget),
            "webkitFrameRateFeatures": WebKitFeature.frameRateFeatures().map { ["key": $0.key, "default": $0.on] },
            "rows": rows(), "pool": pool, "date": ISO8601DateFormatter().string(from: Date()),
        ]
        if let p = probe { r["probe"] = p }
        return r
    }

    func save() -> URL? {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("spike-results.json")
        guard let data = try? JSONSerialization.data(withJSONObject: report(), options: [.prettyPrinted, .sortedKeys])
        else { return nil }
        try? data.write(to: url)
        return url
    }

    private func round1(_ v: Double) -> Double { (v * 10).rounded() / 10 }
    private func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }
}
