import { useCallback, useEffect, useState } from 'react';
import { limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { chatRef, messagesCol, toChat, toMessage } from '../../firebase/db';
import type { Chat, Message } from '../../firebase/types';
import { savedChatId } from '../../lib/ids';

export type ChatStatus = 'loading' | 'ok' | 'virtual' | 'notfound' | 'denied';

/** Чат, которого ещё нет в базе (личка до первого сообщения или «Избранное»). */
function virtualChat(chatId: string, me: string): Chat | null {
  const base = {
    id: chatId,
    admins: [],
    ownerId: null,
    title: null,
    avatar: null,
    description: '',
    inviteCode: null,
    lastMessage: null,
    updatedAt: null,
    createdAt: null,
    pinnedMessageIds: [],
    readBy: {},
  };
  if (chatId === savedChatId(me)) return { ...base, type: 'saved', members: [me] };
  const m = chatId.match(/^([A-Za-z0-9]+)_([A-Za-z0-9]+)$/);
  if (m && m[1] < m[2] && (m[1] === me || m[2] === me) && m[1] !== m[2]) {
    return { ...base, type: 'private', members: [m[1], m[2]] };
  }
  return null;
}

export function useChat(chatId: string, me: string): { chat: Chat | null; status: ChatStatus } {
  const [state, setState] = useState<{ chat: Chat | null; status: ChatStatus }>({ chat: null, status: 'loading' });

  useEffect(
    () =>
      onSnapshot(
        chatRef(chatId),
        (snap) => {
          if (snap.exists()) {
            setState({ chat: toChat(snap), status: 'ok' });
            return;
          }
          // Из локального кэша «нет документа» может прийти раньше сервера — ждём ответа сервера.
          if (snap.metadata.fromCache) return;
          const v = virtualChat(chatId, me);
          setState({ chat: v, status: v ? 'virtual' : 'notfound' });
        },
        (err) => setState({ chat: null, status: err.code === 'permission-denied' ? 'denied' : 'notfound' }),
      ),
    [chatId, me],
  );

  // Офлайн: если сервер недоступен, всё равно даём открыть «виртуальный» чат.
  useEffect(() => {
    if (state.status !== 'loading') return;
    const timer = window.setTimeout(() => {
      setState((s) => {
        if (s.status !== 'loading') return s;
        const v = virtualChat(chatId, me);
        return v ? { chat: v, status: 'virtual' } : s;
      });
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [state.status, chatId, me]);

  return state;
}

export const PAGE_SIZE = 50;

export function useMessages(chatId: string, enabled: boolean) {
  const [limitN, setLimitN] = useState(PAGE_SIZE);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ messages: Message[]; hasMore: boolean; loaded: boolean }>({
    messages: [],
    hasMore: false,
    loaded: false,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ messages: [], hasMore: false, loaded: true });
      return;
    }
    return onSnapshot(
      query(messagesCol(chatId), orderBy('createdAt', 'desc'), limit(limitN)),
      { includeMetadataChanges: true },
      (snap) => {
        setState({
          messages: snap.docs.map(toMessage).reverse(),
          hasMore: snap.size >= limitN,
          loaded: true,
        });
      },
      () => {
        setState((s) => ({ ...s, loaded: true }));
        // Чат только что создан и ещё не дошёл до сервера — правила пока не пускают. Пробуем снова.
        if (retry < 8) window.setTimeout(() => setRetry((r) => r + 1), 500 * 2 ** Math.min(retry, 4));
      },
    );
  }, [chatId, limitN, enabled, retry]);

  const loadMore = useCallback((n = PAGE_SIZE) => setLimitN((x) => x + n), []);
  return { ...state, loadMore };
}
