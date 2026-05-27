// Service worker: cache dell'app-shell per l'uso offline. data.json NON è qui
// dentro (vive su api.github.com, cross-origin): la sync resta gestita da app.js.
// NB: bumpare CACHE (es. -v2) quando cambia un file dell'app-shell, per
// invalidare la cache vecchia ed evitare codice stantio.
const CACHE = "gymsched-v28";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./store.js",
  "./session.js",
  "./editor.js",
  "./timer.js",
  "./plan.js",
  "./nutrition.js",
  "./wakelock.js",
  "./manifest.json",
  "./icon.svg",
];

// NB: niente skipWaiting() automatico: il nuovo SW resta in "waiting" finché
// l'utente non tocca il banner di aggiornamento (vedi SKIP_WAITING sotto e app.js).
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Solo GET same-origin: API GitHub e font passano diretti alla rete.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => req.destination === "document" ? caches.match("./index.html") : Response.error()))
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      for (const c of cs) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
