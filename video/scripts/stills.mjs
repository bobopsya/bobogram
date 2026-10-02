// Контрольные кадры: node scripts/stills.mjs [секунды или кадры через запятую]
//   node scripts/stills.mjs            → 1 с, 8 с, 14 с (out/stills/*.png)
//   node scripts/stills.mjs f30,f240   → кадры 30 и 240
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FPS = 30;
const arg = process.argv[2] ?? '1,8,14';
const frames = arg
  .split(',')
  .map((s) => (s.startsWith('f') ? Number(s.slice(1)) : Math.round(Number(s) * FPS)));

const serveUrl = await bundle({ entryPoint: join(root, 'src/index.ts') });
const composition = await selectComposition({ serveUrl, id: 'Promo' });
await mkdir(join(root, 'out/stills'), { recursive: true });
for (const frame of frames) {
  const output = join(root, 'out/stills', `frame-${String(frame).padStart(3, '0')}.png`);
  await renderStill({
    serveUrl,
    composition,
    frame,
    output,
    browserExecutable: process.env.REMOTION_BROWSER,
  });
  console.log('✓', output);
}
