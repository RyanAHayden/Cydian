"""F39: AltStore news pushes from the daily run, end to end (real node, real encryption, a fake push service)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetch  # noqa: E402
import push  # noqa: E402

ENDPOINT = "https://web.push.apple.com/QGuQyavXutnMHtYtPO2E"
P256DH = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
ALT = "https://alt.example.org/source.json"


class AltFetcher(fetch.Fetcher):
    def __init__(self, files):
        super().__init__(resolve=lambda host, port: ["93.184.216.34"])
        self.files = files
        self.gets = []

    def get(self, url, deadline=None, max_bytes=None):
        self.gets.append(url)
        if url in self.files:
            return fetch.Response(url, 200, {}, self.files[url].encode())
        return fetch.Response(url, 404, {}, b"")


class Svc:
    def __init__(self, status=201):
        self.status, self.sent = status, []

    def __call__(self, endpoint, headers, body):
        self.sent.append(endpoint)
        return self.status


def source(*items):
    return json.dumps({"name": "Alt", "apps": [], "news": [
        {"identifier": i, "title": i.title(), "date": d, "notify": n} for i, n, d in items]})


def body(**over):
    b = {"subscription": {"endpoint": ENDPOINT, "keys": {"p256dh": P256DH, "auth": AUTH}}, "arch": "iphoneos-arm64",
         "sources": [], "installed": [], "holds": [], "altSources": [ALT]}
    b.update(over)
    return b


class News(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = push.Store(Path(self.tmp.name) / "push.sqlite")
        self.keys = push.vapid_keys(Path(self.tmp.name))
        self.fetcher = AltFetcher({ALT: source(("old", True, "2026-01-01"))})
        self.svc = Svc()

    def tearDown(self):
        self.tmp.cleanup()

    def run_news(self, t):
        return push.check_news(self.store, self.fetcher, keys=self.keys, poster=self.svc, t=t)

    def test_notify_item_pushed_once_and_quiet_one_never(self):
        sub, _ = self.store.upsert(None, push.clean_subscription(body()), "https://cydian.example", 1000)
        self.assertEqual(self.store.get(sub["id"])["alt_sources"], [ALT])
        # first run: the source's old news is the baseline
        self.assertEqual(self.run_news(2000), {sub["id"]: 0})
        self.assertEqual(self.svc.sent, [])
        self.assertEqual(self.store.get(sub["id"])["news_sent"], {ALT: ["old"]})
        # a notify:true and a notify:false item: one push
        self.fetcher.files[ALT] = source(("old", True, "2026-01-01"), ("loud", True, "2026-11-16"),
                                         ("quiet", False, "2026-11-17"))
        self.assertEqual(self.run_news(3000), {sub["id"]: 1})
        self.assertEqual(self.svc.sent, [ENDPOINT])
        # and never again
        self.assertEqual(self.run_news(4000), {sub["id"]: 0})
        self.assertEqual(len(self.svc.sent), 1)

    def test_failed_push_is_retried(self):
        sub, _ = self.store.upsert(None, push.clean_subscription(body()), "https://cydian.example", 1000)
        self.run_news(2000)
        self.fetcher.files[ALT] = source(("old", True, "2026-01-01"), ("loud", True, "2026-11-16"))
        self.svc.status = 500
        self.assertEqual(self.run_news(3000), {sub["id"]: 0})
        self.svc.status = 201
        self.assertEqual(self.run_news(4000), {sub["id"]: 1})
        self.assertEqual(len(self.svc.sent), 2)

    def test_each_source_fetched_once_and_device_subs_skipped(self):
        a, _ = self.store.upsert(None, push.clean_subscription(body()), "https://cydian.example", 1000)
        b, _ = self.store.upsert(None, push.clean_subscription(body()), "https://cydian.example", 1000)
        self.store.upsert(None, push.clean_subscription(body(mode="device")), "https://cydian.example", 1000)
        self.assertEqual(set(self.run_news(2000)), {a["id"], b["id"]})
        self.assertEqual(self.fetcher.gets, [ALT])

    def test_alt_sources_are_validated(self):
        with self.assertRaises(push.Invalid):
            push.clean_subscription(body(altSources=["file:///etc/passwd"]))
        with self.assertRaises(push.Invalid):
            push.clean_subscription(body(altSources="https://x/"))
        self.assertEqual(push.clean_subscription(body(altSources=None))["alt_sources"], [])
        self.assertEqual(push.clean_subscription(body(mode="device"))["alt_sources"], [])


if __name__ == "__main__":
    unittest.main()
