import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useApp } from './store';

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

/** Звук и заголовок вкладки при новых сообщениях, пока приложение открыто. */
export function useIncomingSounds() {
  const chats = useApp((s) => s.chats);
  const sound = useApp((s) => s.sound);
  const me = useApp((s) => s.userId);
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
      if (first || prev === last.id || last.senderId === me || last.system || chat.muted) continue;
      const open = location.pathname === `/c/${chat.id}` && document.visibilityState === 'visible';
      if (!open && Date.now() - last.createdAt < 60_000) play = true;
    }
    if (play && sound) beep('message');
  }, [chats, sound, me, location.pathname]);

  // Число чатов с непрочитанными — в заголовке вкладки и на иконке приложения.
  useEffect(() => {
    const unread = chats.filter((c) => c.unread > 0 && !c.muted).length;
    document.title = unread ? `(${unread}) Bobogram` : 'Bobogram';
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (unread) void nav.setAppBadge?.(unread).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  }, [chats]);
}
