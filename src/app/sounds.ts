import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useApp } from './store';
import { toMillis } from '../lib/time';

let ctx: AudioContext | null = null;

/** Короткий сигнал без аудиофайлов (WebAudio). */
export function beep(kind: 'message' | 'ring' = 'message') {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const notes = kind === 'message' ? [880, 1320] : [440, 554, 440, 554];
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * (kind === 'message' ? 0.09 : 0.25);
      const len = kind === 'message' ? 0.12 : 0.22;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + len);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + len + 0.02);
    });
  } catch {
    // звук необязателен
  }
}

export function isMuted(mutedUntil: number | null | undefined): boolean {
  return mutedUntil != null && (mutedUntil === -1 || mutedUntil > Date.now());
}

/** Звук и заголовок вкладки при новых сообщениях, пока приложение открыто. */
export function useIncomingSounds() {
  const chats = useApp((s) => s.chats);
  const prefs = useApp((s) => s.prefs);
  const sound = useApp((s) => s.sound);
  const me = useApp((s) => s.user?.uid);
  const location = useLocation();
  const seen = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    const first = seen.current === null;
    seen.current ??= new Map();
    let play = false;
    for (const chat of chats) {
      const last = chat.lastMessage;
      if (!last) continue;
      const prev = seen.current.get(chat.id);
      seen.current.set(chat.id, last.id);
      if (first || prev === last.id || last.senderId === me || last.system) continue;
      if (isMuted(prefs[chat.id]?.mutedUntil)) continue;
      const open = location.pathname === `/c/${chat.id}` && document.visibilityState === 'visible';
      if (!open && Date.now() - toMillis(last.createdAt) < 60_000) play = true;
    }
    if (play && sound) beep('message');
  }, [chats, prefs, sound, me, location.pathname]);

  // Счётчик непрочитанных чатов в заголовке вкладки.
  useEffect(() => {
    const unread = chats.filter(
      (c) =>
        c.lastMessage &&
        c.lastMessage.senderId !== me &&
        toMillis(c.lastMessage.createdAt) > toMillis(c.readBy[me ?? '']) &&
        !isMuted(prefs[c.id]?.mutedUntil),
    ).length;
    document.title = unread ? `(${unread}) Bobogram` : 'Bobogram';
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (unread) void nav.setAppBadge?.(unread).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  }, [chats, prefs, me]);
}
