import { interpolate, Sequence } from 'remotion';
import { Caption } from '../components/Caption';
import { LangChips, type Chip } from '../components/LangChips';
import { Logo } from '../components/Logo';
import { OfflineBadge } from '../components/OfflineBadge';
import { QrCard } from '../components/QrCard';
import { Crop } from '../components/Shot';
import { ThemeToggle } from '../components/ThemeToggle';
import { toScreen, type Camera } from '../lib/camera';
import { CUE } from '../lib/cues';
import { LAYOUT, PHONE, PHONE_VIEWPORT, shot } from '../lib/layout';
import { clamp01, fall, lerp, rise } from '../lib/motion';
import { CAPTION_OUT, DURATION, SCENE } from '../lib/timing';

/** Центр переключателя темы на экране — отсюда же круговой wipe. */
export const TOGGLE_AT = { x: 1480, y: 872 } as const;

const CHIPS: Chip[] = [
  { label: 'EN', x: 1030, y: 300, side: 'left', active: true },
  { label: 'RU', x: 1490, y: 262, side: 'right' },
  { label: 'हिन्दी', x: 1490, y: 470, side: 'right' },
  { label: '中文', x: 1490, y: 678, side: 'right' },
];
const BADGE_AT = { x: 1030, y: 806 };

const out = (scene: { to: number }) => scene.to - CAPTION_OUT;

