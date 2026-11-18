// The sideload build's install server (I6, docs/signing.md "Installing"): plain HTTP on the loopback interface only,
// serving one signed IPA to iOS's installer while the Signing Server hands iOS the manifest pointing at it
// (Sideload.swift, GET /sign/manifest). F75: no HTTPS server any more: iOS's installer ignores a hand-trusted CA, so
// the old local mode with the phone's own certificate never worked. Nothing listens on Wi-Fi or cellular, and every
// path has a random token.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Network
import UIKit

final class InstallServer {
    enum Body { case data(Data), file(URL) }
    struct Route { let type: String; let body: Body; let onServed: (() -> Void)? }

    private let queue = DispatchQueue(label: "cydian.install-server")
    private var listener: NWListener?
    private var routes = [String: Route]()
    private(set) var port: UInt16 = 0
    private var idle: DispatchWorkItem?
    private var task: UIBackgroundTaskIdentifier = .invalid

    static let plain = InstallServer()

    private init() {}

    // Starts listening if it isn't (a random free port), then calls back with the port.
    func start(_ done: @escaping (Result<UInt16, Error>) -> Void) {
        queue.async {
            if let l = self.listener, l.state == .ready { return done(.success(self.port)) }
            do {
                let params = NWParameters.tcp
                params.requiredInterfaceType = .loopback
                params.acceptLocalOnly = true
                params.allowLocalEndpointReuse = true
                // Bound to 127.0.0.1 itself: the install links say 127.0.0.1, and "any address on loopback" could
                // listen on ::1 only, so iOS's installer got "Cannot connect to 127.0.0.1" on every install.
                params.requiredLocalEndpoint = NWEndpoint.hostPort(host: NWEndpoint.Host("127.0.0.1"), port: .any)
                let l = try NWListener(using: params)
                var answered = false
                l.stateUpdateHandler = { st in // the server lives as long as the app
                    switch st {
                    case .ready:
                        self.port = l.port?.rawValue ?? 0
                        if !answered { answered = true; done(.success(self.port)) }
                    case .failed(let e):
                        self.listener = nil
                        if !answered { answered = true; done(.failure(e)) }
                    default: break
                    }
                }
                l.newConnectionHandler = { c in self.accept(c) }
                self.listener = l
                l.start(queue: self.queue)
            } catch { done(.failure(error)) }
        }
    }

    func stop() {
        queue.async {
            self.listener?.cancel()
            self.listener = nil
            self.routes.removeAll()
            self.endBackground()
        }
    }

    // Serves body at path until `ttl` passes with no request (or stop()).
    func serve(_ path: String, _ route: Route, ttl: TimeInterval = 15 * 60) {
        queue.async {
            self.routes[path] = route
            self.touch(ttl)
        }
    }

    func remove(_ path: String) { queue.async { self.routes.removeValue(forKey: path) } }

    var base: String { "http://127.0.0.1:\(port)" }

    // ---- connections

    private func touch(_ ttl: TimeInterval = 15 * 60) {
        idle?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.stop() }
        idle = w
        queue.asyncAfter(deadline: .now() + ttl, execute: w)
        DispatchQueue.main.async {
            // iOS's install sheet can send Cydian to the background mid-download; ask for the time to finish.
            if self.task == .invalid {
                self.task = UIApplication.shared.beginBackgroundTask(withName: "cydian.install") { self.endBackground() }
            }
        }
    }

    private func endBackground() {
        DispatchQueue.main.async {
            if self.task != .invalid { UIApplication.shared.endBackgroundTask(self.task); self.task = .invalid }
        }
    }

    private func accept(_ c: NWConnection) {
        c.start(queue: queue)
        read(c, Data())
    }

    private func read(_ c: NWConnection, _ buf: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, complete, err in
            guard let self = self else { return c.cancel() }
            var b = buf
            if let d = data { b.append(d) }
            do {
                if let req = try HTTPRequest.parse(b) { return self.answer(c, req) }
            } catch { return self.send(c, HTTPResponse.head(400, [("Content-Length", "0")]), close: true) }
            if complete || err != nil { return c.cancel() }
            self.read(c, b)
        }
    }

    private func answer(_ c: NWConnection, _ req: HTTPRequest) {
        touch()
        guard req.method == "GET" || req.method == "HEAD" else {
            return send(c, HTTPResponse.head(405, [("Content-Length", "0")]), close: true)
        }
        guard let route = routes[req.path] else { return send(c, HTTPResponse.head(404, [("Content-Length", "0")]), close: true) }
        let size: UInt64
        switch route.body {
        case .data(let d): size = UInt64(d.count)
        case .file(let u): size = (try? FileManager.default.attributesOfItem(atPath: u.path)[.size] as? NSNumber)??.uint64Value ?? 0
        }
        guard let range = req.range(size: size) else {
            return send(c, HTTPResponse.head(416, [("Content-Range", "bytes */\(size)"), ("Content-Length", "0")]), close: true)
        }
        let r = range ?? (size == 0 ? nil : 0...size - 1)
        var headers = [("Content-Type", route.type), ("Content-Length", "\(r.map { $0.upperBound - $0.lowerBound + 1 } ?? 0)"),
                       ("Accept-Ranges", "bytes")]
        if let rr = range { headers.append(("Content-Range", "bytes \(rr.lowerBound)-\(rr.upperBound)/\(size)")) }
        let head = HTTPResponse.head(range == nil ? 200 : 206, headers)
        if req.method == "HEAD" || r == nil { return send(c, head, close: true) }
        let whole = range == nil || (r!.lowerBound == 0 && r!.upperBound == size - 1)
        let finished = whole || r!.upperBound == size - 1 ? route.onServed : nil
        switch route.body {
        case .data(let d):
            send(c, head + d.subdata(in: Int(r!.lowerBound)..<Int(r!.upperBound) + 1), close: true, then: finished)
        case .file(let u):
            guard let fh = try? FileHandle(forReadingFrom: u) else { return send(c, HTTPResponse.head(404, [("Content-Length", "0")]), close: true) }
            fh.seek(toFileOffset: r!.lowerBound)
            send(c, head, close: false) { self.stream(c, fh, left: r!.upperBound - r!.lowerBound + 1, then: finished) }
        }
    }

    private func stream(_ c: NWConnection, _ fh: FileHandle, left: UInt64, then: (() -> Void)?) {
        if left == 0 { fh.closeFile(); return send(c, Data(), close: true, then: then) }
        let d = fh.readData(ofLength: Int(min(left, 1 << 20)))
        if d.isEmpty { fh.closeFile(); return c.cancel() }
        c.send(content: d, completion: .contentProcessed { [weak self] err in
            if err != nil { fh.closeFile(); return c.cancel() }
            self?.touch()
            self?.stream(c, fh, left: left - UInt64(d.count), then: then)
        })
    }

    private func send(_ c: NWConnection, _ d: Data, close: Bool, then: (() -> Void)? = nil) {
        c.send(content: d, isComplete: close, completion: .contentProcessed { err in
            if close { c.cancel() }
            if err == nil { then?() }
        })
    }
}
