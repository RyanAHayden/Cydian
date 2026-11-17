"""Web Push (F10): the diff-to-notification rules, the daily check end to end (real node diff, real encryption,
a fake push service), the endpoints and the feed. push.mjs's own tests (RFC 8291 vector, VAPID) run from here too."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetch  # noqa: E402
import push  # noqa: E402

ARM64 = "iphoneos-arm64"
REPO = "https://repo.example.org/"
DIST = "https://apt.example.org/"
DIST_DIR = DIST + "dists/stable/main/binary-iphoneos-arm64/"
ENDPOINT = "https://web.push.apple.com/QGuQyavXutnMHtYtPO2E"
# A real browser key pair's public half (RFC 8291's), so node can encrypt to it.
P256DH = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
AUTH = "BTBZMqHH6r4Tts7J_aSIgg"


def stanza(pkg, version, name=None, arch=ARM64):
    return (f"Package: {pkg}\nVersion: {version}\nArchitecture: {arch}\nName: {name or pkg.title()}\n"
            f"Section: Tweaks\nFilename: debs/{pkg}.deb\n")


class FakeFetcher(fetch.Fetcher):
    """The real fetch_packages loop and guard check, with the network swapped for a dict of plain Packages files."""

    def __init__(self, files):
        super().__init__(resolve=lambda host, port: ["93.184.216.34"])
        self.files = files
        self.gets = []

    def get(self, url, deadline=None, max_bytes=None):
        self.gets.append(url)
        if url.endswith("/Packages") and url[:-len("Packages")] in self.files:
            return fetch.Response(url, 200, {}, self.files[url[:-len("Packages")]].encode())
        return fetch.Response(url, 404, {}, b"")


class FakePushService:
    def __init__(self, status=201):
        self.status = status
        self.sent = []

    def __call__(self, endpoint, headers, body):
        push.check_endpoint(endpoint)
        self.sent.append((endpoint, headers, body))
        return self.status


def body(**over):
    b = {"subscription": {"endpoint": ENDPOINT, "keys": {"p256dh": P256DH, "auth": AUTH}}, "arch": ARM64,
         "sources": [{"uri": REPO, "dist": "./", "components": []},
                     {"uri": DIST, "dist": "stable", "components": ["main"]}],
         "installed": [{"id": "foo", "version": "1.0"}, {"id": "bar", "version": "2.0"},
                       {"id": "held", "version": "1", "held": True}, {"id": "quiet", "version": "1"}],
         "holds": ["quiet"]}
    b.update(over)
    return b


class Rules(unittest.TestCase):
    def ups(self, *pairs):
        return [{"id": i, "name": i.title(), "version": v, "installed": "0"} for i, v in pairs]

    def test_push_only_for_something_not_already_notified(self):
        a = self.ups(("foo", "1.1"), ("bar", "2"))
        self.assertTrue(push.decide(a, []))
        notified = [push.upgrade_key(u) for u in a]
        self.assertFalse(push.decide(a, notified))                          # the same list again: quiet
        self.assertFalse(push.decide(a[:1], notified))                      # one got installed: quiet
        self.assertTrue(push.decide(self.ups(("foo", "1.2"), ("bar", "2")), notified))  # a newer version
        self.assertTrue(push.decide(a + self.ups(("baz", "1")), notified))  # a new package
        self.assertFalse(push.decide([], notified))

    def test_notification_text(self):
        self.assertEqual(push.notification_text(self.ups(("foo", "1.1"))), "Foo 1.1 is available.")
        self.assertEqual(push.notification_text(self.ups(("a", "1"), ("b", "1"))), "2 upgrades: A and B.")
        self.assertEqual(push.notification_text(self.ups(("a", "1"), ("b", "1"), ("c", "1"))), "3 upgrades: A, B and C.")
        self.assertEqual(push.notification_text(self.ups(*[(x, "1") for x in "abcde"])), "5 upgrades: A, B, C and 2 more.")

    def test_message(self):
        m = push.message(self.ups(("a", "1"), ("b", "1")), "sid", 7)
        self.assertEqual((m["title"], m["count"], m["url"], m["id"], m["seq"]), ("2 Upgrades", 2, "/#/changes", "sid", 7))
        self.assertEqual(push.message(self.ups(("a", "1")), "sid", 1)["title"], "1 Upgrade")
        self.assertLess(len(json.dumps(push.message(self.ups(*[("x" * 200 + str(i), "1") for i in range(500)]), "s", 1))), 3000)

    def test_since_is_kept_per_version(self):
        first = push.with_since(self.ups(("a", "1"), ("b", "1")), None, 100)
        later = push.with_since(self.ups(("a", "1"), ("b", "2")), first, 200)
        self.assertEqual([u["since"] for u in later], [100, 200])

    def test_daemon_runs_at_the_next_hour(self):
        from datetime import datetime, timezone
        t = datetime(2026, 11, 17, 15, 30, tzinfo=timezone.utc).timestamp()
        self.assertEqual(push._next_run(16, t), datetime(2026, 11, 17, 16, tzinfo=timezone.utc).timestamp())
        self.assertEqual(push._next_run(9, t), datetime(2026, 11, 18, 9, tzinfo=timezone.utc).timestamp())

    def test_endpoints_only_known_push_services(self):
        for ok in [ENDPOINT, "https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x",
                   "https://wns2-par02p.notify.windows.com/w/?token=x"]:
            self.assertEqual(push.check_endpoint(ok), ok)
        for bad in ["http://web.push.apple.com/x", "https://evil.example/x", "https://push.apple.com.evil.example/x",
                    "https://127.0.0.1/x", "https://web.push.apple.com:8443/x", "https://u:p@web.push.apple.com/x",
                    "https://localhost/x", None, ""]:
            with self.subTest(bad=bad), self.assertRaises(push.Invalid):
                push.check_endpoint(bad)

    def test_clean_subscription(self):
        c = push.clean_subscription(body())
        self.assertEqual(c["endpoint"], ENDPOINT)
        self.assertEqual(c["installed"][2], {"id": "held", "version": "1", "held": True})
        self.assertIsNone(push.clean_subscription(body(subscription=None))["endpoint"])
        for bad in [{"arch": "x86"}, {"sources": [{"uri": "file:///etc/"}]}, {"sources": "x"},
                    {"installed": [{"id": "a"}]}, {"installed": [{"id": "a", "version": "1"}] * (push.MAX_INSTALLED + 1)},
                    {"subscription": {"endpoint": "https://evil.example/", "keys": {"p256dh": "a", "auth": "b"}}}]:
            with self.subTest(bad=bad), self.assertRaises(push.Invalid):
                push.clean_subscription(body(**bad))


class Check(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = push.Store(Path(self.tmp.name) / "push.sqlite")
        self.keys = push.vapid_keys(Path(self.tmp.name))
        self.files = {REPO: stanza("foo", "1.1") + "\n" + stanza("held", "2") + "\n" + stanza("quiet", "2"),
                      DIST_DIR: stanza("bar", "2.0")}
        self.fetcher = FakeFetcher(self.files)
        self.svc = FakePushService()
        self.sub, _ = self.store.upsert(None, push.clean_subscription(body()), "https://cydian.example", 1000)

    def tearDown(self):
        self.tmp.cleanup()

    def run_check(self, t, **kw):
        return push.check(self.store, self.fetcher, None, keys=self.keys, poster=self.svc, t=t, **kw)

    def test_daily_flow(self):
        # day 1: foo 1.1 is new -> one push, encrypted, VAPID-signed for Apple's push service
        self.assertEqual(self.run_check(2000), {self.sub["id"]: {"count": 1, "pushed": True}})
        self.assertEqual(len(self.svc.sent), 1)
        endpoint, headers, data = self.svc.sent[0]
        self.assertEqual(endpoint, ENDPOINT)
        self.assertEqual(headers["Content-Encoding"], "aes128gcm")
        self.assertRegex(headers["Authorization"], r"^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=" + self.keys["publicKey"] + "$")
        self.assertEqual(data[20], 65)  # aes128gcm header: idlen = an uncompressed P-256 key
        s = self.store.get(self.sub["id"])
        self.assertEqual([u["id"] for u in s["upgrades"]], ["foo"])
        self.assertEqual(s["notified"], ["foo=1.1"])
        self.assertEqual((s["seq"], s["push_status"]), (1, "201"))
        # day 2: nothing new -> quiet
        self.assertFalse(self.run_check(3000)[self.sub["id"]]["pushed"])
        self.assertEqual(len(self.svc.sent), 1)
        # day 3: bar 2.1 lands on the dist repo -> pushed, "2 Upgrades"
        self.files[DIST_DIR] = stanza("bar", "2.1")
        self.assertEqual(self.run_check(4000)[self.sub["id"]], {"count": 2, "pushed": True})
        s = self.store.get(self.sub["id"])
        self.assertEqual(s["notified"], ["bar=2.1", "foo=1.1"])
        self.assertEqual({u["id"]: u["since"] for u in s["upgrades"]}, {"bar": 4000, "foo": 2000})

    def test_failed_push_is_retried_and_gone_endpoint_forgotten(self):
        self.svc.status = 500
        self.assertFalse(self.run_check(2000)[self.sub["id"]]["pushed"])
        self.assertEqual(self.store.get(self.sub["id"])["notified"], [])
        self.svc.status = 410
        self.assertFalse(self.run_check(3000)[self.sub["id"]]["pushed"])
        s = self.store.get(self.sub["id"])
        self.assertIsNone(s["endpoint"])
        self.assertEqual(len(s["upgrades"]), 1)  # the feed keeps working
        self.run_check(4000)
        self.assertEqual(len(self.svc.sent), 2)  # no endpoint, no push

    def test_quiet_check_fills_the_feed_without_pushing_or_moving_the_baseline(self):
        self.run_check(2000, notify=False)
        self.assertEqual(self.svc.sent, [])
        s = self.store.get(self.sub["id"])
        self.assertEqual((len(s["upgrades"]), s["notified"]), (1, []))

    def test_each_index_is_fetched_once_for_everyone(self):
        self.store.upsert(None, push.clean_subscription(body()), "https://cydian.example", 1000)
        self.run_check(2000)
        self.assertEqual(sorted(u for u in self.fetcher.gets if u.endswith("/Packages")), [DIST_DIR + "Packages", REPO + "Packages"])
        self.assertEqual(len(self.svc.sent), 2)

    def test_upsert_tracks_changed_inputs(self):
        same, changed = self.store.upsert(self.sub["id"], push.clean_subscription(body()), "https://cydian.example", 1100)
        self.assertEqual((same["id"], same["feed"], changed), (self.sub["id"], self.sub["feed"], False))
        _, changed = self.store.upsert(self.sub["id"], push.clean_subscription(body(holds=[])), "https://cydian.example", 1200)
        self.assertTrue(changed)
        other, _ = self.store.upsert("made-up", push.clean_subscription(body()), "https://cydian.example", 1300)
        self.assertNotEqual(other["id"], "made-up")

    def test_feed(self):
        self.run_check(2000)
        s = self.store.get(self.sub["id"])
        xml = push.feed_xml(s, "https://cydian.example/feed/" + s["feed"], "https://cydian.example/")
        root = ET.fromstring(xml)
        ns = {"a": "http://www.w3.org/2005/Atom"}
        entries = root.findall("a:entry", ns)
        self.assertEqual([e.find("a:title", ns).text for e in entries], ["Foo 1.1"])
        self.assertEqual(entries[0].find("a:id", ns).text, "tag:cydian,2026:foo/1.1")
        self.assertNotIn(s["id"], xml)

    def test_expire(self):
        self.assertEqual(self.store.expire(999), 0)
        self.assertEqual(self.store.expire(1001), 1)


class DeviceMode(unittest.TestCase):
    """F34: the lists stay on the phone; the server sends a bare daily "check" push."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = push.Store(Path(self.tmp.name) / "push.sqlite")
        self.keys = push.vapid_keys(Path(self.tmp.name))
        self.fetcher = FakeFetcher({REPO: stanza("foo", "1.1"), DIST_DIR: stanza("bar", "2.0")})
        self.svc = FakePushService()

    def tearDown(self):
        self.tmp.cleanup()

    def test_device_subscription_keeps_no_lists(self):
        c = push.clean_subscription(body(mode="device"))
        self.assertEqual((c["mode"], c["sources"], c["installed"], c["holds"]), ("device", [], [], []))
        self.assertEqual(c["endpoint"], ENDPOINT)
        self.assertEqual(push.clean_subscription(body())["mode"], "server")
        with self.assertRaises(push.Invalid):
            push.clean_subscription(body(mode="cloud"))

    def test_daily_run_checks_server_subs_and_nudges_device_subs(self):
        server, _ = self.store.upsert(None, push.clean_subscription(body()), "https://cydian.example", 1000)
        device, _ = self.store.upsert(None, push.clean_subscription(body(mode="device")), "https://cydian.example", 1000)
        res = push.check(self.store, self.fetcher, None, keys=self.keys, poster=self.svc, t=2000)
        self.assertEqual(list(res), [server["id"]])  # the diff never sees the device subscriber
        self.assertEqual(len(self.svc.sent), 1)
        nudged = push.check_device(self.store, keys=self.keys, poster=self.svc, t=2000)
        self.assertEqual(nudged, {device["id"]: {"count": None, "pushed": True}})
        self.assertEqual(len(self.svc.sent), 2)
        # every day, whatever changed: only the phone knows
        push.check_device(self.store, keys=self.keys, poster=self.svc, t=3000)
        self.assertEqual(len(self.svc.sent), 3)
        d = self.store.get(device["id"])
        self.assertEqual((d["seq"], d["upgrades"], d["push_status"]), (2, None, "201"))
        self.assertEqual(push.check_message("sid", 3), {"type": "check", "url": "/#/changes", "id": "sid", "seq": 3})

    def test_switching_to_device_forgets_the_server_side_upgrades(self):
        s, _ = self.store.upsert(None, push.clean_subscription(body()), "https://cydian.example", 1000)
        push.check(self.store, self.fetcher, None, keys=self.keys, poster=self.svc, t=2000)
        self.assertEqual(len(self.store.get(s["id"])["upgrades"]), 1)
        d, changed = self.store.upsert(s["id"], push.clean_subscription(body(mode="device")), "https://cydian.example", 3000)
        self.assertTrue(changed)
        self.assertEqual((d["id"], d["mode"], d["upgrades"], d["installed"], d["sources"]), (s["id"], "device", None, [], []))
        self.assertIn("checks for upgrades on the phone", push.feed_xml(d, "https://x/feed/t", "https://x/"))
        back, changed = self.store.upsert(s["id"], push.clean_subscription(body()), "https://cydian.example", 4000)
        self.assertEqual((back["mode"], changed), ("server", True))

    def test_old_database_gets_the_new_columns(self):
        import sqlite3
        path = Path(self.tmp.name) / "old.sqlite"
        db = sqlite3.connect(path)
        db.executescript(push.SCHEMA)
        db.execute("INSERT INTO subs (id, feed, arch, sources, installed, holds, created, seen) "
                   "VALUES ('a', 'f', 'iphoneos-arm64', '[]', '[]', '[]', 1, 1)")
        db.commit()
        db.close()
        old = push.Store(path).get("a")
        self.assertEqual((old["mode"], old["check_ms"], old["check_outcome"]), ("server", None, None))


