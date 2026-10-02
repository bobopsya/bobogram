// Контрольные кадры: node scripts/stills.mjs [секунды или кадры через запятую] [--id Promo|Billboard]
//   node scripts/stills.mjs                    → Promo: 1 с, 8 с, 14 с (out/stills/*.png)
//   node scripts/stills.mjs f30,f240           → Promo: кадры 30 и 240
//   node scripts/stills.mjs 1,7,14 --id Billboard
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const idAt = args.indexOf('--id');
const id = idAt >= 0 ? args[idAt + 1] : 'Promo';
const list = args.find((a, i) => !a.startsWith('--') && (idAt < 0 || i !== idAt + 1)) ?? '1,8,14';

const serveUrl = await bundle({ entryPoint: join(root, 'src/index.ts') });
const composition = await selectComposition({ serveUrl, id });
const frames = list
  .split(',')
  .map((s) => (s.startsWith('f') ? Number(s.slice(1)) : Math.round(Number(s) * composition.fps)));
const prefix = id === 'Promo' ? 'frame' : id.toLowerCase();
await mkdir(join(root, 'out/stills'), { recursive: true });
for (const frame of frames) {
  const output = join(root, 'out/stills', `${prefix}-${String(frame).padStart(3, '0')}.png`);
  await renderStill({
    serveUrl,
    composition,
    frame,
    output,
    browserExecutable: process.env.REMOTION_BROWSER,
  });
  console.log('✓', output);
}
