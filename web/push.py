"""Upgrade alerts for the site (F10): Web Push and a private Atom feed, from a daily server-side check.

Opt-in only. The browser sends its sources, a slim installed list ([{id, version, held}]) and Ignored Upgrades;
nothing is kept for visitors who don't turn it on, and turning it off deletes the row. Each subscriber gets two
unguessable tokens: `id` (manages the subscription; only ever sent in POST bodies, so it stays out of access logs)
and `feed` (the read-only feed URL, /feed/<feed>).

The upgrade diff and the crypto run in node (push.mjs): the diff with the browser's own web/app/core/ code, the
crypto because Python's stdlib has no P-256 or AES-GCM. Every repo fetch goes through fetch.py's SSRF guard, and
pushes only go to the known push services (PUSH_HOSTS).

F34 adds a second mode, "device" (Settings: Check on This Device): the server keeps only the push subscription,
no sources and no installed list, and the daily run sends those subscribers a bare {"type": "check"} push
(check_message); the phone's service worker (app/sw-device.js, app/device-check.js) fetches and diffs on the
device and shows the notification itself. Its delivery ack reports how long that took (check_ms), which is how
iOS's push-handler time limit gets measured in the field.

F39 adds AltStore news: a server-mode subscriber's AltStore source URLs come along (`altSources`), the daily run
fetches each source's JSON (through the SSRF guard, once for everyone) and pushes the news items flagged
`notify: true` that subscriber hasn't been sent (check_news; the rule is app/core/altnews.js, run in node).
A device-mode phone does the same itself in device-check.js.

    python push.py run       check everyone now and push "n upgrades" where something new showed up
    python push.py daemon    run once a day at CYDIAN_PUSH_HOUR (UTC); compose runs this as its own service

Settings (environment): CYDIAN_DATA (where push.sqlite and vapid.json live; default web/data),
CYDIAN_VAPID_SUBJECT (the VAPID `sub`; default the subscriber's own origin), CYDIAN_PUSH_HOUR (16),
CYDIAN_NODE (node), CYDIAN_PUSH_MAX (10000 subscribers), CYDIAN_PUSH_EXPIRE_DAYS (180: a subscriber whose app
hasn't been opened for that long is deleted).
"""
from __future__ import annotations

import base64
import concurrent.futures
import contextlib
import gzip
import hashlib
import http.client
import json
import os
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from email.utils import format_datetime
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from xml.sax.saxutils import escape

from flask import Blueprint, jsonify, request, url_for

import fetch

HERE = Path(__file__).resolve().parent
PUSH_MJS = HERE / "push.mjs"

# Push services the browsers use. A subscription endpoint anywhere else is refused: the server POSTs to it.
PUSH_HOSTS = ("push.apple.com", "fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com")

MAX_BODY = 1024 * 1024       # one subscribe request
MAX_SOURCES = 200
MAX_INSTALLED = 20000
MAX_FIELD = 512              # any one string (URI, package id, version)
TTL = 24 * 3600              # how long a push service may hold a push for an offline phone
SHOWN_NAMES = 3              # names in the notification text before "and n more"


def data_dir() -> Path:
    return Path(os.environ.get("CYDIAN_DATA") or HERE / "data")


def now() -> float:
    return time.time()


# ---- validation -------------------------------------------------------------------------------------------

class Invalid(ValueError):
    pass


def _str(v, what, required=True):
    if v is None and not required:
        return None
    if not isinstance(v, str) or not v or len(v) > MAX_FIELD:
        raise Invalid(f"{what} must be a string of 1-{MAX_FIELD} characters")
    return v


def push_host_ok(host: str) -> bool:
    host = (host or "").lower().rstrip(".")
    return any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


def check_endpoint(url: str) -> str:
    _str(url, "endpoint")
    if len(url) > 2048:
        raise Invalid("endpoint too long")
    u = urlsplit(url)
    if u.scheme != "https" or u.port not in (None, 443) or u.username or u.password or not push_host_ok(u.hostname):
        raise Invalid("not a known push service")
    return url


