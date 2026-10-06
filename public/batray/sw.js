// BatRay by ClearEvo.com - service worker (notifications, and the "reader stopped" push)
// Copyright (C) 2026 Kasidit Yusuf
//
// This program is free software; you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation; either version 2 of the License, or (at your option)
// any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
// more details: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
// Source: https://github.com/ykasidit/clearevo_online_tools

// BatRay service worker: here so Chrome on Android can show notifications (the Notification constructor is not
// allowed on Android; showNotification is), and since 0.9.73 for the "reader stopped" push: the relay sends a push
// with no data when a sharing reader's page has been offline 3 minutes; this shows the notification the page left in
// the cache (its words, its language), and a tap opens the reader page, which resumes after its 30 s countdown.
const PUSH_CONFIG = '/batray/push-config';
const FALLBACK = { title: 'BatRay: the reader stopped', body: 'The reader page has been offline for 3 minutes. Tap to reopen it.', url: '/batray/?from=push' };
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function pushConfig() {
  try { const r = await (await caches.open('batray-push')).match(PUSH_CONFIG); if (r) return { ...FALLBACK, ...(await r.json()) }; } catch { /* no cache: the fallback words */ }
  return FALLBACK;
}
async function showStopped() {
  const cfg = await pushConfig();
  await self.registration.showNotification(cfg.title, { body: cfg.body, tag: 'batray-reader-stopped', renotify: true, requireInteraction: true, icon: '/batray/icon-192.png', data: { url: cfg.url, push: true } });
}
self.addEventListener('push', (e) => e.waitUntil(showStopped()));

/** A tap: the push opens (or brings up) the READER page; any other notification brings up any BatRay page. */
async function openFor(data) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const reader = list.find((c) => c.url.includes('/batray/') && !c.url.includes('view='));
  const any = list.find((c) => c.url.includes('/batray/'));
  if (data && data.push) return reader ? reader.focus() : self.clients.openWindow(data.url || FALLBACK.url);
  return any ? any.focus() : self.clients.openWindow('/batray/');
}
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(openFor(e.notification.data));
});
