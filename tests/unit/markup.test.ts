import { describe, expect, it } from 'vitest';
import { parseMarkup, stripMarkup, wrapSelection } from '../../src/lib/markup';

const premium = new Set(['red', 'fire', 'big', 'wave']);

describe('разметка сообщений', () => {
  it('жирный, курсив, зачёркнутый, подчёркнутый, код, спойлер', () => {
    expect(parseMarkup('a **b** __c__ ~~d~~ --e-- `f` ||g||')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'b', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'i', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 's', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' ' },
      { t: 'u', c: [{ t: 'text', v: 'e' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'f' },
      { t: 'text', v: ' ' },
      { t: 'spoiler', c: [{ t: 'text', v: 'g' }] },
    ]);
  });

  it('вложенность и код без разметки внутри', () => {
    expect(parseMarkup('**жир __курс__**')).toEqual([
      {
        t: 'b',
        c: [
          { t: 'text', v: 'жир ' },
          { t: 'i', c: [{ t: 'text', v: 'курс' }] },
        ],
      },
    ]);
    expect(parseMarkup('`**не жирный**`')).toEqual([{ t: 'code', v: '**не жирный**' }]);
  });

  it('тире в обычном тексте — не подчёркивание', () => {
    expect(parseMarkup('да -- нет')).toEqual([{ t: 'text', v: 'да -- нет' }]);
  });

  it('ссылки, упоминания, блок кода, цитата, переносы', () => {
    expect(parseMarkup('[сайт](https://bobogram.org) @bobo https://x.ru')).toEqual([
      { t: 'link', href: 'https://bobogram.org', c: [{ t: 'text', v: 'сайт' }] },
      { t: 'text', v: ' ' },
      { t: 'mention', v: '@bobo' },
      { t: 'text', v: ' ' },
      { t: 'url', v: 'https://x.ru' },
    ]);
    expect(parseMarkup('до\n```\nx = 1\n```\nпосле')).toEqual([
      { t: 'text', v: 'до' },
      { t: 'pre', v: 'x = 1' },
      { t: 'text', v: 'после' },
    ]);
    expect(parseMarkup('> цитата\n> вторая\nответ')).toEqual([
      { t: 'quote', c: [{ t: 'text', v: 'цитата' }, { t: 'br' }, { t: 'text', v: 'вторая' }] },
      { t: 'text', v: 'ответ' },
    ]);
    expect(parseMarkup('a\nb')).toEqual([{ t: 'text', v: 'a' }, { t: 'br' }, { t: 'text', v: 'b' }]);
  });

  it('премиум-стили — только разрешённые', () => {
    expect(parseMarkup('{red|привет} {nope|x}', premium)).toEqual([
      { t: 'style', style: 'red', c: [{ t: 'text', v: 'привет' }] },
      { t: 'text', v: ' {nope|x}' },
    ]);
    expect(parseMarkup('{red|привет}')).toEqual([{ t: 'text', v: '{red|привет}' }]);
  });

  it('текст без разметки для превью', () => {
    expect(stripMarkup('**жир** ||секрет|| [сайт](https://a.ru) {fire|огонь} > q')).toBe(
      'жир •••••• сайт огонь > q',
    );
    expect(stripMarkup('> цитата\n`код`')).toBe('цитата\nкод');
  });

  it('обёртка выделения и снятие повторным нажатием', () => {
    const on = wrapSelection('привет мир', 7, 10, '**');
    expect(on).toEqual({ text: 'привет **мир**', start: 9, end: 12 });
    expect(wrapSelection(on.text, on.start, on.end, '**')).toEqual({ text: 'привет мир', start: 7, end: 10 });
    expect(wrapSelection('x', 0, 1, '{red|', '}').text).toBe('{red|x}');
  });
});
