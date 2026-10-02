import { interpolate, spring } from 'remotion';
import { FPS } from './timing';

// Одна пружина на весь ролик: лёгкий overshoot, без дёрганий.
export const SPRING = { damping: 17, stiffness: 140, mass: 1 } as const;

/**
 * Вход: 0 → 1 (с небольшим перелётом) начиная с кадра start.
 * fps — частота композиции: при 60 fps та же пружина идёт столько же секунд, просто плавнее.
 */
export function rise(frame: number, start: number, durationInFrames?: number, fps: number = FPS): number {
  return spring({ frame: frame - start, fps, config: SPRING, durationInFrames });
}

/** Выход быстрее входа: та же пружина, сжатая до 8 кадров (при 30 fps). */
export function fall(frame: number, start: number, fps: number = FPS): number {
  return spring({ frame: frame - start, fps, config: SPRING, durationInFrames: Math.round((8 * fps) / FPS) });
}

/** 0 → 1, обрезанное до [0, 1] — для прозрачности. */
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Значение, которое пружиной переходит между ключами: [кадр, значение].
 * Переходы могут перекрываться — получается одно непрерывное движение.
 */
export function track(
  frame: number,
  initial: number,
  keys: ReadonlyArray<readonly [number, number]>,
  fps: number = FPS,
): number {
  let value = initial;
  let prev = initial;
  for (const [at, v] of keys) {
    value += (v - prev) * rise(frame, at, undefined, fps);
    prev = v;
  }
  return value;
}

/** То же для масштаба: в логарифме, чтобы зум шёл равномерно. */
export function trackScale(
  frame: number,
  initial: number,
  keys: ReadonlyArray<readonly [number, number]>,
  fps: number = FPS,
): number {
  return Math.exp(
    track(
      frame,
      Math.log(initial),
      keys.map(([at, v]) => [at, Math.log(v)] as const),
      fps,
    ),
  );
}

/** Появление «снизу + масштаб 0.94→1 + fade». */
export function appearStyle(p: number, distance = 40): React.CSSProperties {
  return {
    opacity: clamp01(p),
    transform: `translateY(${(1 - p) * distance}px) scale(${0.94 + 0.06 * p})`,
  };
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Медленный дрейф 0 → 1 на всё видео (замирает к статичному финалу). */
export function drift(frame: number, freeze: number): number {
  return interpolate(frame, [0, freeze], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}
