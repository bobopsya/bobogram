import { useEffect } from 'react';
import { supabase } from '../supabase/client';
import { fetchBlocked, fetchChats, fetchProfiles, touchLastSeen } from '../supabase/api';
import { emitResync, onDbEvent, onResync, startDbChannel, startPresence } from '../supabase/realtime';
import { putProfile } from './profiles';
import { flushOutbox } from './outbox';
import { useApp } from './store';

let refreshTimer: number | undefined;

/** Перечитывает список чатов (с задержкой, чтобы пачка событий дала один запрос). */
export function refreshChats(delay = 250) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(async () => {
    try {
      const chats = await fetchChats();
      useApp.setState({ chats, chatsLoaded: true });
    } catch {
      useApp.setState({ chatsLoaded: true });
    }
  }, delay);
}

export async function refreshBlocked() {
  try {
    useApp.setState({ blocked: await fetchBlocked() });
  } catch {
    // ignore
  }
}

/** Следит за входом, профилем, списком чатов, статусом «в сети» и офлайн-очередью. */
export function useSessionBootstrap() {
  const uid = useApp((s) => s.userId);
  const hideLastSeen = useApp((s) => s.profile?.hideLastSeen);
  const banned = useApp((s) => s.profile?.banned);
  const hasProfile = useApp((s) => !!s.profile);

  // Вход и выход.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user.id ?? null;
      useApp.setState((s) => (s.userId === id ? { authReady: true } : { authReady: true, userId: id }));
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      useApp.setState((s) =>
        s.userId === id
          ? { authReady: true }
          : s.userId === null && id
            ? { authReady: true, userId: id } // запуск приложения: кэш чатов и очередь сохраняем
            : {
                authReady: true,
                userId: id,
                profile: undefined,
                chats: [],
                chatsLoaded: false,
                blocked: [],
                outbox: [],
              },
      );
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Сеть: при появлении — отправить очередь и перечитать пропущенное.
  useEffect(() => {
    const update = () => {
      useApp.setState({ online: navigator.onLine });
      if (navigator.onLine) {
        void flushOutbox();
        emitResync();
      }
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const retry = window.setInterval(() => navigator.onLine && void flushOutbox(), 15_000);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.clearInterval(retry);
    };
  }, []);

  // Свой профиль.
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    const load = () =>
      fetchProfiles([uid])
        .then(([p]) => {
          if (cancelled) return;
          if (p) putProfile(p);
          useApp.setState({ profile: p ?? null });
        })
        .catch(() => {
          // офлайн: пускаем с последним известным профилем
          const cached = localStorage.getItem('bobogram.profile');
          if (!cancelled && cached) useApp.setState({ profile: { nftUsernames: [], ...JSON.parse(cached) } });
        });
    void load();
    const off = onDbEvent((e) => {
      if (e.table === 'profiles' && e.row.id === uid) void load();
      // НФТ-имя выдали или отозвали (при отзыве владелец неизвестен — перечитываем).
      if (e.table === 'nft_usernames' && (e.row.owner_id === uid || e.type === 'DELETE')) void load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [uid]);

  const profile = useApp((s) => s.profile);
  useEffect(() => {
    if (profile) localStorage.setItem('bobogram.profile', JSON.stringify(profile));
  }, [profile]);

  const ready = !!uid && hasProfile && !banned;

  // Realtime, чаты, чёрный список.
  useEffect(() => {
    if (!ready) return;
    const stop = startDbChannel();
    refreshChats(0);
    void refreshBlocked();
    void flushOutbox();
    const off = onDbEvent((e) => {
      if (e.table === 'messages' || e.table === 'chats' || e.table === 'chat_members') refreshChats();
    });
    const offResync = onResync(() => refreshChats(0));
    const onVisible = () => document.visibilityState === 'visible' && refreshChats(0);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop();
      off();
      offResync();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready]);

  // «В сети» и «был(а) в сети».
  useEffect(() => {
    if (!ready || !uid || hideLastSeen === undefined) return;
    const stop = startPresence(uid, hideLastSeen);
    if (hideLastSeen) return stop;
    const touch = () => void touchLastSeen(uid).catch(() => undefined);
    touch();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && touch(), 60_000);
    document.addEventListener('visibilitychange', touch);
    return () => {
      stop();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', touch);
    };
  }, [ready, uid, hideLastSeen]);
}