def clean_subscription(body: dict) -> dict:
    """The subscribe request -> the fields to store. Raises Invalid with a message for the browser."""
    if not isinstance(body, dict):
        raise Invalid("expected a JSON object")
    out = {}
    sub = body.get("subscription")
    if sub is not None:
        if not isinstance(sub, dict) or not isinstance(sub.get("keys"), dict):
            raise Invalid("subscription must be a PushSubscription's JSON")
        out["endpoint"] = check_endpoint(sub.get("endpoint"))
        out["p256dh"] = _str(sub["keys"].get("p256dh"), "p256dh")
        out["auth"] = _str(sub["keys"].get("auth"), "auth")
    else:
        out["endpoint"] = out["p256dh"] = out["auth"] = None
    arch = body.get("arch", "iphoneos-arm64")
    if arch not in ("iphoneos-arm64", "iphoneos-arm"):
        raise Invalid("unknown arch")
    out["arch"] = arch
    mode = body.get("mode", "server")
    if mode not in MODES:
        raise Invalid("unknown mode")
    out["mode"] = mode
    if mode == "device":  # the lists stay on the phone: nothing of them is kept here, whatever was sent
        out["sources"], out["installed"], out["holds"], out["alt_sources"] = [], [], [], []
        return out
    alt = body.get("altSources") or []
    if not isinstance(alt, list) or len(alt) > MAX_SOURCES:
        raise Invalid(f"altSources must be a list of at most {MAX_SOURCES}")
    for u in alt:
        if urlsplit(_str(u, "AltStore source")).scheme not in ("http", "https"):
            raise Invalid("an AltStore source must be http(s)")
    out["alt_sources"] = list(dict.fromkeys(alt))
    sources = body.get("sources")
    if not isinstance(sources, list) or len(sources) > MAX_SOURCES:
        raise Invalid(f"sources must be a list of at most {MAX_SOURCES}")
    clean = []
    for s in sources:
        if not isinstance(s, dict):
            raise Invalid("a source must be an object")
        uri = _str(s.get("uri"), "source uri")
        if urlsplit(uri).scheme not in ("http", "https"):
            raise Invalid("a source must be http(s)")
        comps = s.get("components") or []
        if not isinstance(comps, list) or len(comps) > 20:
            raise Invalid("components must be a short list")
        clean.append({"uri": uri, "dist": _str(s.get("dist") or "./", "dist"),
                      "components": [_str(c, "component") for c in comps]})
    out["sources"] = clean
    installed = body.get("installed")
    if not isinstance(installed, list) or len(installed) > MAX_INSTALLED:
        raise Invalid(f"installed must be a list of at most {MAX_INSTALLED}")
    out["installed"] = [{"id": _str(p.get("id"), "package id"), "version": _str(p.get("version"), "version"),
                         **({"held": True} if p.get("held") is True else {})}
                        for p in installed if isinstance(p, dict)]
    holds = body.get("holds") or []
    if not isinstance(holds, list) or len(holds) > MAX_INSTALLED:
        raise Invalid("holds must be a list")
    out["holds"] = [_str(h, "hold") for h in holds]
    return out


