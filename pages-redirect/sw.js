/*
 * A service worker whose only job is to remove itself.
 *
 * The redirect page cannot reach an installed PWA on its own. That app opens
 * to its own service worker, which serves the cached copy of the old app from
 * precache and never touches the network — so the redirect never renders, and
 * the person most invested in the app is the one most stuck on a dead copy of
 * it.
 *
 * A browser re-fetches sw.js when the app is opened. Serving *this* file at the
 * same path means the old worker is replaced by one that deletes every cache,
 * unregisters itself, and reloads whatever windows are open — which then get
 * the redirect page, because there is no worker left to intercept it.
 *
 * Deleting sw.js instead would not have worked: a 404 on the script leaves the
 * existing registration in place on some browsers, so the old worker keeps
 * serving the old app indefinitely.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) { /* unregistering matters more than tidying up */ }

    await self.registration.unregister();

    // Reload open windows so they re-request the page with no worker in the
    // way. Without this the app stays on screen, cacheless but still the old
    // build, until it is closed and reopened.
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate(c.url).catch(() => {}));
  })());
});

// Nothing is served from here. Every request goes to the network, which is the
// redirect page.
self.addEventListener('fetch', () => {});
