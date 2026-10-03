import { staticFile } from 'remotion';
import raw from '../../public/shots/ru/layout.json';
import type { Rect, Row } from '../lib/layout';

// Русские экраны (scripts/capture-ru.mjs → public/shots/ru/).
interface RuLayout {
  chats: { storyAvatar: Rect; mia: Rect; friends: Rect };
  story: { progress: Rect };
  mia: { composer: Rect & { paddingLeft: number; font: number; color: string; bg: string } };
  miaSent: { rows: Row[] };
  group: { options: Rect[]; bars: (Rect & { color: string })[] };
  groupQ: { rows: Row[] };
  groupA: { rows: Row[] };
}

export const RU = raw as unknown as RuLayout;
export const ru = (name: string) => staticFile(`shots/ru/${name}.png`);

/** Синие оттенки плиток (как разноцветный «Пуск» Windows 8, но в гамме Bobogram). */
export const M = {
  blue: '#3390ec',
  navy: '#0b2a5b',
  night: '#0a1f44',
  cobalt: '#1d5fc2',
  azure: '#2a77d4',
  steel: '#164a8f',
  sky: '#5aa6e8',
  ice: '#8fd0ff',
  white: '#ffffff',
} as const;