class Endpoints(unittest.TestCase):
    def setUp(self):
        from flask import Flask
        self.tmp = tempfile.TemporaryDirectory()
        self.env = {k: os.environ.get(k) for k in ("CYDIAN_DATA",)}
        os.environ["CYDIAN_DATA"] = self.tmp.name
        self.store = push.Store(Path(self.tmp.name) / "push.sqlite")
        self.svc = FakePushService()
        app = Flask(__name__)
        app.register_blueprint(push.create_blueprint(FakeFetcher({}), None, store=self.store, background=False, poster=self.svc))
        self.c = app.test_client()

    def tearDown(self):
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def test_subscribe_status_test_ack_feed_unsubscribe(self):
        key = self.c.get("/api/push/key").get_json()["key"]
        self.assertEqual(len(key), 87)  # base64url of a 65-byte P-256 point
        r = self.c.post("/api/push/subscribe", json=body())
        self.assertEqual(r.status_code, 200, r.data)
        info = r.get_json()
        self.assertTrue(info["push"])
        self.assertIn("/feed/", info["feed"])
        self.assertEqual(r.headers["Cache-Control"], "no-store")
        # every open re-subscribes with the same id: same row, same feed
        again = self.c.post("/api/push/subscribe", json=body(id=info["id"])).get_json()
        self.assertEqual((again["id"], again["feed"]), (info["id"], info["feed"]))
        self.assertEqual(self.store.count(), 1)

        t = self.c.post("/api/push/test", json={"id": info["id"]})
        self.assertEqual(t.status_code, 200, t.data)
        self.assertEqual(len(self.svc.sent), 1)
        self.assertEqual(self.c.post("/api/push/test", json={"id": info["id"]}).status_code, 429)

        self.assertIsNone(self.c.post("/api/push/status", json={"id": info["id"]}).get_json()["delivered"])
        self.assertEqual(self.c.post("/api/push/ack", json={"id": info["id"], "seq": 1}).status_code, 200)
        self.assertIsNotNone(self.c.post("/api/push/status", json={"id": info["id"]}).get_json()["delivered"])

        feed = self.c.get(info["feed"].split("localhost", 1)[1])
        self.assertEqual(feed.status_code, 200)
        self.assertTrue(feed.content_type.startswith("application/atom+xml"))
        ET.fromstring(feed.data)
        self.assertEqual(self.c.get("/feed/nope").status_code, 404)

        self.c.post("/api/push/unsubscribe", json={"id": info["id"]})
        self.assertEqual(self.store.count(), 0)
        self.assertEqual(self.c.post("/api/push/status", json={"id": info["id"]}).status_code, 404)

    def test_device_mode_test_push_and_check_ack(self):
        info = self.c.post("/api/push/subscribe", json=body(mode="device")).get_json()
        self.assertEqual(info["mode"], "device")
        self.assertEqual(self.store.get(info["id"])["installed"], [])
        self.assertEqual(self.c.post("/api/push/test", json={"id": info["id"]}).status_code, 200)
        self.assertEqual(len(self.svc.sent), 1)
        self.c.post("/api/push/ack", json={"id": info["id"], "seq": 1, "ms": 3140, "outcome": "ok"})
        st = self.c.post("/api/push/status", json={"id": info["id"]}).get_json()
        self.assertEqual((st["checkMs"], st["checkOutcome"]), (3140, "ok"))
        # junk in an ack is ignored, not stored
        self.c.post("/api/push/ack", json={"id": info["id"], "ms": "lots", "outcome": "<script>"})
        st = self.c.post("/api/push/status", json={"id": info["id"]}).get_json()
        self.assertEqual((st["checkMs"], st["checkOutcome"]), (3140, "ok"))
        self.assertIsNotNone(st["delivered"])

    def test_app_serves_the_module_worker(self):
        import app as A
        with A.app.test_client().get("/sw-device.js") as r:
            self.assertEqual((r.status_code, r.mimetype), (200, "text/javascript"))
            self.assertIn(b'import "./sw.js"', r.data)

    def test_bad_requests(self):
        self.assertEqual(self.c.post("/api/push/subscribe", json=body(arch="x")).status_code, 400)
        self.assertEqual(self.c.post("/api/push/subscribe", data="nope").status_code, 400)
        self.assertEqual(self.c.post("/api/push/ack", json={"id": "nope"}).status_code, 404)
        r = self.c.post("/api/push/subscribe", json=body(subscription=None))
        self.assertEqual(self.c.post("/api/push/test", json={"id": r.get_json()["id"]}).status_code, 400)

    def test_app_serves_the_pwa_files(self):
        import app as A
        c = A.app.test_client()
        with c.get("/sw.js") as r:
            self.assertEqual((r.status_code, r.mimetype), (200, "text/javascript"))
        with c.get("/manifest.json") as r:
            m = json.loads(r.data)
            self.assertEqual((m["display"], m["start_url"]), ("standalone", "/"))
        with c.get("/") as r:
            self.assertIn(b'rel="manifest"', r.data)


class NodeTests(unittest.TestCase):
    def test_push_mjs(self):
        p = subprocess.run(["node", "--test", str(HERE / "push.test.mjs")], capture_output=True, text=True, timeout=120)
        self.assertEqual(p.returncode, 0, p.stdout[-4000:] + p.stderr[-2000:])


if __name__ == "__main__":
    unittest.main()
