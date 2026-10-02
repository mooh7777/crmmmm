const cacheName = "masar-shell-v1";
const offlinePage = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.add(offlinePage)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match(offlinePage))));
    return;
  }

  if (requestUrl.pathname.startsWith("/_next/static/") || requestUrl.pathname.startsWith("/brand/")) {
    event.respondWith(caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) void caches.open(cacheName).then((cache) => cache.put(event.request, response.clone()));
        return response;
      });
    }));
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {body: event.data?.text() ?? ""};
  }

  event.waitUntil(self.registration.showNotification(payload.title ?? "Masar", {
    body: payload.body ?? "",
    icon: "/brand/icon-192.png",
    badge: "/brand/masar-icon.png",
    tag: payload.tag ?? "masar-follow-up",
    data: {url: payload.url ?? "/ar/dashboard"},
    dir: payload.dir ?? "rtl",
    lang: payload.lang ?? "ar",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url ?? "/ar/dashboard", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then((clients) => {
    const existing = clients.find((client) => client.url === destination);
    if (existing) return existing.focus();
    return self.clients.openWindow(destination);
  }));
});