import { AbsoluteFill, useCurrentFrame } from 'remotion';
import icon from '../../public/icon.svg';
import { Background } from './components/Background';
import { cameraAt } from './lib/camera';
import { C } from './lib/colors';
import { CUE } from './lib/cues';
import { FONT } from './lib/fonts';
import { drift, rise } from './lib/motion';
import { FREEZE, HEIGHT, WIDTH } from './lib/timing';
import { Hud, TOGGLE_AT } from './scenes/Hud';
import { World } from './scenes/World';

/** Радиус круговой шторки: от переключателя до дальнего угла телефона, с запасом. */
const WIPE_R = 1150;
const WIPE_DONE = CUE.wipe + 30;

/** Промо Bobogram: один непрерывный кадр, 15 с, 120 BPM. */
export const Promo: React.FC = () => {
  const frame = useCurrentFrame();
  const camera = cameraAt(frame);
  // Шторка — та же пружина, растянутая на 24 кадра, чтобы смену темы было видно.
  const wipe = Math.max(0, rise(frame, CUE.wipe, 24)) * WIPE_R;
  return (
    <AbsoluteFill style={{ background: C.navyDeep, fontFamily: FONT }}>
      <Background t={drift(frame, FREEZE)} parallax={{ x: camera.x - WIDTH / 2, y: camera.y - HEIGHT / 2 }} />
      {frame < WIPE_DONE && <World frame={frame} theme="light" camera={camera} icon={icon} />}
      {frame >= CUE.wipe && (
        // Тёмная тема раскрывается кругом от переключателя — сразу на телефоне и на ПК.
        <AbsoluteFill
          style={{
            clipPath:
              frame < WIPE_DONE ? `circle(${wipe}px at ${TOGGLE_AT.x}px ${TOGGLE_AT.y}px)` : undefined,
          }}
        >
          <World frame={frame} theme="dark" camera={camera} icon={icon} />
        </AbsoluteFill>
      )}
      <Hud frame={frame} camera={camera} icon={icon} />
    </AbsoluteFill>
  );
};
