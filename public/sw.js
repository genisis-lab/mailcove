/* Mailcove service worker: Web Push notifications only (no offline caching yet). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'New mail', body: event.data.text() };
  }
  event.waitUntil(
    (async () => {
      // Only surface notifications for a subscription the signed-in account owns
      // (guards against showing mail after switching accounts in the same browser).
      try {
        const sub = await self.registration.pushManager.getSubscription();
        if (sub) {
          const res = await fetch('/api/push/subscriptions', { credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            const owned = (data.items || []).some((s) => s.endpoint === sub.endpoint);
            if (!owned) return;
          }
        }
      } catch {
        // If the check fails (offline), still show the notification.
      }
      await self.registration.showNotification(payload.title || 'New mail', {
        body: payload.body || '',
        tag: payload.tag,
        icon: payload.icon || '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: payload.url || '/mail/inbox' },
        renotify: true,
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/mail/inbox';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'navigate', url });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
