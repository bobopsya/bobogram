import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchChats,
  fetchMessages,
  keepUnchanged,
  MESSAGE_LARGE_FIELDS,
  PAGE_SIZE,
  toMessage,
} from '../../supabase/api';
import { normalizeMessage, type Chat, type Message } from '../../supabase/types';
import { onDbEvent, onResync } from '../../supabase/realtime';
import { onLocalMessage } from '../../app/messageEvents';
import { useApp, useChatById, write } from '../../app/store';

export type ChatStatus = 'loading' | 'ok' | 'notfound';

/** Чат из списка; если его там нет (админ смотрит чужую группу) — запрашиваем отдельно. */
export function useChat(chatId: string): { chat: Chat | null; status: ChatStatus } {
  const fromList = useChatById(chatId);
  const chatsLoaded = useApp((s) => s.chatsLoaded);
  const [extra, setExtra] = useState<{ chat: Chat | null; status: ChatStatus }>({
    chat: null,
    status: 'loading',
  });

  useEffect(() => {
    if (fromList || !chatsLoaded) return;
    let cancelled = false;
    const load = () =>
      fetchChats(chatId)
        .then(([c]) => !cancelled && setExtra({ chat: c ?? null, status: c ? 'ok' : 'notfound' }))
        .catch(() => !cancelled && setExtra({ chat: null, status: 'notfound' }));
    void load();
    const off = onDbEvent((e) => {
      if (e.table === 'chats' && (e.row.id === chatId || e.old.id === chatId)) void load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [chatId, fromList, chatsLoaded]);

  if (fromList) return { chat: fromList, status: 'ok' };
  return extra;
}

const cacheKey = (chatId: string, topic?: string | null) =>
  topic === undefined ? `bobogram.msgs.${chatId}` : `bobogram.msgs.${chatId}.${topic ?? 'general'}`;

function readCache(chatId: string, topic?: string | null): Message[] {
  try {
    return (JSON.parse(localStorage.getItem(cacheKey(chatId, topic)) ?? '[]') as Message[]).map(
      normalizeMessage,
    );
  } catch {
    return [];
  }
}

function mergeInto(list: Message[], incoming: Message[]): Message[] {
  const map = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Сообщения чата: сразу показываем кэш, потом свежие с сервера; новые приходят через realtime.
 * Неотправленные из офлайн-очереди подмешиваются в конец с «часиками».
 * topic: undefined — весь чат, null — «Общее» группы с темами, id — одна тема.
 */
export function useMessages(chatId: string, topic?: string | null) {
  const [messages, setMessages] = useState<Message[]>(() => readCache(chatId, topic));
  const inTopic = useCallback(
    (t: unknown) => topic === undefined || ((t as string | null | undefined) ?? null) === topic,
    [topic],
  );
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const loadingOlder = useRef(false);
  const outbox = useApp((s) => s.outbox);

  const loadLatest = useCallback(async () => {
    try {
      const latest = await fetchMessages(chatId, undefined, PAGE_SIZE, topic);
      setMessages((prev) => {
        // Всё, что старее загруженной страницы, оставляем как есть (подгруженную историю).
        const oldest = latest[0]?.createdAt ?? Infinity;
        return mergeInto(
          prev.filter((m) => m.createdAt < oldest),
          latest,
        );
      });
      setHasMore(latest.length >= PAGE_SIZE);
    } catch {
      // офлайн — остаёмся с кэшем
    } finally {
      setLoaded(true);
    }
  }, [chatId, topic]);

  useEffect(() => {
    void loadLatest();
    const offDb = onDbEvent((e) => {
      if (e.table === 'messages' && e.row.chat_id === chatId && inTopic(e.row.topic_id)) {
        setMessages((prev) => {
          const old = prev.find((m) => m.id === e.row.id);
          // Изменилось сообщение, которого нет на экране, и текст не пришёл — не показываем пустышку.
          if (!old && !('text' in e.row)) return prev;
          return mergeInto(prev, [keepUnchanged(toMessage(e.row), old, e.row, MESSAGE_LARGE_FIELDS)]);
        });
      }
    });
    const offLocal = onLocalMessage(
      (m) => m.chatId === chatId && inTopic(m.topicId) && setMessages((prev) => mergeInto(prev, [m])),
    );
    const offResync = onResync(() => void loadLatest());
    return () => {
      offDb();
      offLocal();
      offResync();
    };
  }, [chatId, loadLatest, inTopic]);

  // Кэш последних сообщений для работы без сети.
  useEffect(() => {
    if (loaded) write(cacheKey(chatId, topic), messages.slice(-PAGE_SIZE));
  }, [chatId, topic, messages, loaded]);

  const loadMore = useCallback(
    async (count = PAGE_SIZE) => {
      if (loadingOlder.current) return;
      loadingOlder.current = true;
      try {
        const oldest = messages[0]?.createdAt;
        const older = await fetchMessages(chatId, oldest, count, topic);
        setMessages((prev) => mergeInto(prev, older));
        setHasMore(older.length >= count);
      } catch {
        // ignore
      } finally {
        loadingOlder.current = false;
      }
    },
    [chatId, topic, messages],
  );

  const all = useMemo(() => {
    const serverIds = new Set(messages.map((m) => m.id));
    const pending = outbox.filter((m) => m.chatId === chatId && inTopic(m.topicId) && !serverIds.has(m.id));
    return pending.length ? [...messages, ...pending] : messages;
  }, [messages, outbox, chatId, inTopic]);

  return { messages: all, hasMore, loaded, loadMore };
}