# ---- the store --------------------------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS subs (
  id TEXT PRIMARY KEY, feed TEXT UNIQUE NOT NULL,
  endpoint TEXT, p256dh TEXT, auth TEXT, origin TEXT,
  arch TEXT NOT NULL, sources TEXT NOT NULL, installed TEXT NOT NULL, holds TEXT NOT NULL, inputs TEXT,
  created REAL NOT NULL, seen REAL NOT NULL,
  checked REAL, upgrades TEXT, check_error TEXT,
  notified TEXT, seq INTEGER NOT NULL DEFAULT 0, pushed REAL, push_status TEXT, delivered REAL
);
"""
JSON_COLS = ("sources", "installed", "holds", "upgrades", "notified", "alt_sources", "news_sent")
MODES = ("server", "device")
ACK_OUTCOMES = ("ok", "timeout", "error", "unsupported")  # how an on-device check ended (app/device-check.js)
# Columns added after F10's schema, added to an existing push.sqlite on open.
ADDED_COLS = {"mode": "TEXT NOT NULL DEFAULT 'server'", "check_ms": "INTEGER", "check_outcome": "TEXT",
              # F39: AltStore source URLs, and {url: [news identifier]} already pushed to this subscriber
              "alt_sources": "TEXT", "news_sent": "TEXT"}


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)
            have = {r[1] for r in db.execute("PRAGMA table_info(subs)")}
            for col, decl in ADDED_COLS.items():
                if col not in have:
                    db.execute(f"ALTER TABLE subs ADD COLUMN {col} {decl}")

    @contextlib.contextmanager
    def _db(self):
        """One connection per call (threads share the store): commits on success, always closes."""
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def _row(r):
        if r is None:
            return None
        d = dict(r)
        for c in JSON_COLS:
            d[c] = json.loads(d[c]) if d.get(c) else ([] if c != "upgrades" else None)
        return d

    def get(self, sub_id: str):
        with self._db() as db:
            return self._row(db.execute("SELECT * FROM subs WHERE id = ?", (sub_id,)).fetchone())

    def by_feed(self, feed: str):
        with self._db() as db:
            return self._row(db.execute("SELECT * FROM subs WHERE feed = ?", (feed,)).fetchone())

    def all(self, ids=None):
        with self._db() as db:
            if ids is None:
                rows = db.execute("SELECT * FROM subs").fetchall()
            else:
                rows = [r for i in ids for r in db.execute("SELECT * FROM subs WHERE id = ?", (i,)).fetchall()]
        return [self._row(r) for r in rows]

    def count(self) -> int:
        with self._db() as db:
            return db.execute("SELECT COUNT(*) FROM subs").fetchone()[0]

    def upsert(self, sub_id: str | None, fields: dict, origin: str, t: float):
        """Saves a subscription; returns (row, changed): changed when the check's inputs differ from last time."""
        mode = fields.get("mode", "server")
        inputs = hashlib.sha256(json.dumps([fields["arch"], fields["sources"], fields["installed"], fields["holds"]]
                                           + ([mode] if mode != "server" else []), sort_keys=True).encode()).hexdigest()
        enc = {k: json.dumps(v) if k in JSON_COLS else v for k, v in fields.items()}
        enc["mode"] = mode
        with self._db() as db:
            cur = db.execute("SELECT inputs FROM subs WHERE id = ?", (sub_id,)).fetchone() if sub_id else None
            if cur is None:
                sub_id = secrets.token_urlsafe(24)
                db.execute("INSERT INTO subs (id, feed, endpoint, p256dh, auth, origin, arch, sources, installed, "
                           "holds, inputs, created, seen, mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                           (sub_id, secrets.token_urlsafe(24), enc["endpoint"], enc["p256dh"], enc["auth"], origin,
                            enc["arch"], enc["sources"], enc["installed"], enc["holds"], inputs, t, t, enc["mode"]))
                changed = True
            else:
                changed = cur["inputs"] != inputs
                db.execute("UPDATE subs SET endpoint=?, p256dh=?, auth=?, origin=?, arch=?, sources=?, installed=?, "
                           "holds=?, inputs=?, seen=?, mode=? WHERE id=?",
                           (enc["endpoint"], enc["p256dh"], enc["auth"], origin, enc["arch"], enc["sources"],
                            enc["installed"], enc["holds"], inputs, t, enc["mode"], sub_id))
            # F39: kept beside the APT lists, outside `inputs`: a new AltStore source needs no upgrade check
            db.execute("UPDATE subs SET alt_sources=? WHERE id=?", (json.dumps(fields.get("alt_sources") or []), sub_id))
            if mode == "device":  # nothing about the packages stays from a server-mode past either
                db.execute("UPDATE subs SET upgrades=NULL, notified=NULL, checked=NULL, check_error=NULL WHERE id=?",
                           (sub_id,))
        return self.get(sub_id), changed

    def update(self, sub_id: str, **fields):
        if not fields:
            return
        cols = ", ".join(f"{k} = ?" for k in fields)
        vals = [json.dumps(v) if k in JSON_COLS else v for k, v in fields.items()]
        with self._db() as db:
            db.execute(f"UPDATE subs SET {cols} WHERE id = ?", (*vals, sub_id))

    def delete(self, sub_id: str) -> bool:
        with self._db() as db:
            return db.execute("DELETE FROM subs WHERE id = ?", (sub_id,)).rowcount > 0

    def expire(self, before: float) -> int:
        with self._db() as db:
            return db.execute("DELETE FROM subs WHERE seen < ?", (before,)).rowcount


# ---- the diff-to-notification rules ----------------------------------------------------------------------

def upgrade_key(u: dict) -> str:
    return f"{u['id']}={u['version']}"


