// N9: the share extension (PlugIns/iFizBoxShare.appex). Safari's Share button, a link in Notes or Messages: it takes
// the one web link (or the text, which the shell searches for a link) and opens iFizBox with ifizbox://share?url=…
// (or ?text=…). iFizBox decides what it is (../Share.swift: an APT repo or AltStore source opens Add Source, an .ipa
// or .deb link its install route) and says so there; this sheet only shows "Opening iFizBox" for a moment.
//
// An extension can't call UIApplication.shared.open. As other share extensions do, it walks the responder chain to
// the UIApplication object and sends it open(_:options:completionHandler:) through the runtime (iOS 18 dropped the
// old openURL:). When that finds nothing, the sheet says to open iFizBox and paste the link instead.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let label = UILabel()
    private var done = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        label.text = "Opening \(Brand.name)"
        label.font = .boldSystemFont(ofSize: 17)
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !done else { return }
        done = true
        shared { [weak self] link in
            DispatchQueue.main.async {
                guard let self else { return }
                guard let link, self.open(link) else { return self.fail(link == nil) }
                self.extensionContext?.completeRequest(returningItems: nil)
            }
        }
    }

    // The first web link among the attachments, else the first text: as ifizbox://share?url=… or ?text=….
    private func shared(_ done: @escaping (URL?) -> Void) {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        let url = UTType.url.identifier, text = UTType.plainText.identifier
        if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(url) }) {
            p.loadItem(forTypeIdentifier: url, options: nil) { item, _ in
                let u = (item as? URL) ?? (item as? NSURL).map { $0 as URL } ?? (item as? String).flatMap(URL.init(string:))
                done(u.flatMap { $0.isFileURL ? nil : ShareViewController.link("url", $0.absoluteString) })
            }
        } else if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(text) }) {
            p.loadItem(forTypeIdentifier: text, options: nil) { item, _ in
                let s = (item as? String) ?? (item as? Data).map { String(decoding: $0, as: UTF8.self) }
                done(s.flatMap { ShareViewController.link("text", String($0.prefix(64 * 1024))) })
            }
        } else {
            done(nil)
        }
    }

    static func link(_ name: String, _ value: String) -> URL? {
        var c = URLComponents()
        c.scheme = "ifizbox"
        c.host = "share"
        c.queryItems = [URLQueryItem(name: name, value: value)]
        c.percentEncodedQuery = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        return c.url
    }

    private func open(_ url: URL) -> Bool {
        let sel = NSSelectorFromString("openURL:options:completionHandler:")
        var r: UIResponder? = self
        while let x = r {
            if x.isKind(of: UIApplication.self), x.responds(to: sel) {
                typealias Open = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, (@convention(block) (Bool) -> Void)?) -> Void
                let f = unsafeBitCast(x.method(for: sel), to: Open.self)
                f(x, sel, url as NSURL, NSDictionary(), nil)
                return true
            }
            r = x.next
        }
        return false
    }

    private func fail(_ nothing: Bool) {
        label.text = nothing ? "There's no link here for \(Brand.name)." : "Couldn't open \(Brand.name). Copy the link, open \(Brand.name) and add it there."
        label.font = .systemFont(ofSize: 15)
        let b = UIButton(type: .system)
        b.setTitle("Done", for: .normal)
        b.titleLabel?.font = .boldSystemFont(ofSize: 17)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.addAction(UIAction { [weak self] _ in self?.extensionContext?.completeRequest(returningItems: nil) }, for: .touchUpInside)
        view.addSubview(b)
        NSLayoutConstraint.activate([
            b.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            b.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 16),
        ])
    }
}
