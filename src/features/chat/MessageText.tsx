import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { parseMarkup, TEXT_EFFECTS, type MarkNode } from '../../lib/markup';
import { NAME_COLORS, nameColorStyle } from '../../app/themes';
import { Link } from 'react-router';
import { useApp } from '../../app/store';

const STYLES: ReadonlySet<string> = new Set([...NAME_COLORS.map((c) => c.id), ...TEXT_EFFECTS]);

/** Текст сообщения с разметкой, ссылками и @упоминаниями; highlight — подсветка поиска. */
export function MessageText({ text, highlight }: { text: string; highlight?: string }) {
  const nodes = useMemo(() => parseMarkup(text, STYLES), [text]);
  const me = useApp((s) => s.profile?.username.toLowerCase());
  return <>{render(nodes, highlight, me)}</>;
}

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={open ? 'md-spoiler open' : 'md-spoiler'}
      onClick={(e) => {
        if (open) return;
        e.stopPropagation();
        setOpen(true);
      }}
    >
      {children}
    </span>
  );
}

function render(nodes: MarkNode[], q: string | undefined, me?: string): ReactNode[] {
  return nodes.map((n, key) => {
    switch (n.t) {
      case 'text':
        return mark(n.v, q, key);
      case 'br':
        return <br key={key} />;
      case 'b':
        return <strong key={key}>{render(n.c, q, me)}</strong>;
      case 'i':
        return <em key={key}>{render(n.c, q, me)}</em>;
      case 's':
        return <s key={key}>{render(n.c, q, me)}</s>;
      case 'u':
        return <u key={key}>{render(n.c, q, me)}</u>;
      case 'spoiler':
        return <Spoiler key={key}>{render(n.c, q, me)}</Spoiler>;
      case 'code':
        return (
          <code key={key} className="md-code">
            {n.v}
          </code>
        );
      case 'pre':
        return (
          <pre key={key} className="md-pre">
            {n.v}
          </pre>
        );
      case 'quote':
        return (
          <blockquote key={key} className="md-quote">
            {render(n.c, q, me)}
          </blockquote>
        );
      case 'link':
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {render(n.c, q, me)}
          </a>
        );
      case 'url':
        return (
          <a
            key={key}
            href={n.v}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {n.v}
          </a>
        );
      case 'mention':
        return (
          <Link
            key={key}
            to={`/u/${n.v.slice(1)}`}
            className={n.v.slice(1).toLowerCase() === me ? 'md-mention me' : 'md-mention'}
            onClick={(e) => e.stopPropagation()}
          >
            {n.v}
          </Link>
        );
      case 'style':
        return (TEXT_EFFECTS as readonly string[]).includes(n.style) ? (
          <span key={key} className={`md-${n.style}`}>
            {render(n.c, q, me)}
          </span>
        ) : (
          <span key={key} className="md-color" style={nameColorStyle(n.style)}>
            {render(n.c, q, me)}
          </span>
        );
    }
  });
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
