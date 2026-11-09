// Service worker do Painel de Produção: recebe os avisos de produção (Web Push) e abre o app no lugar certo.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Painel de Produção', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Painel de Produção', {
    body: d.body || '', tag: d.tag || undefined, renotify: true,
    icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || './?tab=bomdia' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('navigate' in c) { await c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
