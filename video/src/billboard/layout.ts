import { staticFile } from 'remotion';
import raw from '../../public/shots/layout.json';
import type { Rect, Theme } from '../lib/layout';

// Координаты экранов билборда (пишет scripts/capture.mjs в layout.json → billboard).
interface Bar extends Rect {
  color: string;
  radius: string;
}

interface BillboardLayout {
  light: {
    chats: { storyBubble: Rect; storyAvatar: Rect; group: Rect };
    story: { progress: Rect };
    group: { poll: Rect; voice: Rect; wave: Rect; play: Rect; options: Rect[] };
    voted: { bars: Bar[] };
  };
  themes: { dark: boolean }[];
}

export const BBL = (raw as unknown as { billboard: BillboardLayout }).billboard.light;
export const THEME_COUNT = (raw as unknown as { billboard: BillboardLayout }).billboard.themes.length;

export const bbShot = (name: string) => staticFile(`shots/billboard/${name}.png`);
export type { Theme };

/** Телефон в билборде стоит правее центра — слева место для крупной подписи. */
export const BB_PHONE = { x: 1450, y: 540 } as const;
