/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// Injected by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── Supabase config sent from main thread on every app open ─────────────────
// Stored in memory so "Confirm" notification action can write directly to cloud
// without opening the app.
let _sbUrl = '';
let _sbKey = '';
let _sbToken = '';

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data?.type === 'SUPABASE_CONFIG') {
    _sbUrl  = event.data.url   ?? '';
    _sbKey  = event.data.key   ?? '';
    _sbToken = event.data.token ?? '';
  }
});

// ── Push received from Supabase Edge Function ────────────────────────────────
self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  let payload: {
    title: string;
    body: string;
    pendingId: string;
    amount: number;
    description: string;
    category: string;
    date: string;
    merchantCount: number;
  };

  try { payload = event.data.json(); }
  catch { return; }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [150, 80, 150],
      tag: payload.pendingId,          // replaces earlier notification for same tx
      requireInteraction: true,         // stays on screen until tapped
      data: payload,
      // Action buttons shown on Android (Chrome 50+)
      actions: [
        { action: 'confirm', title: '✓ Confirm' },
        { action: 'edit',    title: '✎ Edit'    },
      ],
    } as NotificationOptions)
  );
});

// ── Notification tapped ──────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const payload = event.notification.data as {
    pendingId: string;
    category: string;
    amount: number;
    description: string;
    date: string;
  };

  if (event.action === 'confirm' && payload?.pendingId) {
    // ── One-tap confirm: mark row in Supabase without opening the app ──────
    // App will pick up confirmed rows on next open and create local records.
    event.waitUntil(
      (async () => {
        if (!_sbUrl || !_sbKey) return;
        await fetch(
          `${_sbUrl}/rest/v1/pending_sms?id=eq.${encodeURIComponent(payload.pendingId)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': _sbKey,
              'Authorization': `Bearer ${_sbToken || _sbKey}`,
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ user_action: 'confirmed' }),
          }
        );
      })()
    );
  } else {
    // ── Edit / body-tap: open (or focus) the app at the review page ────────
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        const target = list.find(c => c.url.includes(self.location.origin));
        const url = `/review?id=${payload?.pendingId ?? ''}`;
        if (target) {
          target.focus();
          target.navigate(url);
        } else {
          self.clients.openWindow(url);
        }
      })
    );
  }
});
