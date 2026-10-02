import { Composition } from 'remotion';
import './lib/fonts';
import { Promo } from './Promo';
import { DURATION, FPS, HEIGHT, WIDTH } from './lib/timing';

export const Root: React.FC = () => (
  <Composition
    id="Promo"
    component={Promo}
    durationInFrames={DURATION}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
