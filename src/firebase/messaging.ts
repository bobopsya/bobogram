import { useEffect } from 'react';
import { deleteField, doc, setDoc, updateDoc } from 'firebase/firestore';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app, auth, db, vapidKey, workerUrl } from './init';
import { useApp } from '../app/store';

export type PushState = 'on' | 'off' | 'denied' | 'unsupported' | 'unconfigured';

const tokensRef = (uid: string) => doc(db, 'pushTokens', uid);
const TOKEN_KEY = 'bobogram.pushToken';

export async function pushState(): Promise<PushState> {
  if (!vapidKey || !workerUrl) return 'unconfigured';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported().catch(() => false))) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && localStorage.getItem(TOKEN_KEY)) return 'on';
  return 'off';
}

async function registerToken(uid: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('no-token');
  const previous = localStorage.getItem(TOKEN_KEY);
  await setDoc(
    tokensRef(uid),
    { tokens: { [token]: Date.now(), ...(previous && previous !== token ? { [previous]: deleteField() } : {}) } },
    { merge: true },
  );
  localStorage.setItem(TOKEN_KEY, token);
}

/** Спрашивает разрешение и сохраняет токен этого устройства. Вызывать по нажатию кнопки (требование iOS). */
export async function enablePush(uid: string): Promise<PushState> {
  const state = await pushState();
  if (state === 'unconfigured' || state === 'unsupported' || state === 'denied') return state;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  await registerToken(uid);
  return 'on';
}

export async function disablePush(uid: string): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  if (token) await updateDoc(tokensRef(uid), { [`tokens.${token}`]: deleteField() }).catch(() => undefined);
}

/** Токен может смениться — обновляем его при каждом запуске, если пуши уже включены. */
export function usePushRegistration() {
  const uid = useApp((s) => s.user?.uid);
  useEffect(() => {
    if (!uid) return;
    void pushState().then((s) => {
      if (s === 'on') void registerToken(uid).catch(() => undefined);
    });
  }, [uid]);
}

async function callWorker(path: string, body: unknown): Promise<Response | null> {
  if (!workerUrl || !auth.currentUser) return null;
  const token = await auth.currentUser.getIdToken();
  return fetch(`${workerUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/**
 * Просит сервер разослать пуши. На бесплатном тарифе Cloudflare у Worker'а
 * ограничено число запросов, поэтому рассылка идёт частями: сервер говорит, сколько их.
 */
export async function notifyMessage(chatId: string, messageId: string): Promise<void> {
  try {
    const res = await callWorker('/notify', { chatId, messageId, part: 0 });
    if (!res?.ok) return;
    const { parts } = (await res.json()) as { parts?: number };
    for (let part = 1; part < (parts ?? 1); part++) {
      await callWorker('/notify', { chatId, messageId, part });
    }
  } catch {
    // пуши — «лучшее усилие», сообщение уже доставлено
  }
}

export async function notifyCall(callId: string): Promise<void> {
  try {
    await callWorker('/notify-call', { callId });
  } catch {
    // ignore
  }
}

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  const fallback: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  try {
    const res = await callWorker('/turn', {});
    if (!res?.ok) return fallback;
    const data = (await res.json()) as { iceServers?: RTCIceServer | RTCIceServer[] };
    const servers = data.iceServers;
    if (!servers) return fallback;
    return Array.isArray(servers) ? servers : [servers];
  } catch {
    return fallback;
  }
}
