import { useEffect, useSyncExternalStore } from 'react';
import { fetchProfiles, keepUnchanged, PROFILE_LARGE_FIELDS, toProfile } from '../supabase/api';
import type { UserProfile } from '../supabase/types';
import { getOnline, onDbEvent, onOnlineChange } from '../supabase/realtime';

/**
 * Общий кэш профилей. Профили запрашиваются пачками, обновления приходят через realtime.
 */
const cache = new Map<string, UserProfile | null>();
const listeners = new Map<string, Set<() => void>>();
let queue = new Set<string>();
let flushTimer: number | undefined;

function notify(uid: string) {
  listeners.get(uid)?.forEach((l) => l());
}

export function putProfile(p: UserProfile) {
  cache.set(p.uid, p);
  notify(p.uid);
}

function request(uid: string) {
  if (cache.has(uid) || queue.has(uid)) return;
  queue.add(uid);
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(async () => {
    const ids = [...queue];
    queue = new Set();
    try {
      const found = await fetchProfiles(ids);
      const got = new Set(found.map((p) => p.uid));
      found.forEach(putProfile);
      ids
        .filter((id) => !got.has(id))
        .forEach((id) => {
          cache.set(id, null);
          notify(id);
        });
    } catch {
      // нет сети — попробуем при следующем обращении
    }
  }, 20);
}

function refresh(uid: string) {
  void fetchProfiles([uid])
    .then((list) => list.forEach(putProfile))
    .catch(() => undefined);
}

onDbEvent((e) => {
  if (e.table === 'nft_usernames') {
    // При удалении приходит только имя — ищем владельца в кэше.
    const owner =
      (e.row.owner_id as string | undefined) ??
      [...cache.values()].find((p) => p?.nftUsernames.includes(String(e.old.username)))?.uid;
    if (owner && cache.has(owner)) refresh(owner);
    return;
  }
  if (e.table !== 'profiles' || e.type === 'DELETE') return;
  const fresh = toProfile(e.row);
  putProfile(keepUnchanged(fresh, cache.get(fresh.uid) ?? undefined, e.row, PROFILE_LARGE_FIELDS));
});

/** undefined — загружается, null — нет такого пользователя. */
export function useProfile(uid: string | null | undefined): UserProfile | null | undefined {
  const key = uid ?? '';
  useEffect(() => {
    if (key) request(key);
  }, [key]);
  return useSyncExternalStore(
    (l) => {
      if (!key) return () => undefined;
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(l);
      return () => set.delete(l);
    },
    () => (key ? cache.get(key) : undefined),
  );
}

/**
 * Подписка на несколько профилей сразу — для текстов вроде «Аня добавила Борю», которые
 * читают кэш через peekProfile: без неё имя оставалось «…», пока что-то не перерисует экран.
 */
export function useProfilesLoaded(uids: string[]): void {
  const key = uids.join(',');
  useEffect(() => {
    if (key) key.split(',').forEach(request);
  }, [key]);
  useSyncExternalStore(
    (l) => {
      if (!key) return () => undefined;
      const sets = key.split(',').map((uid) => {
        let set = listeners.get(uid);
        if (!set) listeners.set(uid, (set = new Set()));
        set.add(l);
        return set;
      });
      return () => sets.forEach((set) => set.delete(l));
    },
    () =>
      key
        ? key
            .split(',')
            .map((uid) => (cache.has(uid) ? (cache.get(uid)?.displayName ?? '-') : '?'))
            .join('|')
        : '',
  );
}

/** Все пользователи, упомянутые в системном событии (кто сделал и кого добавили/удалили). */
export function systemUids(
  ev: { kind: string; uids?: string[]; uid?: string } | null | undefined,
  senderId: string,
): string[] {
  if (!ev) return [];
  return [senderId, ...(ev.uids ?? []), ...(ev.uid ? [ev.uid] : [])];
}

export function peekProfile(uid: string): UserProfile | null | undefined {
  if (!cache.has(uid)) request(uid);
  return cache.get(uid);
}

export interface Presence {
  online: boolean;
  lastSeen: number | null;
  hidden: boolean;
  bot: boolean;
}

function subscribeOnline(l: () => void) {
  return onOnlineChange(() => l());
}

/** Статус «в сети»: из канала присутствия + время последнего визита из профиля. */
export function usePresence(uid: string | null | undefined): Presence | null {
  const profile = useProfile(uid);
  const online = useSyncExternalStore(subscribeOnline, () => (uid ? getOnline().has(uid) : false));
  if (!uid || !profile) return null;
  return { online, lastSeen: profile.lastSeen, hidden: profile.hideLastSeen, bot: !!profile.isBot };
}

export function displayNameOf(p: UserProfile | null | undefined, fallback = ''): string {
  if (p === null) return fallback;
  return p?.displayName || (p?.username ? '@' + p.username : fallback);
}
