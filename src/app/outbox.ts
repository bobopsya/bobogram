import i18n from '../i18n';
import { errorKey, fetchMessage, sendMessageNow, toMessage, type OutgoingMessage } from '../supabase/api';
import type { Message } from '../supabase/types';
import { emitLocalMessage } from './messageEvents';
import { useApp } from './store';

let flushing = false;

function isNetworkError(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? '';
  return err instanceof TypeError || /fetch|network|Failed to fetch|Load failed/i.test(msg);
}

/** Ставит сообщение в очередь: в чате оно появится сразу, с «часиками», и уйдёт, когда будет сеть. */
export function queueMessage(m: OutgoingMessage, me: string) {
  const msg: Message = {
    id: m.id,
    chatId: m.chatId,
    senderId: me,
    text: m.text,
    createdAt: Date.now(),
    editedAt: null,
    deleted: false,
    deletedFor: [],
    replyTo: m.replyTo ?? null,
    forwardedFrom: m.forwardedFrom ?? null,
    reactions: {},
    system: null,
    call: m.call ?? null,
    views: 0,
    boostViews: 0,
    boostReactions: {},
    pending: true,
  };
  useApp.setState((s) => ({ outbox: [...s.outbox, msg] }));
  void flushOutbox();
}

export function discardFailed(id: string) {
  useApp.setState((s) => ({ outbox: s.outbox.filter((m) => m.id !== id) }));
}

export function retryFailed(id: string) {
  useApp.setState((s) => ({ outbox: s.outbox.map((m) => (m.id === id ? { ...m, failed: false } : m)) }));
  void flushOutbox();
}

export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const next = useApp.getState().outbox.find((m) => !m.failed);
      if (!next) break;
      try {
        await sendMessageNow({
          id: next.id,
          chatId: next.chatId,
          text: next.text,
          replyTo: next.replyTo,
          forwardedFrom: next.forwardedFrom,
          call: next.call,
        });
        // Показываем настоящее сообщение с сервера сразу, не дожидаясь realtime.
        const saved = await fetchMessage(next.id).catch(() => null);
        if (saved) emitLocalMessage(saved);
        useApp.setState((s) => ({ outbox: s.outbox.filter((m) => m.id !== next.id) }));
      } catch (err) {
        if (isNetworkError(err)) break; // подождём сеть
        useApp.setState((s) => ({ outbox: s.outbox.map((m) => (m.id === next.id ? { ...m, failed: true } : m)) }));
        useApp.getState().showToast(i18n.t(errorKey(err)));
      }
    }
  } finally {
    flushing = false;
  }
}

export { toMessage };
