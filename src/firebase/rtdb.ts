import {
  onDisconnect,
  onValue,
  ref,
  remove,
  serverTimestamp,
  set,
  type Unsubscribe,
} from 'firebase/database';
import { rtdb } from './init';

export interface Presence {
  online: boolean;
  lastSeen: number | null;
}

let serverOffset = 0;
onValue(ref(rtdb, '.info/serverTimeOffset'), (s) => {
  serverOffset = s.val() ?? 0;
});
export const serverNow = () => Date.now() + serverOffset;

/**
 * Держит статус «в сети», пока вкладка открыта и видна.
 * Если пользователь скрыл «был в сети», статус не публикуется вовсе.
 */
export function startPresence(uid: string, hidden: boolean): Unsubscribe {
  const statusRef = ref(rtdb, `status/${uid}`);
  if (hidden) {
    void remove(statusRef).catch(() => undefined);
    return () => undefined;
  }
  const offline = { online: false, lastSeen: serverTimestamp() };
  const online = { online: true, lastSeen: serverTimestamp() };

  const goOnline = () => {
    void onDisconnect(statusRef)
      .set(offline)
      .then(() => set(statusRef, online))
      .catch(() => undefined);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') goOnline();
    else void set(statusRef, offline).catch(() => undefined);
  };

  const unsubConnected = onValue(ref(rtdb, '.info/connected'), (snap) => {
    if (snap.val() === true && document.visibilityState === 'visible') goOnline();
  });
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    unsubConnected();
    document.removeEventListener('visibilitychange', onVisibility);
    void set(statusRef, offline).catch(() => undefined);
  };
}

export function subscribePresence(uid: string, cb: (p: Presence | null) => void): Unsubscribe {
  return onValue(
    ref(rtdb, `status/${uid}`),
    (snap) => {
      const v = snap.val();
      cb(v ? { online: v.online === true, lastSeen: v.lastSeen ?? null } : null);
    },
    () => cb(null),
  );
}

// ---------- «печатает…» ----------
const TYPING_TTL = 6000;

export function setTyping(chatId: string, uid: string, typing: boolean): void {
  const r = ref(rtdb, `typing/${chatId}/${uid}`);
  if (typing) {
    void set(r, serverTimestamp()).catch(() => undefined);
    void onDisconnect(r).remove().catch(() => undefined);
  } else {
    void remove(r).catch(() => undefined);
  }
}

/** Возвращает uid тех, кто печатает прямо сейчас (кроме меня). */
export function subscribeTyping(chatId: string, me: string, cb: (uids: string[]) => void): Unsubscribe {
  let latest: Record<string, number> = {};
  const emit = () => {
    const now = serverNow();
    cb(Object.entries(latest)
      .filter(([uid, ts]) => uid !== me && now - ts < TYPING_TTL)
      .map(([uid]) => uid));
  };
  const timer = window.setInterval(emit, 2000);
  const unsub = onValue(
    ref(rtdb, `typing/${chatId}`),
    (snap) => {
      latest = snap.val() ?? {};
      emit();
    },
    () => cb([]),
  );
  return () => {
    window.clearInterval(timer);
    unsub();
  };
}
