// Только синие: фирменный, глубокий тёмно-синий, небесный, белый и холодно-серый.
export const C = {
  brand: '#3390ec',
  navy: '#0b2a5b',
  navyDeep: '#0a1f44',
  sky: '#8fd0ff',
  skyLight: '#dff1ff',
  white: '#ffffff',
  cloud: '#f2f6fb',
  // Цвета самого приложения (src/app/global.css и тема Midnight).
  appInk: '#0f0f0f',
  appDarkBg: '#212121',
  appDarkAccent: '#60a5fa',
} as const;

/** Мягкая многослойная тень синего оттенка. */
export const SHADOW = [
  '0 2px 6px rgba(10, 31, 68, 0.16)',
  '0 16px 40px rgba(10, 31, 68, 0.28)',
  '0 48px 120px rgba(10, 31, 68, 0.38)',
].join(', ');

/** Матовое стекло — только для плашек поверх градиента. */
export const GLASS: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.78)',
  backdropFilter: 'blur(24px) saturate(1.4)',
  WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
  border: '1px solid rgba(255, 255, 255, 0.7)',
  boxShadow: SHADOW,
};
