import i18n from '../i18n';
import { errorKey, fetchMessage, sendMessageNow, toMessage, type OutgoingMessage } from '../supabase/api';
import type { MediaInfo, Message } from '../supabase/types';
import { primeMediaUrl, uploadMedia } from '../supabase/media';
import { emitLocalMessage } from './messageEvents';
import { useApp } from './store';

let flushing = false;

function isNetworkError(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? '';
  return err instanceof TypeError || /fetch|network|Failed to fetch|Load failed/i.test(msg);
}

/** Ставит сообщение в очередь: в чате оно появится сразу, с «часиками», и уйдёт, когда будет сеть. */
export function queueMessage(m: OutgoingMessage, me: string, extra?: Partial<Message>) {
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
    media: m.media ?? null,
    topicId: m.topicId ?? null,
    pending: true,
    ...extra,
  };
  useApp.setState((s) => ({ outbox: [...s.outbox, msg] }));
  void flushOutbox();
}

/** Файлы, которые ещё не загружены: живут только в памяти (в localStorage не попадают). */
const pendingFiles = new Map<string, Blob>();

async function upload(msg: Message) {
  const file = pendingFiles.get(msg.id);
  if (!file || !msg.media) return;
  try {
    await uploadMedia(msg.media.path, file, msg.media.mime ?? file.type);
    pendingFiles.delete(msg.id);
    useApp.setState((s) => ({
      outbox: s.outbox.map((m) => (m.id === msg.id ? { ...m, uploading: false } : m)),
    }));
    void flushOutbox();
  } catch (err) {
    useApp.setState((s) => ({ outbox: s.outbox.map((m) => (m.id === msg.id ? { ...m, failed: true } : m)) }));
    useApp.getState().showToast(i18n.t(isNetworkError(err) ? 'errors.network' : 'errors.upload'));
  }
}

/** Фото или голосовое: сразу видно в чате, файл грузится, затем уходит сообщение. */
export function queueMedia(
  m: Omit<OutgoingMessage, 'media'> & { media: Omit<MediaInfo, 'path'> },
  file: Blob,
  ext: string,
  me: string,
) {
  const media: MediaInfo = { ...m.media, path: `${me}/${crypto.randomUUID()}.${ext}`, size: file.size };
  const localUrl = URL.createObjectURL(file);
  primeMediaUrl(media.path, localUrl);
  pendingFiles.set(m.id, file);
  queueMessage({ ...m, media }, me, { uploading: true, localUrl });
  const msg = useApp.getState().outbox.find((x) => x.id === m.id);
  if (msg) void upload(msg);
}

export function discardFailed(id: string) {
  pendingFiles.delete(id);
  useApp.setState((s) => ({ outbox: s.outbox.filter((m) => m.id !== id) }));
}

export function retryFailed(id: string) {
  const msg = useApp.getState().outbox.find((m) => m.id === id);
  if (msg?.uploading && !pendingFiles.has(id)) {
    // Файл потерялся (перезагрузили страницу) — отправить нечего.
    discardFailed(id);
    return;
  }
  useApp.setState((s) => ({ outbox: s.outbox.map((m) => (m.id === id ? { ...m, failed: false } : m)) }));
  if (msg?.uploading) void upload(msg);
  else void flushOutbox();
}

export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const next = useApp.getState().outbox.find((m) => !m.failed && !m.uploading);
      if (!next) break;
      try {
        await sendMessageNow({
          id: next.id,
          chatId: next.chatId,
          text: next.text,
          replyTo: next.replyTo,
          forwardedFrom: next.forwardedFrom,
          call: next.call,
          media: next.media,
          topicId: next.topicId,
        });
        // Показываем настоящее сообщение с сервера сразу, не дожидаясь realtime.
        const saved = await fetchMessage(next.id).catch(() => null);
        if (saved) emitLocalMessage(saved);
        useApp.setState((s) => ({ outbox: s.outbox.filter((m) => m.id !== next.id) }));
      } catch (err) {
        if (isNetworkError(err)) break; // подождём сеть
        useApp.setState((s) => ({
          outbox: s.outbox.map((m) => (m.id === next.id ? { ...m, failed: true } : m)),
        }));
        useApp.getState().showToast(i18n.t(errorKey(err)));
      }
    }
  } finally {
    flushing = false;
  }
}

export { toMessage };
