// Полный рендер: node scripts/render.mjs [--id Promo|Billboard]
//   Promo     → out/bobogram-promo.mp4      (15 с, 30 fps)
//   Billboard → out/bobogram-billboard.mp4  (15 с, 60 fps, петля)
// Remotion (H.264, CRF 16, yuv420p) → ffmpeg +faststart → проверка ffprobe.
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const idAt = process.argv.indexOf('--id');
const id = idAt >= 0 ? process.argv[idAt + 1] : 'Promo';
const outDir = join(root, 'out');
const name = `bobogram-${id.toLowerCase()}`;
const raw = join(outDir, `${name}.raw.mp4`);
const final = join(outDir, `${name}.mp4`);

/** Системный ffmpeg/ffprobe, а если его нет — тот, что идёт с Remotion. */
function tool(name, args) {
  try {
    return execFileSync(name, args, { encoding: 'utf8' });
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return execFileSync('npx', ['remotion', name, ...args], { cwd: root, encoding: 'utf8' });
  }
}

await mkdir(outDir, { recursive: true });
console.log('Сборка…');
const serveUrl = await bundle({ entryPoint: join(root, 'src/index.ts') });
const composition = await selectComposition({ serveUrl, id });

let last = -1;
await renderMedia({
  serveUrl,
  composition,
  codec: 'h264',
  crf: 16,
  pixelFormat: 'yuv420p',
  imageFormat: 'png',
  muted: true,
  outputLocation: raw,
  browserExecutable: process.env.REMOTION_BROWSER,
  onProgress: ({ progress }) => {
    const p = Math.floor(progress * 10);
    if (p !== last) (console.log(`  ${p * 10}%`), (last = p));
  },
});

// moov-атом в начало файла: видео начинает играть до полной загрузки.
tool('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-c', 'copy', '-movflags', '+faststart', final]);
await rm(raw);

const info = JSON.parse(
  tool('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', final]),
);
const v = info.streams.find((s) => s.codec_type === 'video');
const fps = v.r_frame_rate;
const report = {
  file: final,
  codec: v.codec_name,
  pix_fmt: v.pix_fmt,
  size: `${v.width}x${v.height}`,
  fps,
  frames: Number(v.nb_frames),
  duration: Number(info.format.duration),
  audio: info.streams.some((s) => s.codec_type === 'audio'),
};
console.log(report);
// Ожидания берём из самой композиции: размер, fps и число кадров.
const want = {
  size: `${composition.width}x${composition.height}`,
  fps: `${composition.fps}/1`,
  frames: composition.durationInFrames,
  duration: composition.durationInFrames / composition.fps,
};
const ok =
  report.codec === 'h264' &&
  report.pix_fmt === 'yuv420p' &&
  report.size === want.size &&
  fps === want.fps &&
  report.frames === want.frames &&
  Math.abs(report.duration - want.duration) < 0.05;
if (!ok) {
  console.error('Параметры не совпали с композицией:', want);
  process.exit(1);
}
console.log('Готово ✓');
