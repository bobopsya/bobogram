// Сетка долей трека: node scripts/beats.mjs <аудио> [выход.json]
// Берём из трека только тайминги (темп, фазу, акценты) — сам звук в ролик не попадает.
// ffmpeg → моно PCM 22 050 Гц → спектральный поток (FFT 1024, шаг 512) → автокорреляция → темп и фаза.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [input, output = 'src/metro/beats.json'] = process.argv.slice(2);
if (!input) {
  console.error('Использование: node scripts/beats.mjs <аудио> [выход.json]');
  process.exit(1);
}

const RATE = 22050;
const N = 1024;
const HOP = 512;
const pcm = execFileSync(
  'ffmpeg',
  ['-v', 'error', '-i', input, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'],
  {
    maxBuffer: 1 << 30,
  },
);
const samples = new Float32Array(pcm.length / 2);
for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
const duration = samples.length / RATE;

// ---------- FFT (радикс-2) ----------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
  }
}

// ---------- огибающая атак (спектральный поток) ----------
const frames = Math.floor((samples.length - N) / HOP);
const fps = RATE / HOP; // кадров огибающей в секунду
const flux = new Float32Array(frames);
let prev = new Float32Array(N / 2);
const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
for (let f = 0; f < frames; f++) {
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let i = 0; i < N; i++) re[i] = samples[f * HOP + i] * win[i];
  fft(re, im);
  const mag = new Float32Array(N / 2);
  let s = 0;
  for (let k = 1; k < N / 2; k++) {
    mag[k] = Math.log1p(10 * Math.hypot(re[k], im[k]));
    s += Math.max(0, mag[k] - prev[k]);
  }
  flux[f] = s;
  prev = mag;
}
// Нормировка и вычитание локального среднего.
const onset = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  let m = 0;
  let c = 0;
  for (let k = Math.max(0, f - 8); k <= Math.min(frames - 1, f + 8); k++) ((m += flux[k]), c++);
  onset[f] = Math.max(0, flux[f] - m / c);
}
const max = Math.max(...onset);
for (let f = 0; f < frames; f++) onset[f] /= max;

// ---------- темп: автокорреляция в диапазоне 70–180 BPM, с весом вокруг 120 ----------
let best = { bpm: 0, score: -1 };
for (let bpm = 70; bpm <= 180; bpm += 0.25) {
  const lag = (60 / bpm) * fps;
  let s = 0;
  for (let f = 0; f + lag * 2 < frames; f++) {
    const a = onset[f];
    s += a * (interp(onset, f + lag) + 0.5 * interp(onset, f + 2 * lag));
  }
  const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
  if (s * prior > best.score) best = { bpm, score: s * prior };
}
function interp(a, x) {
  const i = Math.floor(x);
  const t = x - i;
  return (a[i] ?? 0) * (1 - t) + (a[i + 1] ?? 0) * t;
}

// ---------- уточнение: темп ±4 BPM и фаза, при которых на сетку попадает больше всего атак ----------
const gridScore = (p, off) => {
  let s = 0;
  for (let t = off; t < duration; t += p) s += interp(onset, t * fps);
  return s;
};
let phase = { offset: 0, score: -1 };
for (let bpm = best.bpm - 4; bpm <= best.bpm + 4; bpm += 0.05) {
  const p = 60 / bpm;
  for (let off = 0; off < p; off += 0.002) {
    const s = gridScore(p, off);
    if (s > phase.score) phase = { offset: off, score: s, bpm };
  }
}
best.bpm = +phase.bpm.toFixed(2);
const period = 60 / best.bpm;
const beats = [];
for (let t = phase.offset; t < duration; t += period) beats.push(+t.toFixed(3));

// ---------- акценты: сильнейшие атаки (пики), не ближе 0,2 с друг к другу ----------
const peaks = [];
for (let f = 2; f < frames - 2; f++)
  if (
    onset[f] > 0.25 &&
    onset[f] >= onset[f - 1] &&
    onset[f] >= onset[f + 1] &&
    onset[f] >= onset[f - 2] &&
    onset[f] >= onset[f + 2]
  )
    peaks.push({ t: +(f / fps).toFixed(3), s: +onset[f].toFixed(3) });
peaks.sort((a, b) => b.s - a.s);
const accents = [];
for (const p of peaks) if (accents.every((a) => Math.abs(a.t - p.t) > 0.2)) accents.push(p);
accents.sort((a, b) => a.t - b.t);

// Громкость по долям — где трек «раскрывается» (для выбора крупных смен).
const loud = beats.map((t) => {
  const a = Math.floor(t * RATE);
  const b = Math.min(samples.length, a + Math.floor(period * RATE));
  let s = 0;
  for (let i = a; i < b; i++) s += samples[i] * samples[i];
  return +Math.sqrt(s / Math.max(1, b - a)).toFixed(4);
});

const result = {
  duration: +duration.toFixed(3),
  bpm: best.bpm,
  period: +period.toFixed(4),
  offset: +phase.offset.toFixed(3),
  beats,
  loud,
  accents,
};
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(
  `Длительность ${result.duration} с, темп ${result.bpm} BPM, первая доля ${result.offset} с, долей ${beats.length}, акцентов ${accents.length}`,
);
console.log('→', output);
