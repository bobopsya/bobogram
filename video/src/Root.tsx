import { Composition } from 'remotion';
import './lib/fonts';
import { Billboard } from './billboard/Billboard';
import { BB_DURATION, BB_FPS } from './billboard/timing';
import { Metro } from './metro/Metro';
import { M_DURATION, M_FPS } from './metro/timing';
import { Promo } from './Promo';
import { DURATION, FPS, HEIGHT, WIDTH } from './lib/timing';

export const Root: React.FC = () => (
  <>
    <Composition
      id="Promo"
      component={Promo}
      durationInFrames={DURATION}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    {/* Билборд: 15 с, 60 fps, петля */}
    <Composition
      id="Billboard"
      component={Billboard}
      durationInFrames={BB_DURATION}
      fps={BB_FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    {/* В духе рекламы Windows 8: 60 fps, длина и монтаж — по лицензированному треку (сам звук не вшит) */}
    <Composition
      id="Metro"
      component={Metro}
      durationInFrames={M_DURATION}
      fps={M_FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  </>
);
