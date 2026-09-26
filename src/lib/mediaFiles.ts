/** Подготовка фото и запись голосовых в браузере. */

const MAX_SIDE = 1600;

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

/** Уменьшает фото до 1600px по большей стороне и пережимает в JPEG. */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // Прозрачный PNG — на белом фоне, а не на чёрном.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('encode failed');
  return { blob, width, height };
}

// ---------- голосовые ----------
const AUDIO_TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

export function canRecordVoice(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export interface VoiceResult {
  blob: Blob;
  mime: string;
  ext: string;
  duration: number;
  waveform: number[];
}

export const WAVEFORM_BARS = 48;

/** Сжимает громкость по кадрам до фиксированного числа столбиков 0..31. */
export function toWaveform(levels: number[], bars = WAVEFORM_BARS): number[] {
  if (levels.length === 0) return new Array(bars).fill(0);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const from = Math.floor((i * levels.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / bars));
    const slice = levels.slice(from, to);
    out.push(Math.max(...slice));
  }
  const peak = Math.max(...out, 0.01);
  return out.map((v) => Math.round((v / peak) * 31));
}

/** Запись с микрофона: start → stop() даёт файл, cancel() — выбросить. */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private levels: number[] = [];
  private audioCtx: AudioContext | null = null;
  private levelTimer: number | undefined;
  private startedAt = 0;
  /** Текущая громкость 0..1 — для анимации при записи. */
  level = 0;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mime = AUDIO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(
      this.stream,
      mime ? { mimeType: mime, audioBitsPerSecond: 48_000 } : undefined,
    );
    this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.recorder.start(250);
    this.startedAt = Date.now();

    try {
      this.audioCtx = new AudioContext();
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      this.audioCtx.createMediaStreamSource(this.stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      this.levelTimer = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        this.level = Math.min(1, Math.sqrt(sum / data.length) * 4);
        this.levels.push(this.level);
      }, 60);
    } catch {
      // без волны — не страшно
    }
  }

  get elapsed(): number {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  stop(): Promise<VoiceResult> {
    return new Promise((resolve, reject) => {
      const rec = this.recorder;
      if (!rec) return reject(new Error('not recording'));
      const duration = this.elapsed;
      rec.onstop = () => {
        const mime = (rec.mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(this.chunks, { type: mime });
        const waveform = toWaveform(this.levels);
        this.release();
        resolve({
          blob,
          mime,
          ext: mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm',
          duration,
          waveform,
        });
      };
      rec.stop();
    });
  }

  cancel() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.release();
  }

  private release() {
    window.clearInterval(this.levelTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.audioCtx?.close().catch(() => undefined);
    this.stream = null;
    this.recorder = null;
    this.audioCtx = null;
    this.chunks = [];
    this.levels = [];
  }
}

// ---------- видео и файлы ----------
export const FILE_MAX_BYTES = 50 * 1024 * 1024;

export interface VideoMeta {
  width: number;
  height: number;
  duration: number;
}

/** Размер и длительность видео — из метаданных, без перекодирования. */
export function readVideoMeta(file: Blob): Promise<VideoMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (meta: VideoMeta) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    v.onloadedmetadata = () =>
      done({
        width: v.videoWidth || 640,
        height: v.videoHeight || 360,
        duration: Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : 0,
      });
    v.onerror = () => done({ width: 640, height: 360, duration: 0 });
    v.src = url;
  });
}

/** Расширение для пути в хранилище: из имени файла или типа. */
export function fileExt(file: File): string {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(file.name)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  const fromType = file.type.split('/')[1]?.split(/[;+]/)[0]?.toLowerCase();
  return fromType && /^[a-z0-9]{1,8}$/.test(fromType) ? fromType : 'bin';
}

export function formatSize(bytes: number | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

// ---------- видеокружочки ----------
const VIDEO_TYPES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
export const VIDEO_NOTE_MAX_S = 60;

export interface VideoNoteResult {
  blob: Blob;
  mime: string;
  ext: string;
  duration: number;
}

/** Кружок с фронтальной камеры: start(videoEl) показывает превью, stop() — файл. */
export class VideoNoteRecorder {
  stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  async start(): Promise<MediaStream> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 }, aspectRatio: 1 },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mime = VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(
      this.stream,
      mime ? { mimeType: mime, videoBitsPerSecond: 900_000, audioBitsPerSecond: 64_000 } : undefined,
    );
    this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.recorder.start(250);
    this.startedAt = Date.now();
    return this.stream;
  }

  get elapsed(): number {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  stop(): Promise<VideoNoteResult> {
    return new Promise((resolve, reject) => {
      const rec = this.recorder;
      if (!rec) return reject(new Error('not recording'));
      const duration = Math.round(this.elapsed * 10) / 10;
      rec.onstop = () => {
        const mime = (rec.mimeType || 'video/webm').split(';')[0];
        const blob = new Blob(this.chunks, { type: mime });
        this.release();
        resolve({ blob, mime, ext: mime.includes('mp4') ? 'mp4' : 'webm', duration });
      };
      rec.stop();
    });
  }

  cancel() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}
