import { useEffect, useSyncExternalStore } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { toProfile, userRef } from '../firebase/db';
import type { UserProfile } from '../firebase/types';
import { subscribePresence, type Presence } from '../firebase/rtdb';

/**
 * Общий кэш профилей: на каждого пользователя одна подписка Firestore,
 * сколько бы компонентов его ни показывали.
 */
type Entry<T> = { value: T | undefined; refs: number; unsub: (() => void) | null; listeners: Set<() => void> };

function createCache<T>(subscribe: (id: string, cb: (v: T) => void) => () => void) {
  const map = new Map<string, Entry<T>>();

  const entry = (id: string): Entry<T> => {
    let e = map.get(id);
    if (!e) {
      e = { value: undefined, refs: 0, unsub: null, listeners: new Set() };
      map.set(id, e);
    }
    return e;
  };

  const retain = (id: string) => {
    const e = entry(id);
    e.refs++;
    if (!e.unsub) {
      e.unsub = subscribe(id, (v) => {
        e.value = v;
        e.listeners.forEach((l) => l());
      });
    }
    return () => {
      e.refs--;
      // Отписываемся с задержкой: при переходах между экранами подписка часто нужна снова.
      window.setTimeout(() => {
        if (e.refs === 0 && e.unsub) {
          e.unsub();
          e.unsub = null;
        }
      }, 30_000);
    };
  };

  const useValue = (id: string | null | undefined): T | undefined => {
    const key = id ?? '';
    useEffect(() => (key ? retain(key) : undefined), [key]);
    return useSyncExternalStore(
      (l) => {
        if (!key) return () => undefined;
        const e = entry(key);
        e.listeners.add(l);
        return () => e.listeners.delete(l);
      },
      () => (key ? entry(key).value : undefined),
    );
  };

  const peek = (id: string) => map.get(id)?.value;
  return { useValue, peek, retain };
}

const profiles = createCache<UserProfile | null>((uid, cb) =>
  onSnapshot(
    userRef(uid),
    (snap) => cb(toProfile(snap)),
    () => cb(null),
  ),
);

const presences = createCache<Presence | null>((uid, cb) => subscribePresence(uid, cb));

/** undefined — загружается, null — нет такого пользователя. */
export const useProfile = profiles.useValue;
export const peekProfile = profiles.peek;
export const usePresence = presences.useValue;

export function displayNameOf(p: UserProfile | null | undefined, fallback = ''): string {
  if (p === null) return fallback;
  return p?.displayName || (p?.username ? '@' + p.username : fallback);
}
