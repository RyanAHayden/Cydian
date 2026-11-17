// Cydian's service worker (F10): upgrade notifications only. No fetch handler, so it never caches or serves pages:
// the app keeps loading from the network exactly as before. Registered from push-client.js on the site; the app
// build (a WKWebView) has no service workers and never loads this.
//
// A push from the server (web/push.py message()) is JSON: { title, body, count, url, tag, id, seq }. iOS needs every
// push to show a notification, and this always does. It also sets the Home Screen badge to `count` (Badging API,
// iOS 16.4+ Home Screen apps) and tells the server it arrived, for Settings' "Last Push Delivered".

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function parse(data) {
  if (!data) return {};
  try {
    return data.json() || {};
  } catch {
    return { body: data.text() };
  }
}

function badge(count) {
  const nav = self.navigator;
  if (typeof count !== "number" || !nav || !nav.setAppBadge) return null;
  return (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => {});
}

self.addEventListener("push", (event) => {
  const msg = parse(event.data);
  const shown = self.registration.showNotification(msg.title || "Cydian", {
    body: msg.body || "",
    tag: msg.tag || "cydian",
    icon: "icons/icon-180.png",
    data: { url: msg.url || "/" },
  });
  const ack = msg.id
    ? fetch("/api/push/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: msg.id, seq: msg.seq }),
    }).catch(() => {})
    : null;
  event.waitUntil(Promise.all([shown, badge(msg.count), ack]));
});

// Tapping the notification: bring the open app forward on the page it names, or open it there.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin !== self.location.origin) continue;
      await c.focus();
      if (c.navigate && c.url !== url) await c.navigate(url).catch(() => {});
      return;
    }
    // Marked so the app's Home Screen launch rule (F32, launch.js) keeps this page instead of opening on Home.
    const open = new URL(url);
    open.searchParams.set("launch", "push");
    await self.clients.openWindow(open.href);
  })());
});
