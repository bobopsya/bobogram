import { AbsoluteFill } from 'remotion';
import { BrowserFrame } from '../components/BrowserFrame';
import { PhoneFrame } from '../components/PhoneFrame';
import { cameraTransform, type Camera } from '../lib/camera';
import { CUE } from '../lib/cues';
import { BROWSER, BROWSER_SIZE, PHONE, PHONE_BODY, shot, type Theme } from '../lib/layout';
import { clamp01, fall, rise } from '../lib/motion';
import { PhoneScreen } from './PhoneScreen';

export const ICON_SIZE = 260;

/** Устройства в координатах мира; камера двигает их все вместе. */
export const World: React.FC<{ frame: number; theme: Theme; camera: Camera; icon: string }> = ({
  frame,
  theme,
  camera,
  icon,
}) => {
  const phoneIn = rise(frame, CUE.phoneIn);
  const browserX = (1 - rise(frame, CUE.browserIn)) * 1500 + fall(frame, CUE.browserOut) * 1500;
  const showBrowser = frame >= CUE.browserIn && frame < CUE.browserOut + 12;
  const morph = clamp01(rise(frame, CUE.morph));
  return (
    <AbsoluteFill style={{ transformOrigin: '0 0', transform: cameraTransform(camera) }}>
      {showBrowser && (
        <div
          style={{
            position: 'absolute',
            left: BROWSER.x - BROWSER_SIZE.w / 2 + browserX,
            top: BROWSER.y - BROWSER_SIZE.h / 2,
          }}
        >
          <BrowserFrame src={shot(`desktop-chat-${theme}`)} theme={theme} />
        </div>
      )}
      {morph > 0 && (
        // Свечение за иконкой в финале
        <div
          style={{
            position: 'absolute',
            left: PHONE.x - 420,
            top: PHONE.y - 420,
            width: 840,
            height: 840,
            borderRadius: '50%',
            opacity: morph,
            background:
              'radial-gradient(circle, rgba(143, 208, 255, 0.55) 0%, rgba(51, 144, 236, 0.22) 35%, rgba(51, 144, 236, 0) 68%)',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: PHONE.x - PHONE_BODY.w / 2,
          top: PHONE.y - PHONE_BODY.h / 2 + (1 - phoneIn) * 1020,
          width: PHONE_BODY.w,
          height: PHONE_BODY.h,
        }}
      >
        <PhoneFrame
          morph={morph}
          icon={icon}
          iconSize={ICON_SIZE}
          screenBg={theme === 'dark' ? '#212121' : '#ffffff'}
        >
          <PhoneScreen frame={frame} theme={theme} />
        </PhoneFrame>
      </div>
    </AbsoluteFill>
  );
};
