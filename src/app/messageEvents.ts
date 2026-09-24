import type { Message } from '../supabase/types';

/** Сообщения, полученные не через realtime (например, сразу после отправки). */
type Listener = (m: Message) => void;
const listeners = new Set<Listener>();

export function onLocalMessage(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function emitLocalMessage(m: Message) {
  listeners.forEach((l) => l(m));
}