/** Всё, что не двигается вместе с камерой: подписи, логотип, карточки, чипы. */
export const Hud: React.FC<{ frame: number; camera: Camera; icon: string }> = ({ frame, camera, icon }) => {
  // 1. Логотип вырастает из точки и уходит влево-вверх, к подписи.
  const grow = rise(frame, CUE.logoGrow);
  const dock = rise(frame, CUE.logoDock);
  const logoGone = fall(frame, out(SCENE.login));
  const logoSize = lerp(220, 96, dock) * grow;

  // 2. QR-карточка вылетает снизу, чуть вращается, сканер-рамка щёлкает, карточка улетает в телефон.
  const qrIn = rise(frame, CUE.qrIn);
  const qrOut = fall(frame, CUE.qrOut);
  const phoneOnScreen = toScreen(camera, PHONE.x, PHONE.y);
  const qrX = lerp(1010, phoneOnScreen.x, qrOut);
  const qrY = lerp(545 + (1 - qrIn) * 900, phoneOnScreen.y, qrOut);
  const sway = Math.sin((frame - CUE.qrIn) / 11);
  const flash = interpolate(frame - CUE.scan, [0, 2, 12], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const avatar = LAYOUT.light.search.avatar;

  // 5–6. Чипы и плашка офлайна; в финале всё стягивается в телефон.
  const gather = clamp01(fall(frame, CUE.gather));

  return (
    <>
      <Sequence from={SCENE.login.from} durationInFrames={SCENE.login.to} layout="none">
        <Logo
          src={icon}
          size={logoSize}
          glow={(1 - dock * 0.6) * (1 + 0.8 * (1 - clamp01(frame / 12)))}
          style={{
            left: lerp(960, 168, dock) - logoSize / 2,
            top: lerp(540, 392, dock) - logoSize / 2 - logoGone * 40,
            opacity: 1 - logoGone,
          }}
        />
        <Caption
          frame={frame}
          out={out(SCENE.login)}
          phrases={[
            { at: CUE.logoDock, text: 'No phone.' },
            { at: CUE.usernameFocus, text: 'No email.', append: true },
            { at: 45, text: 'Just @username.' },
          ]}
        />
      </Sequence>

      <Sequence from={SCENE.search.from} durationInFrames={SCENE.search.to - SCENE.search.from} layout="none">
        <Caption
          frame={frame}
          out={out(SCENE.search)}
          phrases={[
            { at: SCENE.search.from, text: 'Find friends.' },
            { at: CUE.qrIn, text: 'Scan a QR.' },
          ]}
        />
      </Sequence>
      <Sequence from={CUE.qrIn} durationInFrames={CUE.qrOut + 12 - CUE.qrIn} layout="none">
        <div
          style={{
            position: 'absolute',
            left: qrX,
            top: qrY,
            opacity: clamp01(qrIn * 2) * (1 - qrOut),
            transform: `translate(-50%, -50%) perspective(1400px) rotateY(${-14 + 8 * qrIn + 3 * sway}deg) rotateZ(${-9 + 6 * qrIn + sway}deg) scale(${1 - 0.85 * qrOut})`,
          }}
        >
          <QrCard
            icon={icon}
            scan={rise(frame, CUE.scan)}
            flash={flash}
            avatar={
              <div
                style={{
                  position: 'absolute',
                  width: avatar.w,
                  height: avatar.h,
                  transform: `scale(${64 / avatar.w})`,
                  transformOrigin: '0 0',
                }}
              >
                <Crop
                  src={shot('phone-search-light')}
                  rect={avatar}
                  viewport={PHONE_VIEWPORT}
                  style={{ left: 0, top: 0 }}
                />
              </div>
            }
          />
        </div>
      </Sequence>

      <Sequence from={SCENE.chat.from} durationInFrames={SCENE.chat.to - SCENE.chat.from} layout="none">
        <Caption
          frame={frame}
          out={out(SCENE.chat)}
          phrases={[{ at: SCENE.chat.from, text: 'Chats that feel alive.' }]}
        />
      </Sequence>

      <Sequence
        from={SCENE.devices.from}
        durationInFrames={SCENE.devices.to - SCENE.devices.from}
        layout="none"
      >
        <Caption
          frame={frame}
          out={out(SCENE.devices)}
          phrases={[
            { at: SCENE.devices.from, text: 'Light.' },
            { at: CUE.wipe, text: 'Dark.', append: true },
            { at: CUE.wipe + 15, text: 'Every device.' },
          ]}
        />
      </Sequence>
      <Sequence from={CUE.toggleIn} durationInFrames={out(SCENE.devices) + 10 - CUE.toggleIn} layout="none">
        <ThemeToggle
          enter={rise(frame, CUE.toggleIn) * (1 - fall(frame, out(SCENE.devices)))}
          on={rise(frame, CUE.wipe)}
          press={interpolate(frame - CUE.wipe, [-3, 0, 6], [0, 1, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })}
          style={{ left: TOGGLE_AT.x, top: TOGGLE_AT.y }}
        />
      </Sequence>

      <Sequence
        from={SCENE.langs.from}
        durationInFrames={SCENE.finale.from + 12 - SCENE.langs.from}
        layout="none"
      >
        <Caption
          frame={frame}
          out={out(SCENE.langs)}
          phrases={[{ at: SCENE.langs.from, text: '4 languages.' }]}
        />
        <LangChips chips={CHIPS} frame={frame} at={CUE.chips} gather={gather} to={phoneOnScreen} />
        <OfflineBadge
          enter={rise(frame, CUE.chips + 4) * (1 - clamp01(gather * 1.8))}
          done={rise(frame, CUE.sent)}
          style={{
            left: BADGE_AT.x,
            top: BADGE_AT.y,
            transform: `translate(-100%, -50%) translate(${(phoneOnScreen.x - BADGE_AT.x) * gather}px, ${(phoneOnScreen.y - BADGE_AT.y) * gather + (1 - rise(frame, CUE.chips + 4)) * 50}px) scale(${1 - 0.7 * gather})`,
          }}
        />
      </Sequence>

      <Sequence from={CUE.url} durationInFrames={DURATION - CUE.url} layout="none">
        <Caption
          frame={frame}
          out={DURATION + 100}
          align="center"
          y={706}
          size={96}
          phrases={[{ at: CUE.url, text: 'bobogram.org' }]}
        />
      </Sequence>
    </>
  );
};
