// Service worker: cache dell'app-shell per l'uso offline. data.json NON è qui
// dentro (vive su api.github.com, cross-origin): la sync resta gestita da app.js.
// NB: bumpare CACHE (es. -v2) quando cambia un file dell'app-shell, per
// invalidare la cache vecchia ed evitare codice stantio.
const CACHE = "gymsched-v85";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./focus-ui.js",
  "./editor.js",
  "./catalog.js",
  "./body.js",
  "./body-data.js",
  "./plan.js",
  "./session.js",
  "./store.js",
  "./nutrition.js",
  "./timer.js",
  "./wakelock.js",
  "./fx.js",
  "./theme.js",
  "./release.js",
  "./splash.js",
  "./manifest.json",
  "./icon.svg",
  "./favicon.svg",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./supabase-client.js",
  "./vendor/supabase.js",
  "./auth.js",
  "./profile-storage.js",
  "./sync.js",
  "./sheets.js",
  "./app-context.js",
  "./cues.js",
  "./local-prefs.js",
  "./a11y.js",
  "./calendar.js",
];

// NB: niente skipWaiting() automatico: il nuovo SW resta in "waiting" finché
// l'utente non tocca il banner di aggiornamento (vedi SKIP_WAITING sotto e app.js).
// `cache: 'reload'` bypassa il cache HTTP del browser quando il SW popola
// la propria cache all'install: senza questo, GitHub Pages può servire stale
// (es. app.js vecchio dentro la cache nuova → button presente ma wire-up no).
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(ASSETS.map((url) => fetch(new Request(url, { cache: "reload" })).then((res) => c.put(url, res))))
    )
  );
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
  // version.json è dato di runtime e deve restare sempre fresco: lascia passare alla rete
  // senza intercettare/cacheare (checkStoreUpdate usa già fetch con cache:"no-store").
  if (new URL(req.url).pathname.endsWith("/version.json")) return;
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