def with_since(upgrades: list, previous: list | None, t: float) -> list:
    """Each upgrade with `since`: when the check first saw that version (kept across checks), for the feed."""
    seen = {upgrade_key(u): u.get("since", t) for u in previous or []}
    return [{**u, "since": seen.get(upgrade_key(u), t)} for u in upgrades]


def decide(upgrades: list, notified: list) -> bool:
    """Push when there is an upgrade the last push (or the last quiet check) didn't already cover. The same
    "3 upgrades" isn't pushed again every day; one more version, or a new package, is."""
    known = set(notified or [])
    return any(upgrade_key(u) not in known for u in upgrades)


def notification_text(upgrades: list) -> str:
    names = [u.get("name") or u["id"] for u in upgrades]
    if len(names) == 1:
        return f"{names[0]} {upgrades[0]['version']} is available."
    shown = names[:SHOWN_NAMES]
    rest = len(names) - len(shown)
    listed = ", ".join(shown[:-1]) + " and " + shown[-1] if rest == 0 else ", ".join(shown) + f" and {rest} more"
    return f"{len(names)} upgrades: {listed}."


def message(upgrades: list, sub_id: str, seq: int) -> dict:
    """The push payload the service worker (app/sw.js) shows. `id` and `seq` come back in its delivery ack."""
    n = len(upgrades)
    return {"title": "1 Upgrade" if n == 1 else f"{n} Upgrades", "body": notification_text(upgrades), "count": n,
            "url": "/#/changes", "tag": "cydian-upgrades", "id": sub_id, "seq": seq}


def check_message(sub_id: str, seq: int) -> dict:
    """F34's bare push for a "device" subscriber: no upgrade in it (the server doesn't know them). app/sw.js hands
    it to sw-device.js, which checks on the phone and shows the notification itself."""
    return {"type": "check", "url": "/#/changes", "id": sub_id, "seq": seq}


# ---- node ---------------------------------------------------------------------------------------------------

class NodeError(RuntimeError):
    pass


