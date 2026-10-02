import { staticFile } from 'remotion';
import raw from '../../public/shots/layout.json';

// Координаты элементов настоящих экранов (CSS-пиксели вьюпорта 390×844 и 1440×900),
// их пишет scripts/capture.mjs вместе со скриншотами.
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Row {
  own: boolean;
  system: boolean;
  last: boolean;
  bubble: Rect;
  text: string;
  reactions: Rect | null;
  reaction: Rect | null;
  tick: Rect | null;
  style: { radius: string } | null;
}

export type Theme = 'light' | 'dark';

interface ThemeLayout {
  login: {
    username: Rect;
    usernameBox: Rect;
    password: Rect;
    button: Rect;
    fontSize: number;
    paddingLeft: number;
    passwordPaddingLeft: number;
  };
  chats: { search: Rect; searchBox: Rect; fontSize: number; paddingLeft: number };
  search: { result: Rect; avatar: Rect };
  chat: {
    header: Rect;
    status: Rect;
    messages: Rect;
    statusStyle: { font: string; color: string; lineHeight: string };
    headerBg: string;
  };
  chatFull: { rows: Row[] };
  chatSent: { rows: Row[] };
  chatOffline?: { rows: Row[] };
}

export const LAYOUT = raw as unknown as Record<Theme, ThemeLayout>;

export const PHONE_VIEWPORT = { w: 390, h: 844 } as const;
export const DESKTOP_VIEWPORT = { w: 1440, h: 900 } as const;

export const shot = (name: string) => staticFile(`shots/${name}.png`);

// ---------- мир (координаты сцены при камере 1:1) ----------
/** Телефон: экран 390×844 в масштабе 1:1, тонкий корпус. */
export const PHONE = { x: 1340, y: 540, bezel: 12, radius: 50, screenRadius: 38 } as const;
export const PHONE_BODY = {
  w: PHONE_VIEWPORT.w + PHONE.bezel * 2,
  h: PHONE_VIEWPORT.h + PHONE.bezel * 2,
} as const;

/** Окно браузера: страница 1440×900 в масштабе 2/3. */
export const BROWSER = { x: 1830, y: 500, contentW: 960, toolbar: 54, radius: 22 } as const;
export const BROWSER_SCALE = BROWSER.contentW / DESKTOP_VIEWPORT.w;
export const BROWSER_SIZE = {
  w: BROWSER.contentW,
  h: DESKTOP_VIEWPORT.h * BROWSER_SCALE + BROWSER.toolbar,
} as const;

/** Точка экрана телефона (CSS-пиксели) → координаты мира. */
export function phonePoint(px: number, py: number) {
  return {
    x: PHONE.x - PHONE_BODY.w / 2 + PHONE.bezel + px,
    y: PHONE.y - PHONE_BODY.h / 2 + PHONE.bezel + py,
  };
}
