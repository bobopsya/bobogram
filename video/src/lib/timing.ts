// Ритм ролика: 120 BPM, один удар = 0,5 с = 15 кадров.
// Смены сцен и главные акценты стоят на целых ударах, чтобы музыка легла без правок.
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION = 450;
export const BEAT = 15;

/** Кадр удара номер n. */
export const beat = (n: number) => n * BEAT;

/** Сцены по раскадровке, в ударах. */
export const SCENE = {
  login: { from: beat(0), to: beat(5) },
  search: { from: beat(5), to: beat(10) },
  chat: { from: beat(10), to: beat(18) },
  devices: { from: beat(18), to: beat(23) },
  langs: { from: beat(23), to: beat(25) },
  finale: { from: beat(25), to: beat(30) },
} as const;

/** Подпись уходит за 7 кадров до смены сцены. */
export const CAPTION_OUT = 7;

/** Последние 0,5 с — статичный кадр. */
export const FREEZE = DURATION - BEAT;
