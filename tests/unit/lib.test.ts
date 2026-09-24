import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { normalizeUsername, validateUsername } from '../../src/lib/username';
import { otherMember, privateChatId, privateMembers, randomCode } from '../../src/lib/ids';
import { dayLabel, formatDuration, isReadByOthers } from '../../src/lib/time';
import { splitText } from '../../src/features/chat/Composer';
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
  it('личный чат одинаков для обоих', () => {
    expect(privateChatId('b', 'a')).toBe('a_b');
    expect(privateChatId('a', 'b')).toBe('a_b');
    expect(privateMembers('z', 'y')).toEqual(['y', 'z']);
    expect(otherMember(['a', 'b'], 'a')).toBe('b');
  });
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
    const readBy = { me: Timestamp.fromMillis(5000), bob: Timestamp.fromMillis(3000) };
    expect(isReadByOthers(2000, readBy, 'me')).toBe(true);
    expect(isReadByOthers(4000, readBy, 'me')).toBe(false);
    expect(isReadByOthers(0, readBy, 'me')).toBe(false);
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
