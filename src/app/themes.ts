/** Цветовые темы, фоны чата и цвета пузырей для экрана «Оформление». */

export interface Palette {
  accent: string;
  /** Цвет своих сообщений. */
  bubbleOut: string;
}

export interface ThemePreset {
  id: string;
  premium: boolean;
  light: Palette;
  dark: Palette;
}

export const THEMES: ThemePreset[] = [
  { id: 'classic', premium: false, light: { accent: '#3390ec', bubbleOut: '#e3fee0' }, dark: { accent: '#8774e1', bubbleOut: '#766ac8' } },
  { id: 'ocean', premium: false, light: { accent: '#0a9396', bubbleOut: '#d8f3f1' }, dark: { accent: '#2ec4b6', bubbleOut: '#1b6f6a' } },
  { id: 'forest', premium: false, light: { accent: '#2e9d4f', bubbleOut: '#dcf5d6' }, dark: { accent: '#4caf6e', bubbleOut: '#2f6b3f' } },
  { id: 'sunset', premium: false, light: { accent: '#f07c2a', bubbleOut: '#ffe9d4' }, dark: { accent: '#ff9f43', bubbleOut: '#8a4a1c' } },
  { id: 'rose', premium: false, light: { accent: '#e0457b', bubbleOut: '#ffe0ec' }, dark: { accent: '#ff6b9d', bubbleOut: '#8e2f55' } },
  { id: 'gold', premium: true, light: { accent: '#c9942b', bubbleOut: '#fff3cf' }, dark: { accent: '#e8b64c', bubbleOut: '#7a5a17' } },
  { id: 'neon', premium: true, light: { accent: '#7c3aed', bubbleOut: '#ede4ff' }, dark: { accent: '#c084fc', bubbleOut: '#5b21b6' } },
  { id: 'midnight', premium: true, light: { accent: '#1e3a8a', bubbleOut: '#dbe6ff' }, dark: { accent: '#60a5fa', bubbleOut: '#1e3a8a' } },
];

export interface Background {
  id: string;
  premium: boolean;
  light: string;
  dark: string;
}

const dots = (color: string, bg: string) =>
  `radial-gradient(${color} 1.2px, transparent 1.2px) 0 0 / 18px 18px, ${bg}`;

export const BACKGROUNDS: Background[] = [
  {
    id: 'default',
    premium: false,
    light: 'linear-gradient(135deg, #d5e3b0 0%, #a9c98f 50%, #87b47d 100%)',
    dark: 'linear-gradient(135deg, #1b2733 0%, #10171e 60%, #0e1621 100%)',
  },
  { id: 'plain', premium: false, light: '#e7ebf0', dark: '#0f0f0f' },
  {
    id: 'sky',
    premium: false,
    light: 'linear-gradient(160deg, #cfe8ff 0%, #e8f3ff 50%, #fdfbff 100%)',
    dark: 'linear-gradient(160deg, #0b1d33 0%, #102a44 60%, #0a1422 100%)',
  },
  {
    id: 'peach',
    premium: false,
    light: 'linear-gradient(160deg, #ffe1c7 0%, #ffd0d8 60%, #f3d4ff 100%)',
    dark: 'linear-gradient(160deg, #3a2320 0%, #3a1e2c 60%, #26183a 100%)',
  },
  { id: 'dots', premium: false, light: dots('#c9d3dd', '#eef2f6'), dark: dots('#26303a', '#12181e') },
  {
    id: 'aurora',
    premium: true,
    light: 'linear-gradient(135deg, #a8edea 0%, #c3b8f4 50%, #fed6e3 100%)',
    dark: 'linear-gradient(135deg, #0f2027 0%, #203a43 40%, #2c5364 70%, #3b2667 100%)',
  },
  {
    id: 'galaxy',
    premium: true,
    light: 'radial-gradient(circle at 20% 20%, #fbe9ff 0%, transparent 40%), radial-gradient(circle at 80% 70%, #d7ecff 0%, transparent 45%), #f4f1ff',
    dark: 'radial-gradient(circle at 20% 20%, #3b1f5e 0%, transparent 40%), radial-gradient(circle at 80% 70%, #0e3b63 0%, transparent 45%), #07070f',
  },
  {
    id: 'gold',
    premium: true,
    light: 'linear-gradient(135deg, #fff6d8 0%, #f7e2a8 50%, #efd08a 100%)',
    dark: 'linear-gradient(135deg, #1e1706 0%, #3a2b0b 60%, #1a1405 100%)',
  },
];

/** null — цвет из темы. */
export const BUBBLE_COLORS: (string | null)[] = [
  null,
  '#e3fee0',
  '#dcecff',
  '#fff1c7',
  '#ffe0ec',
  '#ece2ff',
  '#3390ec',
  '#2e9d4f',
  '#e0457b',
  '#7c3aed',
  '#1f2937',
];

export interface Appearance {
  theme: string;
  background: string;
  bubbleColor: string | null;
  /** Скругление пузырей, px. */
  radius: number;
  /** Размер текста сообщений, px. */
  fontSize: number;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'classic',
  background: 'default',
  bubbleColor: null,
  radius: 15,
  fontSize: 16,
};

export const RADIUS_RANGE = { min: 4, max: 22 };
export const FONT_RANGE = { min: 13, max: 20 };

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Тёмный цвет → белый текст на нём. */
export function isDarkColor(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.35;
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function darken(hex: string, amount = 0.1): string {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.max(0, Math.round(c * (1 - amount))));
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** CSS-переменные для выбранного оформления. Премиальные варианты без премиума заменяются обычными. */
export function appearanceVars(a: Appearance, dark: boolean, premium: boolean): Record<string, string> {
  const theme = THEMES.find((t) => t.id === a.theme && (premium || !t.premium)) ?? THEMES[0];
  const bg = BACKGROUNDS.find((b) => b.id === a.background && (premium || !b.premium)) ?? BACKGROUNDS[0];
  const palette = dark ? theme.dark : theme.light;
  const bubble = a.bubbleColor ?? palette.bubbleOut;
  const bubbleDark = isDarkColor(bubble);
  const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v));
  return {
    '--accent': palette.accent,
    '--accent-hover': darken(palette.accent),
    '--accent-soft': withAlpha(palette.accent, dark ? 0.16 : 0.12),
    '--bg-active': palette.accent,
    '--highlight': withAlpha(palette.accent, 0.3),
    '--bubble-out': bubble,
    '--bubble-out-text': bubbleDark ? '#ffffff' : '#0f0f0f',
    '--bubble-out-meta': bubbleDark ? 'rgba(255, 255, 255, 0.7)' : darken(bubble, 0.55),
    '--chat-pattern': dark ? bg.dark : bg.light,
    '--bubble-radius': `${clamp(a.radius, RADIUS_RANGE)}px`,
    '--msg-font': `${clamp(a.fontSize, FONT_RANGE)}px`,
  };
}
