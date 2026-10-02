import { loadFont } from '@remotion/fonts';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff2';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2';
import deva600 from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-600-normal.woff2';
// Noto Sans SC разбит на куски по символам: 中 и 文 лежат в 119 и 118.
import sc118 from '@fontsource/noto-sans-sc/files/noto-sans-sc-118-600-normal.woff2';
import sc119 from '@fontsource/noto-sans-sc/files/noto-sans-sc-119-600-normal.woff2';

// Inter и Noto — под лицензией SIL OFL. loadFont сам держит рендер, пока шрифт не загрузится.
const faces: [string, string, string][] = [
  ['Inter', inter400, '400'],
  ['Inter', inter500, '500'],
  ['Inter', inter600, '600'],
  ['Inter', inter700, '700'],
  ['Noto Sans Devanagari', deva600, '600'],
  ['Noto Sans SC 118', sc118, '600'],
  ['Noto Sans SC 119', sc119, '600'],
];
for (const [family, url, weight] of faces) {
  void loadFont({ family, url, weight, format: 'woff2' });
}

export const FONT =
  "'Inter', 'Noto Sans Devanagari', 'Noto Sans SC 118', 'Noto Sans SC 119', 'Noto Color Emoji', sans-serif";
