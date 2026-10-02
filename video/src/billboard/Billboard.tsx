import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import icon from '../../../public/icon.svg';
import { Background } from '../components/Background';
import { PhoneFrame } from '../components/PhoneFrame';
import { Crop } from '../components/Shot';
import { cameraTransform, toScreen, type Camera } from '../lib/camera';
import { C, SHADOW } from '../lib/colors';
import { FONT } from '../lib/fonts';
import { LAYOUT, PHONE, PHONE_BODY, PHONE_VIEWPORT, phonePoint, shot } from '../lib/layout';
import { clamp01 } from '../lib/motion';
import { BigType } from './BigType';
import { BigCaption } from './BigCaption';
import { BB_PHONE } from './layout';
import { BillboardScreen } from './Screen';
import { BB, BB_CAPTION_OUT, BB_DURATION, down, keys, loopWave, SCENES, up } from './timing';

const ICON = 300;
const out = (s: { to: number }) => s.to - BB_CAPTION_OUT;

/** Камера: почти неподвижна (билборд читают на ходу), в финале центрирует иконку и возвращается. */
function cameraAt(frame: number): Camera {
  const x = keys(frame, 960, [
    [BB.morph, BB_PHONE.x],
    [BB.cameraBack, 960],
  ]);
  const y = keys(frame, 540, [
    [BB.morph, 600],
    [BB.cameraBack, 540],
  ]);
  // Едва заметное «дыхание» камеры, замкнутое в петлю.
  return { x, y, s: 1 + 0.025 * loopWave(frame) };
}

/** Точка экрана телефона → кадр (телефон в билборде стоит в BB_PHONE). */
const phoneToScreen = (camera: Camera, px: number, py: number) => {
  const p = phonePoint(px, py);
  return toScreen(camera, p.x - PHONE.x + BB_PHONE.x, p.y - PHONE.y + BB_PHONE.y);
};

// Пузыри, которые разлетаются вокруг телефона в сцене «No phone. No email.»
const ROWS = LAYOUT.light.chatFull.rows;
const FANS = [
  { row: 1, x: 1250, y: 228, scale: 1.6 },
  { row: 2, x: 1640, y: 440, scale: 1.4 },
  { row: 4, x: 1270, y: 866, scale: 1.5 },
] as const;

