/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';
import { firebaseConfig, isConfigured } from './firebase/config';

declare let self: ServiceWorkerGlobalScope;

// Офлайн: все файлы приложения кэшируются при установке.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.skipWaiting();
clientsClaim();

// Пуши приходят как data-сообщения; уведомление рисуем сами (iOS требует показывать каждое).
if (isConfigured && import.meta.env.VITE_FIREBASE_VAPID_KEY) {
  const messaging = getMessaging(initializeApp(firebaseConfig));
  onBackgroundMessage(messaging, (payload) => {
    const data = payload.data ?? {};
    const kind = data.kind ?? 'message';
    return self.registration.showNotification(data.title || 'Bobogram', {
      body: data.body ?? '',
      icon: data.icon || `${self.registration.scope}icon-192.png`,
      badge: `${self.registration.scope}icon-192.png`,
      tag: data.tag || data.chatId,
      data: { chatId: data.chatId, kind },
      requireInteraction: kind === 'call',
    });
  });
}

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
