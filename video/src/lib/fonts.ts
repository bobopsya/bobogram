import { loadFont } from '@remotion/fonts';
import inter300 from '@fontsource/inter/files/inter-latin-300-normal.woff2';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff2';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2';
import interCyr300 from '@fontsource/inter/files/inter-cyrillic-300-normal.woff2';
import interCyr400 from '@fontsource/inter/files/inter-cyrillic-400-normal.woff2';
import interCyr500 from '@fontsource/inter/files/inter-cyrillic-500-normal.woff2';
import interCyr600 from '@fontsource/inter/files/inter-cyrillic-600-normal.woff2';
import interCyr700 from '@fontsource/inter/files/inter-cyrillic-700-normal.woff2';
import deva600 from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-600-normal.woff2';
// Noto Sans SC разбит на куски по символам: 中 и 文 лежат в 119 и 118.
import sc118 from '@fontsource/noto-sans-sc/files/noto-sans-sc-118-600-normal.woff2';
import sc119 from '@fontsource/noto-sans-sc/files/noto-sans-sc-119-600-normal.woff2';

// Диапазоны как в @fontsource/inter: латиница и кириллица — разные файлы одного семейства.
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';

// Inter и Noto — под лицензией SIL OFL. loadFont сам держит рендер, пока шрифт не загрузится.
const faces: [string, string, string, string?][] = [
  ['Inter', inter300, '300', LATIN],
  ['Inter', inter400, '400', LATIN],
  ['Inter', inter500, '500', LATIN],
  ['Inter', inter600, '600', LATIN],
  ['Inter', inter700, '700', LATIN],
  ['Inter', interCyr300, '300', CYRILLIC],
  ['Inter', interCyr400, '400', CYRILLIC],
  ['Inter', interCyr500, '500', CYRILLIC],
  ['Inter', interCyr600, '600', CYRILLIC],
  ['Inter', interCyr700, '700', CYRILLIC],
  ['Noto Sans Devanagari', deva600, '600'],
  ['Noto Sans SC 118', sc118, '600'],
  ['Noto Sans SC 119', sc119, '600'],
];
for (const [family, url, weight, unicodeRange] of faces) {
  void loadFont({ family, url, weight, format: 'woff2', unicodeRange });
}

export const FONT =
  "'Inter', 'Noto Sans Devanagari', 'Noto Sans SC 118', 'Noto Sans SC 119', 'Noto Color Emoji', sans-serif";
