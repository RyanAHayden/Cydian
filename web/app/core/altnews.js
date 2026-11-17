// AltStore news as notifications (F39): which news items a subscriber should hear about, the same rule on the
// server (web/push.mjs `news`, for "Daily Upgrade Check" subscribers) and on the phone (device-check.js, for
// "Check on This Device"). Pure JS, no DOM, no network: callers fetch the source JSON and keep `sent`.
//
//   newsRound(urls, sent, texts, max)  -> { items: [item], dropped, sent }
//     urls   the subscriber's AltStore source URLs (records with kind "altstore", their `uri`)
//     sent   { <url>: [news identifier] } what was already pushed (or seen when the source was first checked)
//     texts  { <url>: source JSON text | parsed JSON | null }  null: unreachable today (its `sent` is kept)
//     items  news with notify: true not in `sent`, newest first, at most `max`, each with `source`, `sourceName`
//     sent   the next map, as if every item goes out: callers keep the old one when the push fails
//   newsPayload(item)                  -> { title, body, url, tag } what sw.js (or the device check) shows
//
// The first time a source is checked for a subscriber, what it already lists is old news: it becomes the
// baseline and nothing is pushed (adding a source with twenty notify: true posts must not ring twenty times).
// Items over `max` in one round count as sent: a source that posts a burst rings at most `max` times a day.
// A source's list only keeps identifiers the source still lists, so `sent` doesn't grow for ever.
import { parseAltSource, newsToNotify, altKey } from "./altstore.js";

export const NEWS_MAX = 3;

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return url; } };

export function newsRound(urls = [], sent = {}, texts = {}, max = NEWS_MAX) {
  const next = {};
  const items = [];
  for (const url of new Set((urls ?? []).filter((u) => typeof u === "string" && u))) {
    const prev = Array.isArray(sent?.[url]) ? sent[url] : null;
    let parsed = null;
    const text = texts?.[url];
    if (text != null) {
      try { parsed = parseAltSource(text); } catch { parsed = null; }
    }
    if (!parsed) {
      if (prev) next[url] = prev;
      continue;
    }
    const ids = parsed.news.map((n) => n.identifier);
    if (!prev) {
      next[url] = ids;
      continue;
    }
    const fresh = newsToNotify(parsed, prev);
    const listed = new Set(ids);
    next[url] = [...new Set([...prev.filter((id) => listed.has(id)), ...fresh.map((n) => n.identifier)])];
    for (const n of fresh) items.push({ ...n, source: url, sourceName: parsed.name || hostOf(url) });
  }
  items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  return { items: items.slice(0, max), dropped: Math.max(0, items.length - max), sent: next };
}

// One notification per item. Tapping it opens the source's page (the Sources tab's alt:<url> page), where the
// news is drawn; the item's own link is there too. The tag is per item, so two news don't replace each other.
export function newsPayload(item) {
  return {
    title: item.title,
    body: item.caption || `News from ${item.sourceName}`,
    url: "/#/sources/" + encodeURIComponent(altKey(item.source)),
    tag: `cydian-news:${item.source}#${item.identifier}`.slice(0, 256),
  };
}
