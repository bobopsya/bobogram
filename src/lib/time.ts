import type { Timestamp } from 'firebase/firestore';

export function toDate(ts: Timestamp | Date | number | null | undefined): Date | null {
  if (ts == null) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts === 'number') return new Date(ts);
  return ts.toDate();
}

export function toMillis(ts: Timestamp | Date | number | null | undefined): number {
  return toDate(ts)?.getTime() ?? 0;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 14:05 */
export function formatTime(date: Date, locale: string): string {
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** Время для списка чатов: сегодня — часы, на этой неделе — день недели, иначе дата. */
export function formatChatListTime(date: Date, locale: string, now = new Date()): string {
  if (isSameDay(date, now)) return formatTime(date, locale);
  const diffDays = (now.getTime() - date.getTime()) / 86_400_000;
  if (diffDays < 7) return date.toLocaleDateString(locale, { weekday: 'short' });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  }
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'numeric', year: '2-digit' });
}

export type DayLabel = { kind: 'today' } | { kind: 'yesterday' } | { kind: 'date'; text: string };

export function dayLabel(date: Date, locale: string, now = new Date()): DayLabel {
  if (isSameDay(date, now)) return { kind: 'today' };
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return { kind: 'yesterday' };
  const sameYear = date.getFullYear() === now.getFullYear();
  return {
    kind: 'date',
    text: date.toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'long' } : { dateStyle: 'long' }),
  };
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const h = Math.floor(m / 60);
  const mm = h ? String(m % 60).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * Статус «прочитано»: сообщение прочитано, если хоть один другой участник
 * отметил прочитанным момент не раньше времени сообщения.
 */
export function isReadByOthers(
  createdAt: number,
  readBy: Record<string, Timestamp | null>,
  me: string,
): boolean {
  if (!createdAt) return false;
  return Object.entries(readBy).some(([uid, ts]) => uid !== me && toMillis(ts) >= createdAt);
}
