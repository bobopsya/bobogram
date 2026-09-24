import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';

const TOKEN = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])|(@[a-zA-Z][a-zA-Z0-9_]{3,31})/g;

/** Текст сообщения со ссылками и @упоминаниями. */
export function MessageText({ text, highlight }: { text: string; highlight?: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(mark(text.slice(last, i), highlight, parts.length));
    if (m[1]) {
      parts.push(
        <a key={parts.length} href={m[1]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          {m[1]}
        </a>,
      );
    } else {
      parts.push(
        <Link key={parts.length} to={`/u/${m[2].slice(1)}`} onClick={(e) => e.stopPropagation()}>
          {m[2]}
        </Link>,
      );
    }
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(mark(text.slice(last), highlight, parts.length));
  return <>{parts}</>;
}

function mark(s: string, q: string | undefined, key: number): ReactNode {
  if (!q) return <Fragment key={key}>{s}</Fragment>;
  const lower = s.toLowerCase();
  const out: ReactNode[] = [];
  let pos = 0;
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    if (idx > pos) out.push(s.slice(pos, idx));
    out.push(<mark key={idx}>{s.slice(idx, idx + q.length)}</mark>);
    pos = idx + q.length;
    idx = lower.indexOf(q, pos);
  }
  out.push(s.slice(pos));
  return <Fragment key={key}>{out}</Fragment>;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u;

/** 1–3 эмодзи без текста показываем крупно. */
export function isEmojiOnly(text: string): boolean {
  if (!text || text.length > 40 || !EMOJI_ONLY.test(text) || /^[\d#*\s]+$/.test(text)) return false;
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const count = Array.from(seg.segment(text.replace(/\s/g, ''))).length;
  return count > 0 && count <= 3;
}
