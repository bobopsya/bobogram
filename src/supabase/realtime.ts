import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './client';

/**
 * Одна подписка на изменения в базе для всего приложения.
 * Supabase сам отфильтрует строки по правилам доступа: придут только мои чаты, сообщения и звонки.
 */
export type DbEvent = {
  table: 'messages' | 'chats' | 'chat_members' | 'profiles' | 'calls' | 'call_candidates' | 'nft_usernames';
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  row: Record<string, unknown>;
  old: Record<string, unknown>;
};

type Listener = (e: DbEvent) => void;
const listeners = new Set<Listener>();
const resyncListeners = new Set<() => void>();

export function onDbEvent(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Вызывается после переподключения: всё, что пропустили, нужно перечитать. */
export function onResync(l: () => void): () => void {
  resyncListeners.add(l);
  return () => resyncListeners.delete(l);
}

export function emitResync() {
  resyncListeners.forEach((l) => l());
}

let dbChannel: RealtimeChannel | null = null;

export function startDbChannel(): () => void {
  const tables: DbEvent['table'][] = [
    'messages',
    'chats',
    'chat_members',
    'profiles',
    'calls',
    'call_candidates',
    'nft_usernames',
  ];
  let ch = supabase.channel('db-changes');
  for (const table of tables) {
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      const e: DbEvent = {
        table,
        type: payload.eventType,
        row: (payload.new ?? {}) as Record<string, unknown>,
        old: (payload.old ?? {}) as Record<string, unknown>,
      };
      listeners.forEach((l) => l(e));
    });
  }
  let wasSubscribed = false;
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      if (wasSubscribed) emitResync();
      wasSubscribed = true;
    }
  });
  dbChannel = ch;
  return () => {
    void supabase.removeChannel(ch);
    if (dbChannel === ch) dbChannel = null;
  };
}

// ---------- «в сети» ----------
type OnlineListener = (online: Set<string>) => void;
const onlineListeners = new Set<OnlineListener>();
let online = new Set<string>();

export function onOnlineChange(l: OnlineListener): () => void {
  onlineListeners.add(l);
  l(online);
  return () => onlineListeners.delete(l);
}

export function getOnline() {
  return online;
}

/** Общий канал присутствия. Если пользователь скрыл статус, он только смотрит, но не отмечается. */
export function startPresence(uid: string, hidden: boolean): () => void {
  const ch = supabase.channel('online', { config: { presence: { key: uid } } });
  const update = () => {
    online = new Set(Object.keys(ch.presenceState()));
    onlineListeners.forEach((l) => l(online));
  };
  ch.on('presence', { event: 'sync' }, update);

  const track = () => {
    if (hidden) return;
    if (document.visibilityState === 'visible') void ch.track({ at: Date.now() });
    else void ch.untrack();
  };
  ch.subscribe((status) => status === 'SUBSCRIBED' && track());
  document.addEventListener('visibilitychange', track);
  return () => {
    document.removeEventListener('visibilitychange', track);
    void supabase.removeChannel(ch);
    online = new Set();
    onlineListeners.forEach((l) => l(online));
  };
}

// ---------- «печатает…» ----------
const typingChannels = new Map<
  string,
  { ch: RealtimeChannel; refs: number; listeners: Set<(uid: string, stop: boolean) => void> }
>();

function typingChannel(chatId: string) {
  let entry = typingChannels.get(chatId);
  if (!entry) {
    const listeners = new Set<(uid: string, stop: boolean) => void>();
    const ch = supabase.channel(`typing:${chatId}`, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const { uid, stop } = payload as { uid?: string; stop?: boolean };
      if (uid) listeners.forEach((l) => l(uid, stop === true));
    });
    ch.subscribe();
    entry = { ch, refs: 0, listeners };
    typingChannels.set(chatId, entry);
  }
  entry.refs++;
  const e = entry;
  return {
    ch: e.ch,
    listeners: e.listeners,
    release: () => {
      e.refs--;
      if (e.refs === 0) {
        void supabase.removeChannel(e.ch);
        typingChannels.delete(chatId);
      }
    },
  };
}

export function sendTyping(chatId: string, uid: string, stop = false) {
  const t = typingChannel(chatId);
  void t.ch.send({ type: 'broadcast', event: 'typing', payload: { uid, stop } });
  // Канал держим ещё немного, чтобы не переподключаться на каждую букву.
  window.setTimeout(t.release, 10_000);
}

/** Кто печатает прямо сейчас (события старше 5 секунд забываются). */
export function subscribeTyping(chatId: string, cb: (uids: string[]) => void): () => void {
  const t = typingChannel(chatId);
  const last = new Map<string, number>();
  const emit = () => {
    const now = Date.now();
    for (const [uid, at] of last) if (now - at > 5000) last.delete(uid);
    cb([...last.keys()]);
  };
  const onTyping = (uid: string, stop: boolean) => {
    if (stop) last.delete(uid);
    else last.set(uid, Date.now());
    emit();
  };
  t.listeners.add(onTyping);
  const timer = window.setInterval(emit, 1500);
  return () => {
    window.clearInterval(timer);
    t.listeners.delete(onTyping);
    t.release();
  };
}