def node(cmd: str, data=None, timeout: float = 600):
    exe = os.environ.get("CYDIAN_NODE", "node")
    try:
        p = subprocess.run([exe, str(PUSH_MJS), cmd], input=json.dumps(data or {}).encode(), capture_output=True,
                           timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise NodeError(f"node {cmd}: {e}") from e
    if p.returncode != 0:
        raise NodeError(f"node {cmd}: {p.stderr.decode(errors='replace')[-2000:]}")
    return json.loads(p.stdout)


_keys_lock = threading.Lock()


def vapid_keys(directory: Path | None = None) -> dict:
    """The server's VAPID key pair, made on first use and kept in vapid.json (0600)."""
    path = (directory or data_dir()) / "vapid.json"
    with _keys_lock:
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            keys = node("keys", timeout=30)
            tmp = path.with_suffix(".tmp")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                json.dump(keys, f)
            os.replace(tmp, path)
        return json.loads(path.read_text())


# ---- sending ----------------------------------------------------------------------------------------------

def post(endpoint: str, headers: dict, body: bytes, timeout: float = 15) -> int:
    """POSTs one push. Returns the push service's HTTP status, or 0 when it couldn't be reached."""
    check_endpoint(endpoint)
    u = urlsplit(endpoint)
    path = u.path + ("?" + u.query if u.query else "")
    conn = http.client.HTTPSConnection(u.hostname, 443, timeout=timeout)
    try:
        conn.request("POST", path or "/", body=body, headers={**headers, "Content-Length": str(len(body))})
        r = conn.getresponse()
        r.read(4096)
        return r.status
    except OSError:
        return 0
    finally:
        conn.close()


def subject_for(sub: dict) -> str:
    return os.environ.get("CYDIAN_VAPID_SUBJECT") or sub.get("origin") or "https://localhost"


def send(store: Store, items: list, keys: dict, poster=post, t: float | None = None) -> dict:
    """items: [(sub, payload dict)]. Encrypts in node, POSTs each, files the outcome. A 404 or 410 means the
    browser dropped the subscription (iOS does now and then): the endpoint is forgotten, the feed stays, and the
    app re-subscribes when it next opens. Returns {sub id: status}."""
    t = now() if t is None else t
    items = [(s, p) for s, p in items if s.get("endpoint")]
    if not items:
        return {}
    by_subject: dict[str, list] = {}
    for s, p in items:
        by_subject.setdefault(subject_for(s), []).append((s, p))
    out = {}
    for subject, group in by_subject.items():
        prepared = node("encrypt", {"vapid": {**keys, "subject": subject}, "ttl": TTL,
                                    "messages": [{"endpoint": s["endpoint"], "p256dh": s["p256dh"], "auth": s["auth"],
                                                  "payload": json.dumps(p)} for s, p in group]})
        for (s, p), req in zip(group, prepared):
            if req.get("error"):
                status = 0
                out[s["id"]] = "bad key: " + req["error"]
            else:
                try:
                    status = poster(req["endpoint"], req["headers"], base64.b64decode(req["body"]))
                except Invalid:
                    status = 0
                out[s["id"]] = status
            fields = {"pushed": t, "push_status": str(out[s["id"]])}
            if status in (404, 410):
                fields.update(endpoint=None, p256dh=None, auth=None)
            store.update(s["id"], **fields)
    return out


# ---- the check --------------------------------------------------------------------------------------------

def fetch_all(dirs, fetcher, cache, workdir: Path, workers: int = 8) -> dict:
    """dir -> path of its Packages text in workdir, or None (no index there, or the fetch failed)."""
    def one(i_dir):
        i, d = i_dir
        try:
            _, gz, _ = fetch.fetch_packages(fetcher, d, cache)
        except fetch.FetchError:
            return d, None
        p = workdir / f"{i}.txt"
        p.write_bytes(gzip.decompress(gz))
        return d, str(p)
    with concurrent.futures.ThreadPoolExecutor(workers) as ex:
        return dict(ex.map(one, enumerate(sorted(dirs))))


def check(store: Store, fetcher, cache, ids=None, notify: bool = True, keys: dict | None = None, poster=post,
          t: float | None = None, log=lambda *a: None) -> dict:
    """Checks subscribers (all, or `ids`) for upgrades and files them for the feed. With `notify`, pushes to
    those with something new (decide()). Returns {id: {"count", "pushed"}}."""
    t = now() if t is None else t
    subs = [s for s in store.all(ids) if s.get("mode") != "device"]  # those check on the phone (check_device)
    if not subs:
        return {}
    by_arch: dict[str, list] = {}
    for s in subs:
        by_arch.setdefault(s["arch"], []).extend(s["sources"])
    dirs = set()
    for arch, sources in by_arch.items():
        for r in node("dirs", {"arch": arch, "sources": sources}):
            if isinstance(r, list):
                dirs.update(r)
    with tempfile.TemporaryDirectory(prefix="cydian-push-") as tmp:
        files = fetch_all(dirs, fetcher, cache, Path(tmp))
        log(f"push: {len(subs)} subscribers, {len(dirs)} indexes, {sum(1 for v in files.values() if v)} fetched")
        result = node("diff", {"files": files, "subscribers": [
            {"id": s["id"], "arch": s["arch"], "sources": s["sources"], "installed": s["installed"],
             "holds": s["holds"]} for s in subs]})
    out = {}
    to_send = []
    for s in subs:
        r = result.get(s["id"]) or {"available": []}
        upgrades = with_since(r["available"], s["upgrades"], t)
        fields = {"checked": t, "upgrades": upgrades, "check_error": None}
        pushing = notify and s.get("endpoint") and upgrades and decide(upgrades, s["notified"])
        if notify and not pushing:
            fields["notified"] = [upgrade_key(u) for u in upgrades]  # nothing new: today's list is the baseline
        if pushing:
            fields["seq"] = s["seq"] + 1
            to_send.append(({**s, "seq": fields["seq"]}, message(upgrades, s["id"], fields["seq"]), upgrades))
        store.update(s["id"], **fields)
        out[s["id"]] = {"count": len(upgrades), "pushed": False}
    if to_send:
        status = send(store, [(s, p) for s, p, _ in to_send], keys or vapid_keys(), poster, t)
        for s, _, upgrades in to_send:
            ok = isinstance(status.get(s["id"]), int) and 200 <= status[s["id"]] < 300
            out[s["id"]]["pushed"] = ok
            if ok:  # a failed push is retried tomorrow
                store.update(s["id"], notified=[upgrade_key(u) for u in upgrades])
    return out


def check_device(store: Store, keys: dict | None = None, poster=post, t: float | None = None) -> dict:
    """The daily push for "device" subscribers: a bare check_message to each with an endpoint, every day (only the
    phone knows whether anything is new). Returns {id: {"count": None, "pushed"}}."""
    t = now() if t is None else t
    subs = [s for s in store.all() if s.get("mode") == "device" and s.get("endpoint")]
    if not subs:
        return {}
    items = []
    for s in subs:
        store.update(s["id"], seq=s["seq"] + 1)
        items.append(({**s, "seq": s["seq"] + 1}, check_message(s["id"], s["seq"] + 1)))
    status = send(store, items, keys or vapid_keys(), poster, t)
    return {s["id"]: {"count": None, "pushed": isinstance(status.get(s["id"]), int) and 200 <= status[s["id"]] < 300}
            for s, _ in items}


MAX_ALT_BYTES = 8 * 1024 * 1024  # one AltStore source's JSON


def fetch_alt(urls, fetcher, workdir: Path, workers: int = 8) -> dict:
    """url -> path of that AltStore source's body in workdir, or None (refused, unreachable, not 2xx)."""
    def one(i_url):
        i, url = i_url
        try:
            r = fetcher.get(url, max_bytes=MAX_ALT_BYTES)
        except fetch.FetchError:
            return url, None
        if not 200 <= r.status < 300:
            return url, None
        p = workdir / f"alt{i}.json"
        p.write_bytes(r.body)
        return url, str(p)
    with concurrent.futures.ThreadPoolExecutor(workers) as ex:
        return dict(ex.map(one, enumerate(sorted(urls))))


def check_news(store: Store, fetcher, keys: dict | None = None, poster=post, t: float | None = None,
               log=lambda *a: None) -> dict:
    """F39: AltStore news for server-mode subscribers with notifications on. Each source is fetched once; node
    (core/altnews.js) picks each subscriber's notify: true items not sent before. A source a subscriber hasn't been
    checked against yet only sets the baseline. `news_sent` moves on once that subscriber's pushes all went out,
    so a failed push is retried tomorrow. Returns {id: number of news pushed}."""
    t = now() if t is None else t
    subs = [s for s in store.all() if s.get("mode") != "device" and s.get("endpoint") and s.get("alt_sources")]
    if not subs:
        return {}
    urls = {u for s in subs for u in s["alt_sources"]}
    with tempfile.TemporaryDirectory(prefix="cydian-news-") as tmp:
        files = fetch_alt(urls, fetcher, Path(tmp))
        result = node("news", {"files": files, "subscribers": [
            {"id": s["id"], "altSources": s["alt_sources"],
             "sent": s["news_sent"] if isinstance(s["news_sent"], dict) else {}} for s in subs]})
    log(f"push: {len(urls)} AltStore sources, {sum(1 for v in files.values() if v)} fetched")
    out, ok = {}, {}
    rounds: list[list] = []
    for s in subs:
        r = result.get(s["id"]) or {"payloads": [], "sent": s["news_sent"]}
        out[s["id"]], ok[s["id"]] = 0, True
        for i, p in enumerate(r["payloads"]):
            while len(rounds) <= i:
                rounds.append([])
            rounds[i].append((s, {**p, "id": s["id"]}))
    for items in rounds:  # send() files one status per subscriber, so one item per subscriber per call
        status = send(store, items, keys or vapid_keys(), poster, t)
        for s, _ in items:
            code = status.get(s["id"])
            if isinstance(code, int) and 200 <= code < 300:
                out[s["id"]] += 1
            else:
                ok[s["id"]] = False
    for s in subs:
        if ok[s["id"]] and s["id"] in result:
            store.update(s["id"], news_sent=result[s["id"]]["sent"])
    return out


def run_daily(store: Store, fetcher, cache, log=print):
    expired = store.expire(now() - float(os.environ.get("CYDIAN_PUSH_EXPIRE_DAYS", "180")) * 86400)
    if expired:
        log(f"push: expired {expired} subscribers")
    res = check(store, fetcher, cache, notify=True, log=log)
    res.update(check_device(store))
    log(f"push: pushed {sum(1 for r in res.values() if r['pushed'])} of {len(res)}")
    try:
        news = check_news(store, fetcher, log=log)
        log(f"push: {sum(news.values())} AltStore news pushed to {sum(1 for n in news.values() if n)} subscribers")
    except Exception as e:  # news is extra: it never costs the upgrade pushes above
        log(f"push: AltStore news failed: {e}")
    return res


# ---- the feed ---------------------------------------------------------------------------------------------

def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def feed_xml(sub: dict, self_url: str, site_url: str) -> str:
    """An Atom feed of the subscriber's upgrades as of the last check: one entry per upgrade (package, version),
    dated when the check first saw it. Readers show new entries as the versions move on."""
    ups = sub.get("upgrades") or []
    updated = max([sub.get("checked") or sub["created"]] + [u["since"] for u in ups])
    entries = []
    for u in sorted(ups, key=lambda u: (-u["since"], u["id"])):
        name = u.get("name") or u["id"]
        entries.append(
            "<entry>"
            f"<id>tag:cydian,2026:{escape(u['id'])}/{escape(u['version'])}</id>"
            f"<title>{escape(name)} {escape(u['version'])}</title>"
            f"<updated>{_iso(u['since'])}</updated>"
            f'<link rel="alternate" href="{escape(site_url)}#/changes"/>'
            f"<content type=\"text\">{escape(name)} ({escape(u['id'])}): {escape(u['installed'])} is installed, "
            f"{escape(u['version'])} is available.</content>"
            "</entry>")
    status = "This subscription checks for upgrades on the phone; the server doesn't know them." \
        if sub.get("mode") == "device" else "Not checked yet." if not sub.get("checked") else (
        f"{len(ups)} upgrade{'s' if len(ups) != 1 else ''} as of {_iso(sub['checked'])}.")
    return ('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">'
            f"<id>{escape(self_url)}</id><title>Cydian Upgrades</title><subtitle>{escape(status)}</subtitle>"
            f"<updated>{_iso(updated)}</updated><author><name>Cydian</name></author>"
            f'<link rel="self" href="{escape(self_url)}"/><link rel="alternate" href="{escape(site_url)}"/>'
            + "".join(entries) + "</feed>\n")


# ---- HTTP -------------------------------------------------------------------------------------------------

def create_blueprint(fetcher, cache, store: Store | None = None, background: bool = True, poster=post):
    """/api/push/* and /feed/<token>. `background` checks a new or changed subscriber in a thread at once (no
    push), so its feed and Settings show a count before the daily run."""
    bp = Blueprint("push", __name__)
    state = {"store": store}
    limiter = fetch.RateLimiter(rate=int(os.environ.get("CYDIAN_PUSH_RATE", "30")), per=60.0)
    last_test: dict[str, float] = {}

    def db() -> Store:
        if state["store"] is None:
            state["store"] = Store(data_dir() / "push.sqlite")
        return state["store"]

    def err(msg, status=400):
        r = jsonify({"error": msg})
        r.status_code = status
        r.headers["Cache-Control"] = "no-store"
        return r

    def ok(body):
        r = jsonify(body)
        r.headers["Cache-Control"] = "no-store"
        return r

    @bp.before_request
    def guard():
        if request.method == "POST":
            if not limiter.allow(request.remote_addr or "?"):
                return err("too many requests, slow down", 429)
            if (request.content_length or 0) > MAX_BODY:
                return err("request too large", 413)

    def body():
        b = request.get_json(silent=True, cache=False)
        return b if isinstance(b, dict) else {}

    def describe(s):
        return {"id": s["id"], "feed": url_for("push.feed", token=s["feed"], _external=True), "push": bool(s["endpoint"]),
                "checked": s["checked"], "count": None if s["upgrades"] is None else len(s["upgrades"]),
                "pushed": s["pushed"], "pushStatus": s["push_status"], "delivered": s["delivered"],
                "mode": s.get("mode") or "server", "checkMs": s.get("check_ms"), "checkOutcome": s.get("check_outcome")}

    @bp.get("/api/push/key")
    def key():
        try:
            return ok({"key": vapid_keys()["publicKey"]})
        except NodeError as e:
            return err(f"push is not set up on this server: {e}", 503)

    @bp.post("/api/push/subscribe")
    def subscribe():
        b = body()
        try:
            fields = clean_subscription(b)
        except Invalid as e:
            return err(str(e))
        sub_id = b.get("id") if isinstance(b.get("id"), str) else None
        if (not sub_id or not db().get(sub_id)) and db().count() >= int(os.environ.get("CYDIAN_PUSH_MAX", "10000")):
            return err("this server has all the subscribers it can take", 503)
        s, changed = db().upsert(sub_id, fields, request.host_url.rstrip("/"), now())
        if changed and background and s.get("mode") != "device":
            threading.Thread(target=_quiet_check, args=(db(), fetcher, cache, s["id"]), daemon=True).start()
        return ok(describe(s))

    @bp.post("/api/push/status")
    def status():
        s = db().get(str(body().get("id", "")))
        return ok(describe(s)) if s else err("no such subscription", 404)

    @bp.post("/api/push/unsubscribe")
    def unsubscribe():
        db().delete(str(body().get("id", "")))
        return ok({"deleted": True})

    @bp.post("/api/push/ack")
    def ack():
        """The service worker says a push arrived (Settings shows "Last Push Delivered")."""
        b = body()
        s = db().get(str(b.get("id", "")))
        if not s:
            return err("no such subscription", 404)
        fields = {"delivered": now()}
        # F34: an on-device check reports how long it ran and how it ended (the push-handler time measurement).
        ms, outcome = b.get("ms"), b.get("outcome")
        if isinstance(ms, (int, float)) and not isinstance(ms, bool) and 0 <= ms <= 3_600_000:
            fields["check_ms"] = int(ms)
        if outcome in ACK_OUTCOMES:
            fields["check_outcome"] = outcome
        db().update(s["id"], **fields)
        return ok({"ok": True})

    @bp.post("/api/push/test")
    def test_push():
        s = db().get(str(body().get("id", "")))
        if not s:
            return err("no such subscription", 404)
        if not s["endpoint"]:
            return err("notifications are not on for this subscription")
        if now() - last_test.get(s["id"], 0) < 30:
            return err("one test a minute, please", 429)
        last_test[s["id"]] = now()
        seq = s["seq"] + 1
        db().update(s["id"], seq=seq)
        n = len(s["upgrades"] or [])
        if s.get("mode") == "device":  # the test is a real on-device check, so it also measures one
            payload = check_message(s["id"], seq)
        else:
            payload = {"title": "Cydian", "body": "Notifications are on. You'll hear about new upgrades once a day.",
                       "count": n, "url": "/#/settings", "tag": "cydian-test", "id": s["id"], "seq": seq}
        try:
            res = send(db(), [(s, payload)], vapid_keys(), poster)
        except NodeError as e:
            return err(str(e), 503)
        code = res.get(s["id"])
        if isinstance(code, int) and 200 <= code < 300:
            return ok({"sent": True, "status": code})
        return err(f"the push service answered {code}", 502)

    @bp.get("/feed/<token>")
    def feed(token):
        s = db().by_feed(token)
        if not s:
            return "no such feed\n", 404, {"Content-Type": "text/plain; charset=utf-8"}
        xml = feed_xml(s, request.base_url, request.host_url)
        return xml, 200, {"Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "private, max-age=3600",
                          "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer"}

    return bp


def _quiet_check(store, fetcher, cache, sub_id):
    try:
        check(store, fetcher, cache, ids=[sub_id], notify=False)
    except Exception as e:  # a background nicety: the daily run tries again
        store.update(sub_id, check_error=str(e)[:500])


# ---- CLI --------------------------------------------------------------------------------------------------

def _next_run(hour: int, t: float) -> float:
    d = datetime.fromtimestamp(t, timezone.utc).replace(hour=hour, minute=0, second=0, microsecond=0)
    n = d.timestamp()
    return n if n > t else n + 86400


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd not in ("run", "daemon", "keys"):
        print("usage: push.py run | daemon | keys", file=sys.stderr)
        return 2
    if cmd == "keys":
        print(vapid_keys()["publicKey"])
        return 0
    store = Store(data_dir() / "push.sqlite")
    fetcher, cache = fetch.Fetcher(), fetch.PackagesCache()
    if cmd == "run":
        run_daily(store, fetcher, cache)
        return 0
    hour = int(os.environ.get("CYDIAN_PUSH_HOUR", "16"))
    while True:
        at = _next_run(hour, now())
        print(f"push: next run {format_datetime(datetime.fromtimestamp(at, timezone.utc))}", flush=True)
        time.sleep(max(1, at - now()))
        try:
            run_daily(store, fetcher, cache, log=lambda m: print(m, flush=True))
        except Exception as e:  # keep the daemon alive; tomorrow is another run
            print(f"push: run failed: {e}", flush=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
