/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

// Офлайн: все файлы приложения кэшируются при установке.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.skipWaiting();
clientsClaim();

interface PushPayload {
  kind?: 'message' | 'call';
  chatId?: string;
  title?: string;
  body?: string;
  tag?: string;
}

const isApple = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent);

// Пуш от серверной функции (Web Push). iOS требует показывать уведомление на каждый пуш.
self.addEventListener('push', (event) => {
  let data: PushPayload = {};
  try {
    data = (event.data?.json() ?? {}) as PushPayload;
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const focused = windows.some((w) => (w as WindowClient).focused && w.visibilityState === 'visible');
      // Приложение открыто перед глазами — звук в самом приложении, уведомление не нужно.
      if (focused && !isApple && data.kind !== 'call') return;
      await self.registration.showNotification(data.title || 'Bobogram', {
        body: data.body ?? '',
        icon: `${self.registration.scope}icon-192.png`,
        badge: `${self.registration.scope}icon-192.png`,
        tag: data.tag || data.chatId,
        data: { chatId: data.chatId },
        requireInteraction: data.kind === 'call',
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = (event.notification.data as { chatId?: string } | undefined)?.chatId;
  const url = `${self.registration.scope}${chatId ? `#/c/${chatId}` : ''}`;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(self.registration.scope)) {
          await client.focus();
          if ('navigate' in client) await (client as WindowClient).navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
