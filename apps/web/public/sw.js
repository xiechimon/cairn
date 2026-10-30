// Minimal PWA service worker: notification click routing only. Deliberately NO fetch handler —
// Chrome no longer requires one for install, and an empty one taxes every request with SW
// dispatch/boot latency (worst on iOS, which never got Chrome's no-op-handler skip).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  const n = data.notification || {}
  event.waitUntil((async () => {
    // navigate is absolute; the page routes client-side, so keep only path+query+hash.
    let href = '/app'
    try {
      const u = new URL(n.navigate)
      href = u.pathname + u.search + u.hash
    } catch {}
    // The payload title is the todo title, not the app name, so iOS's fixed "from <app name>"
    // attribution line never duplicates it — the message body stays in the (multi-line) body slot.
    await self.registration.showNotification(n.title || 'Cairn', {
      body: n.body,
      tag: n.tag,
      data: { href },
    })
    if (typeof data.id === 'string' && typeof data.receiptUrl === 'string' && /^\/api\/teams\/[^/]+\/push\/receipts$/.test(data.receiptUrl)) {
      const cache = await caches.open('push-auth')
      const stored = await cache.match('/__push-auth')
      const auth = stored ? await stored.json() : {}
      const response = await fetch(data.receiptUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(typeof auth.token === 'string' && auth.token ? { authorization: `Bearer ${auth.token}` } : {}) },
        body: JSON.stringify({ id: data.id }),
      })
      if (!response.ok) throw new Error('Push receipt rejected')
    }
  })())
})

// Deep-link clicks from showNotification(): focus an existing app window and hand it the href to route
// client-side. iOS standalone PWAs ignore WindowClient.navigate() (the app just foregrounds on its old
// page), so the page routes itself. postMessage alone is not enough: iOS suspends background PWA pages
// and drops messages posted to them, so a click that merely foregrounds a running app would lose its
// href. The href is persisted to CacheStorage first — every page wake path pulls and consumes it
// (ServiceWorkerRegister.tsx) — and postMessage stays as the fast path for pages actually listening.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const href = (event.notification.data && event.notification.data.href) || '/app'
  event.waitUntil((async () => {
    try {
      const cache = await caches.open('nav')
      await cache.put('/__pending-nav', new Response(JSON.stringify({ href, at: Date.now() })))
    } catch {}
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const win = wins[0]
    if (win) {
      try {
        await win.focus()
        win.postMessage({ type: 'notificationclick', href })
        return
      } catch {}
      // Stale client (iOS can keep dead windows in the list) — fall through to a fresh window.
    }
    // iOS may launch the PWA at start_url rather than href; message the fresh client so it still routes.
    const opened = await self.clients.openWindow(href)
    if (opened) opened.postMessage({ type: 'notificationclick', href })
  })())
})
