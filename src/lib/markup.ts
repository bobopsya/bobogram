/**
 * Разметка сообщений (как в Telegram, но текстом):
 *   **жирный**  __курсив__  ~~зачёркнутый~~  --подчёркнутый--  `код`  ```блок кода```
 *   ||спойлер||  > цитата  [текст](https://ссылка)
 * Премиум: {red|цветной}, {fire|градиент}, {big|крупный}, {small|мелкий}, {wave|анимированный}.
 * Разбирается в дерево; отрисовка — в MessageText, превью и пуши — через stripMarkup.
 */

export type MarkNode =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'b' | 'i' | 's' | 'u' | 'spoiler'; c: MarkNode[] }
  | { t: 'code'; v: string }
  | { t: 'pre'; v: string }
  | { t: 'quote'; c: MarkNode[] }
  | { t: 'link'; href: string; c: MarkNode[] }
  | { t: 'url'; v: string }
  | { t: 'mention'; v: string }
  | { t: 'style'; style: string; c: MarkNode[] };

/** Премиум-стили, кроме цветов: цвета берутся из палитры имени (NAME_COLORS). */
export const TEXT_EFFECTS = ['big', 'small', 'wave'] as const;

const INLINE = new RegExp(
  [
    '`([^`\\n]+)`', // 1 код
    '\\*\\*(.+?)\\*\\*', // 2 жирный
    '__(.+?)__', // 3 курсив
    '~~(.+?)~~', // 4 зачёркнутый
    '--(?=\\S)(.+?)(?<=\\S)--', // 5 подчёркнутый
    '\\|\\|(.+?)\\|\\|', // 6 спойлер
    '\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)', // 7,8 ссылка с текстом
    '\\{([a-z]+)\\|([^{}\\n]+)\\}', // 9,10 премиум-стиль
    '(https?:\\/\\/[^\\s<]+[^\\s<.,:;"\')\\]!?])', // 11 ссылка
    '(@[a-zA-Z][a-zA-Z0-9_]{3,31})', // 12 упоминание
  ].join('|'),
  'g',
);

function inline(s: string, styles: ReadonlySet<string>): MarkNode[] {
  const out: MarkNode[] = [];
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev?.t === 'text') prev.v += text;
    else out.push({ t: 'text', v: text });
  };
  for (const m of s.matchAll(INLINE)) {
    const i = m.index ?? 0;
    push(s.slice(last, i));
    last = i + m[0].length;
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'b', c: inline(m[2], styles) });
    else if (m[3] !== undefined) out.push({ t: 'i', c: inline(m[3], styles) });
    else if (m[4] !== undefined) out.push({ t: 's', c: inline(m[4], styles) });
    else if (m[5] !== undefined) out.push({ t: 'u', c: inline(m[5], styles) });
    else if (m[6] !== undefined) out.push({ t: 'spoiler', c: inline(m[6], styles) });
    else if (m[7] !== undefined) out.push({ t: 'link', href: m[8], c: inline(m[7], styles) });
    else if (m[9] !== undefined) {
      if (styles.has(m[9])) out.push({ t: 'style', style: m[9], c: inline(m[10], styles) });
      else push(m[0]);
    } else if (m[11] !== undefined) out.push({ t: 'url', v: m[11] });
    else if (m[12] !== undefined) out.push({ t: 'mention', v: m[12] });
  }
  push(s.slice(last));
  return out;
}

function lines(block: string, styles: ReadonlySet<string>): MarkNode[] {
  const out: MarkNode[] = [];
  const rows = block.split('\n');
  for (let i = 0; i < rows.length; i++) {
    if (/^> ?/.test(rows[i])) {
      // Подряд идущие строки «> …» — одна цитата.
      const quoted: string[] = [];
      while (i < rows.length && /^> ?/.test(rows[i])) quoted.push(rows[i++].replace(/^> ?/, ''));
      i--;
      out.push({ t: 'quote', c: lines(quoted.join('\n'), styles) });
      continue;
    }
    if (i > 0 && out.length && out[out.length - 1].t !== 'quote') out.push({ t: 'br' });
    out.push(...inline(rows[i], styles));
  }
  return out;
}

/** styles — какие {стили|…} считать разметкой (остальные остаются текстом). */
export function parseMarkup(text: string, styles: ReadonlySet<string> = new Set()): MarkNode[] {
  const out: MarkNode[] = [];
  const parts = text.split(/```(?:[a-z]*\n)?([\s\S]*?)```/);
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) {
      out.push({ t: 'pre', v: part.replace(/\n$/, '') });
      return;
    }
    // Переносы строк вокруг блока кода — часть самого блока.
    let p = part;
    if (idx > 0) p = p.replace(/^\n/, '');
    if (idx < parts.length - 1) p = p.replace(/\n$/, '');
    if (p) out.push(...lines(p, styles));
  });
  return out;
}

/** Текст без разметки — для превью в списке чатов, ответов и пушей. Спойлер скрыт. */
export function stripMarkup(text: string): string {
  return text
    .replace(/```(?:[a-z]*\n)?([\s\S]*?)```/g, '$1')
    .replace(/\|\|(.+?)\|\|/g, (_, s: string) => '•'.repeat(Math.min(s.length, 8)))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/\{[a-z]+\|([^{}\n]+)\}/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/--(?=\S)(.+?)(?<=\S)--/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^> ?/gm, '');
}

/** Обернуть выделенный фрагмент поля ввода разметкой; возвращает новый текст и выделение. */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
  open: string,
  close = open,
): { text: string; start: number; end: number } {
  const sel = text.slice(start, end);
  // Уже обёрнуто — снимаем (повторное нажатие кнопки).
  if (text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close) {
    return {
      text: text.slice(0, start - open.length) + sel + text.slice(end + close.length),
      start: start - open.length,
      end: end - open.length,
    };
  }
  return {
    text: text.slice(0, start) + open + sel + close + text.slice(end),
    start: start + open.length,
    end: end + open.length,
  };
}
