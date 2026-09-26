import { useEffect } from 'react';
import { supabase } from './client';
import { useApp } from '../app/store';

export type PushState = 'on' | 'off' | 'denied' | 'unsupported' | 'unconfigured';

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && (await currentSubscription())) return 'on';
  return 'off';
}

function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function save(sub: PushSubscription) {
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
  });
  if (error) throw error;
}

/** Спрашивает разрешение и подписывает это устройство. Вызывать по нажатию кнопки (требование iOS). */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const { data, error } = await supabase.functions.invoke('bobogram', { body: { action: 'vapid' } });
  const publicKey = (data as { publicKey?: string } | null)?.publicKey;
  if (error || !publicKey) return 'unconfigured';
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
  await save(sub);
  await supabase.rpc('set_push_active', { p_endpoint: sub.endpoint, p_active: true });
  return 'on';
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** Подписка устройства привязывается к тому, кто сейчас вошёл. */
export function usePushRegistration() {
  const uid = useApp((s) => s.userId);
  useEffect(() => {
    if (!uid || !supported()) return;
    void currentSubscription()
      .then((sub) => {
        if (sub && Notification.permission === 'granted') return save(sub);
      })
      .catch(() => undefined);
  }, [uid]);

  // Пока приложение на экране, сервер не шлёт пуши на это устройство (iOS показывает каждый пуш).
  useEffect(() => {
    if (!uid || !supported()) return;
    let endpoint: string | null = null;
    const mark = (active: boolean) => {
      if (!endpoint) return;
      void supabase.rpc('set_push_active', { p_endpoint: endpoint, p_active: active }).then(
        () => undefined,
        () => undefined,
      );
    };
    const tick = () => mark(document.visibilityState === 'visible');
    const hide = () => mark(false);
    void currentSubscription()
      .then((sub) => {
        endpoint = sub?.endpoint ?? null;
        tick();
      })
      .catch(() => undefined);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') tick();
    }, 30_000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('pagehide', hide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('pagehide', hide);
      hide();
    };
  }, [uid]);
}
