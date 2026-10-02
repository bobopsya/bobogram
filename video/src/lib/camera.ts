import { CUE } from './cues';
import { drift, track, trackScale } from './motion';
import { HEIGHT, WIDTH } from './timing';

export interface Camera {
  /** Точка мира в центре кадра. */
  x: number;
  y: number;
  s: number;
}

/**
 * Одна камера на весь ролик: сцены — это её непрерывные наезды и отъезды, без склеек.
 * Поверх ключей — медленный общий наезд 1.00 → 1.08.
 */
export function cameraAt(frame: number): Camera {
  const x = track(frame, WIDTH / 2, [
    [CUE.zoomSearch, 1168],
    [CUE.zoomOut, 940],
    [CUE.zoomChat, 1002],
    [CUE.pullBack, 1300],
    [CUE.toPhone, 1036],
    [CUE.gather, 1340],
  ]);
  const y = track(frame, HEIGHT / 2, [
    [CUE.zoomSearch, 266],
    [CUE.zoomOut, 540],
    [CUE.zoomChat, 650],
    [CUE.pullBack, 540],
    [CUE.toPhone, 540],
    [CUE.gather, 610],
  ]);
  const s = trackScale(frame, 1, [
    [CUE.zoomSearch, 1.75],
    [CUE.zoomOut, 1],
    [CUE.zoomChat, 1.55],
    [CUE.pullBack, 0.8],
    [CUE.toPhone, 0.92],
    [CUE.gather, 1],
  ]);
  return { x, y, s: s * (1 + 0.08 * drift(frame, CUE.gather)) };
}

export const cameraTransform = (c: Camera) =>
  `translate(${WIDTH / 2}px, ${HEIGHT / 2}px) scale(${c.s}) translate(${-c.x}px, ${-c.y}px)`;

/** Точка мира → точка кадра. */
export const toScreen = (c: Camera, wx: number, wy: number) => ({
  x: (wx - c.x) * c.s + WIDTH / 2,
  y: (wy - c.y) * c.s + HEIGHT / 2,
});
