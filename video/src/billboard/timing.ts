import { fall, rise, track, trackScale } from '../lib/motion';

// Билборд: 15 с, 60 fps, 120 BPM — один удар = 0,5 с = 30 кадров. Ролик закольцован.
export const BB_FPS = 60;
export const BB_DURATION = 900;
export const BB_BEAT = 30;
export const b = (n: number) => n * BB_BEAT;

/** Подпись уходит за 14 кадров (те же 0,23 с, что и в первом ролике) до смены сцены. */
export const BB_CAPTION_OUT = 14;

// Та же пружина, что в первом ролике, но с частотой 60 кадров.
export const up = (frame: number, start: number, durationInFrames?: number) =>
  rise(frame, start, durationInFrames, BB_FPS);
export const down = (frame: number, start: number) => fall(frame, start, BB_FPS);
export const keys = (frame: number, initial: number, k: ReadonlyArray<readonly [number, number]>) =>
  track(frame, initial, k, BB_FPS);
export const scaleKeys = (frame: number, initial: number, k: ReadonlyArray<readonly [number, number]>) =>
  trackScale(frame, initial, k, BB_FPS);

/** Петля 0 → 1 → 0 за ролик: первый и последний кадр совпадают. */
export const loopWave = (frame: number) => (1 - Math.cos((2 * Math.PI * frame) / BB_DURATION)) / 2;

// Все события билборда в кадрах (60 fps). Главные — на целых ударах b(n).
export const BB = {
  // 1. Just @username (удары 0–5)
  type: [b(1), 45, b(2), 75], // a, l, e, x
  fly: b(3),
  phoneIn: 80,
  pass: [100, 104, 108, 112, 116, 120],
  press: b(4),
  toList: 128,
  // 2. Сторис (удары 5–9)
  ring: b(5),
  storyOpen: b(6),
  storyClose: 262,
  // 3. Опрос и голосовое (удары 9–15)
  group: b(9),
  vote: b(10),
  voice: b(12),
  voiceEnd: b(15) - 4,
  // 4. Оформление (удары 15–21)
  themes: [b(15), b(16), b(17), b(18), b(19)],
  // 5. Без телефона и почты (удары 21–25)
  fans: b(21),
  // 6. Финал и замыкание петли (удары 25–30)
  morph: b(25),
  url: b(26),
  lockupOut: 855,
  atBack: 860,
  cameraBack: 872,
} as const;

export const SCENES = {
  username: { from: b(0), to: b(5) },
  stories: { from: b(5), to: b(9) },
  pollVoice: { from: b(9), to: b(15) },
  themes: { from: b(15), to: b(21) },
  noPhone: { from: b(21), to: b(25) },
  finale: { from: b(25), to: b(30) },
} as const;