/** Билборд «Just @username»: 15 с, 60 fps, бесшовная петля. */
export const Billboard: React.FC = () => {
  const frame = useCurrentFrame();
  const camera = cameraAt(frame);

  // Огромное @alex: печатается, улетает в поле логина; в конце петли «@» возвращается.
  const fly = frame < BB.fly || frame >= BB.atBack ? 0 : clamp01(up(frame, BB.fly));
  const typed = frame >= BB.atBack ? 0 : BB.type.filter((t) => frame >= t).length;
  const bigEnter = frame >= BB.atBack ? up(frame, BB.atBack) : 1;
  const field = LAYOUT.light.login.username;
  const fieldAt = toScreen(
    { x: 960, y: 540, s: 1 },
    phonePoint(field.x - 15, field.y + field.h / 2).x - PHONE.x + BB_PHONE.x,
    phonePoint(field.x, field.y + field.h / 2).y - PHONE.y + BB_PHONE.y,
  );

  const phoneIn = up(frame, BB.phoneIn);
  const morph = clamp01(up(frame, BB.morph));
  const lockupGone = down(frame, BB.lockupOut);
  const gather = clamp01(down(frame, BB.morph));
  const center = toScreen(camera, BB_PHONE.x, BB_PHONE.y);

  return (
    <AbsoluteFill style={{ background: C.navyDeep, fontFamily: FONT }}>
      <Background t={loopWave(frame)} parallax={{ x: 0, y: 0 }} />

      {/* Мир: телефон, который в финале становится иконкой */}
      {frame >= BB.phoneIn && (
        <AbsoluteFill style={{ transformOrigin: '0 0', transform: cameraTransform(camera) }}>
          {morph > 0 && (
            <div
              style={{
                position: 'absolute',
                left: BB_PHONE.x - 460,
                top: BB_PHONE.y - 460,
                width: 920,
                height: 920,
                borderRadius: '50%',
                opacity: morph * (1 - lockupGone),
                background:
                  'radial-gradient(circle, rgba(143, 208, 255, 0.55) 0%, rgba(51, 144, 236, 0.22) 35%, rgba(51, 144, 236, 0) 68%)',
              }}
            />
          )}
          <div
            style={{
              position: 'absolute',
              left: BB_PHONE.x - PHONE_BODY.w / 2,
              top: BB_PHONE.y - PHONE_BODY.h / 2 + (1 - phoneIn) * 1150,
              width: PHONE_BODY.w,
              height: PHONE_BODY.h,
              opacity: 1 - lockupGone,
              transform: `scale(${1 - 0.25 * lockupGone})`,
            }}
          >
            <PhoneFrame morph={morph} icon={icon} iconSize={ICON} screenBg="#ffffff">
              <BillboardScreen frame={frame} fly={fly} />
            </PhoneFrame>
          </div>
        </AbsoluteFill>
      )}

      {/* Подписи: 1–2 слова в строке, 168 px */}
      <Sequence from={SCENES.username.from} durationInFrames={SCENES.username.to} layout="none">
        <BigCaption
          frame={frame}
          out={out(SCENES.username)}
          lines={[
            { at: BB.fly, text: 'Just' },
            { at: BB.fly + 8, text: '@username.' },
          ]}
        />
      </Sequence>
      <Sequence
        from={SCENES.stories.from}
        durationInFrames={SCENES.stories.to - SCENES.stories.from}
        layout="none"
      >
        <BigCaption
          frame={frame}
          out={out(SCENES.stories)}
          lines={[{ at: SCENES.stories.from, text: 'Stories.' }]}
        />
      </Sequence>
      <Sequence
        from={SCENES.pollVoice.from}
        durationInFrames={SCENES.pollVoice.to - SCENES.pollVoice.from}
        layout="none"
      >
        <BigCaption
          frame={frame}
          out={out(SCENES.pollVoice)}
          lines={[
            { at: SCENES.pollVoice.from, text: 'Polls.' },
            { at: BB.voice, text: 'Voice.' },
          ]}
        />
      </Sequence>
      <Sequence
        from={SCENES.themes.from}
        durationInFrames={SCENES.themes.to - SCENES.themes.from}
        layout="none"
      >
        <BigCaption
          frame={frame}
          out={out(SCENES.themes)}
          lines={[
            { at: SCENES.themes.from, text: 'Make it' },
            { at: SCENES.themes.from + 8, text: 'yours.' },
          ]}
        />
      </Sequence>
      <Sequence
        from={SCENES.noPhone.from}
        durationInFrames={SCENES.finale.from + 30 - SCENES.noPhone.from}
        layout="none"
      >
        <BigCaption
          frame={frame}
          out={out(SCENES.noPhone)}
          lines={[
            { at: SCENES.noPhone.from, text: 'No phone.' },
            { at: SCENES.noPhone.from + 8, text: 'No email.' },
          ]}
        />
        {/* Настоящие пузыри из чата с Mia разлетаются вокруг телефона */}
        {FANS.map((f, i) => {
          const r = ROWS[f.row].bubble;
          const k = up(frame, BB.fans + 6 + i * 8);
          const from = phoneToScreen(camera, r.x + r.w / 2, r.y + r.h / 2);
          const float = Math.sin((frame - BB.fans) / 22 + i * 2) * 6;
          const x = from.x + (f.x - from.x) * k + (center.x - f.x) * gather;
          const y = from.y + (f.y - from.y) * k + float + (center.y - f.y) * gather;
          return (
            <div
              key={f.row}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: r.w,
                height: r.h,
                transform: `translate(-50%, -50%) scale(${(1 + (f.scale - 1) * k) * (1 - 0.6 * gather)})`,
                opacity: clamp01(k * 2) * (1 - clamp01(gather * 1.8)),
                borderRadius: 15,
                boxShadow: SHADOW,
              }}
            >
              <Crop
                src={shot('phone-chat-full-light')}
                rect={r}
                viewport={PHONE_VIEWPORT}
                radius={ROWS[f.row].style?.radius ?? 15}
                style={{ left: 0, top: 0 }}
              />
            </div>
          );
        })}
        {frame >= BB.fans && (
          <div
            style={{
              position: 'absolute',
              left: 1735 + (center.x - 1735) * gather,
              top: 760 + Math.sin((frame - BB.fans) / 18) * 6 + (center.y - 760) * gather,
              width: 108,
              height: 108,
              borderRadius: '50%',
              background: '#ffffff',
              boxShadow: SHADOW,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 60,
              transform: `translate(-50%, -50%) scale(${Math.max(0, up(frame, BB.fans + 30)) * (1 - 0.6 * gather)})`,
              opacity: 1 - clamp01(gather * 1.8),
            }}
          >
            👍
          </div>
        )}
      </Sequence>

      {/* Финал: bobogram.org под иконкой */}
      <Sequence from={BB.url} durationInFrames={BB_DURATION - BB.url} layout="none">
        <BigCaption
          frame={frame}
          out={BB.lockupOut}
          align="center"
          y={790}
          size={150}
          lines={[{ at: BB.url, text: 'bobogram.org' }]}
        />
      </Sequence>

      {/* Огромное @alex — начало и конец петли */}
      {(frame < BB.fly + 40 || frame >= BB.atBack) && (
        <BigType
          frame={frame}
          typed={typed}
          times={BB.type}
          fly={fly}
          target={{ x: fieldAt.x, y: fieldAt.y, size: LAYOUT.light.login.fontSize }}
          enter={bigEnter}
        />
      )}
    </AbsoluteFill>
  );
};
