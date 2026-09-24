import { useEffect } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { onSnapshot, query, where, collection } from 'firebase/firestore';
import { auth, db } from '../firebase/init';
import { blocksRef, toChat, toPrefs, toProfile, userChatsCol, userRef } from '../firebase/db';
import type { Chat, UserChatPrefs } from '../firebase/types';
import { startPresence } from '../firebase/rtdb';
import { useApp } from './store';

/** Следит за входом, профилем, списком чатов и статусом «в сети». */
export function useSessionBootstrap() {
  const uid = useApp((s) => s.user?.uid);
  const verified = useApp((s) => s.emailVerified);
  const hideLastSeen = useApp((s) => s.profile?.hideLastSeen);
  const banned = useApp((s) => s.profile?.banned);
  const hasProfile = useApp((s) => !!s.profile);

  // Вход/выход и обновление токена (например, после подтверждения почты).
  useEffect(
    () =>
      onIdTokenChanged(auth, (user) => {
        useApp.setState((s) => ({
          authReady: true,
          user,
          emailVerified: user?.emailVerified ?? false,
          ...(user?.uid !== s.user?.uid
            ? { profile: undefined, chats: [], chatsLoaded: false, prefs: {}, blocked: [] }
            : {}),
        }));
      }),
    [],
  );

  // Сеть.
  useEffect(() => {
    const update = () => useApp.setState({ online: navigator.onLine });
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Собственный профиль.
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      userRef(uid),
      (snap) => useApp.setState({ profile: snap.exists() ? toProfile(snap) : null }),
      () => useApp.setState({ profile: null }),
    );
  }, [uid]);

  const ready = !!uid && verified && hasProfile && !banned;

  // Чаты, личные настройки и чёрный список.
  useEffect(() => {
    if (!ready || !uid) return;
    const unsubChats = onSnapshot(
      query(collection(db, 'chats'), where('members', 'array-contains', uid)),
      (snap) => {
        const chats = snap.docs.map((d) => toChat(d)).filter((c): c is Chat => c !== null);
        useApp.setState({ chats, chatsLoaded: true });
      },
      () => useApp.setState({ chatsLoaded: true }),
    );
    const unsubPrefs = onSnapshot(userChatsCol(uid), (snap) => {
      const prefs: Record<string, UserChatPrefs> = {};
      snap.docs.forEach((d) => (prefs[d.id] = toPrefs(d.data())));
      useApp.setState({ prefs });
    });
    const unsubBlocks = onSnapshot(blocksRef(uid), (snap) =>
      useApp.setState({ blocked: (snap.data()?.list as string[] | undefined) ?? [] }),
    );
    return () => {
      unsubChats();
      unsubPrefs();
      unsubBlocks();
    };
  }, [ready, uid]);

  // Статус «в сети».
  useEffect(() => {
    if (!ready || !uid || hideLastSeen === undefined) return;
    return startPresence(uid, hideLastSeen);
  }, [ready, uid, hideLastSeen]);
}
