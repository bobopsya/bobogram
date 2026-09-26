import { describe, expect, it } from 'vitest';
import { normalizeUsername, validateUsername } from '../../src/lib/username';
import { randomCode } from '../../src/lib/ids';
import { dayLabel, formatDuration, isReadByOthers } from '../../src/lib/time';
import { splitText } from '../../src/features/chat/Composer';
import { describeUserAgent } from '../../src/lib/device';
import { isEmojiOnly } from '../../src/features/chat/MessageText';

describe('юзернейм', () => {
  it('валидирует как в Telegram', () => {
    expect(validateUsername('bob')).toBe('short');
    expect(validateUsername('a'.repeat(33))).toBe('long');
    expect(validateUsername('1bob')).toBe('start');
    expect(validateUsername('bo-b1')).toBe('chars');
    expect(validateUsername('Bob_2024')).toBeNull();
    expect(validateUsername('@alice')).toBeNull();
  });
  it('убирает @ и пробелы', () => {
    expect(normalizeUsername('  @@alice ')).toBe('alice');
  });
});

describe('id чатов', () => {
  it('случайный код нужной длины', () => {
    expect(randomCode(12)).toMatch(/^[A-Za-z0-9]{12}$/);
  });
});

describe('время', () => {
  it('длительность звонка', () => {
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(125)).toBe('2:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
  it('сегодня и вчера', () => {
    const now = new Date(2026, 8, 24, 12);
    expect(dayLabel(new Date(2026, 8, 24, 1), 'ru', now).kind).toBe('today');
    expect(dayLabel(new Date(2026, 8, 23, 23), 'ru', now).kind).toBe('yesterday');
    expect(dayLabel(new Date(2026, 5, 1), 'ru', now).kind).toBe('date');
  });
  it('прочитано другим участником', () => {
    expect(isReadByOthers(2000, 3000)).toBe(true);
    expect(isReadByOthers(4000, 3000)).toBe(false);
    expect(isReadByOthers(0, 3000)).toBe(false);
  });
});

describe('текст сообщений', () => {
  it('делит длинный текст на части', () => {
    const text = 'слово '.repeat(2000);
    const parts = splitText(text, 4096);
    expect(parts.length).toBe(3);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.trim());
  });
  it('крупные эмодзи', () => {
    expect(isEmojiOnly('😂')).toBe(true);
    expect(isEmojiOnly('👍🏽❤️🔥')).toBe(true);
    expect(isEmojiOnly('😂😂😂😂')).toBe(false);
    expect(isEmojiOnly('привет 😂')).toBe(false);
    expect(isEmojiOnly('123')).toBe(false);
  });
});

describe('кэш сообщений старой версии', () => {
  it('дозаполняет новые поля', async () => {
    const { normalizeMessage } = await import('../../src/supabase/types');
    const old = { id: '1', chatId: 'c', senderId: 'u', text: 'hi', createdAt: 1, reactions: { '👍': ['u'] } };
    const m = normalizeMessage(old as never);
    expect(m.boostReactions).toEqual({});
    expect(m.views + m.boostViews).toBe(0);
    expect(m.reactions).toEqual({ '👍': ['u'] });
  });
});

describe('describeUserAgent', () => {
  it('iPhone, Android, Windows', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ os: 'iOS 18.2', browser: 'Safari 18.2', device: 'iPhone' });
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      ),
    ).toEqual({ os: 'Android 14', browser: 'Chrome 141', device: 'SM-S918B' });
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 YaBrowser/25.8.0.0 Safari/537.36',
      ),
    ).toEqual({ os: 'Windows', browser: 'Яндекс 25', device: 'Компьютер' });
  });
});
