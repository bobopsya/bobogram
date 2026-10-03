import { fall, rise, track } from '../lib/motion';
import beats from './beats.json';

// Ролик в духе рекламы Windows 8: 60 fps, длина трека, монтаж по его долям.
// beats.json пишет scripts/beats.mjs: темп, фаза первой доли, сетка долей. Звука в ролике нет —
// лицензированный трек накладывается поверх и совпадает по долям.
export const M_FPS = 60;
export const M_DURATION = Math.ceil(beats.duration * M_FPS);
export const PERIOD = 60 / beats.bpm;

/** Секунды → кадр. */
export const f = (seconds: number) => Math.round(seconds * M_FPS);
/** Время k-й восьмой доли (половина удара), в секундах. */
export const eighth = (k: number) => beats.offset + (k * PERIOD) / 2;
/** Кадр k-й восьмой доли. */
export const e8 = (k: number) => f(eighth(k));

// Склейки — там же, где в референсе, но точно на восьмых долях трека
// (в скобках — где склейка в рекламе Windows 8).
export const CUT = {
  logo: 0,
  laptop: e8(3), // 0,68 с
  wall: e8(11), // 2,36
  storiesTile: e8(17), // 3,56
  liveTile: e8(20), // 4,20
  wall2: e8(22), // 4,72
  op1: e8(27), // 5,64
  wall3: e8(36), // 7,44
  stories: e8(38), // 7,92
  op2: e8(53), // 11,12
  op3: e8(58), // 12,12
  typing: e8(62), // 12,96
  op4: e8(78), // 16,20
  poll: e8(88), // 18,28
  cafe: e8(92), // 19,16
  op5: e8(99), // 20,48
  wall4: e8(104), // 21,6
  devices: e8(107), // 22,2
  tagline: e8(121), // 25,0
  lockup: e8(127), // 26,3
  company: e8(142), // 29,52
  end: M_DURATION,
} as const;

/** Удар по сетке: 1 сразу после доли, затухает за полудолю (для пульсации на ритм). */
export function pulse(frame: number, every = 2): number {
  const t = frame / M_FPS - beats.offset;
  const step = (PERIOD / 2) * every;
  const since = ((t % step) + step) % step;
  return Math.exp(-since / (PERIOD * 0.18));
}

// Та же пружина, что в остальных роликах, при 60 fps.
export const up = (frame: number, start: number, d?: number) => rise(frame, start, d, M_FPS);
export const down = (frame: number, start: number) => fall(frame, start, M_FPS);
export const keys = (frame: number, initial: number, k: ReadonlyArray<readonly [number, number]>) =>
  track(frame, initial, k, M_FPS);
