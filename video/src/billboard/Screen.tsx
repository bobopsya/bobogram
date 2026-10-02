import { interpolate } from 'remotion';
import { Crop, Shot } from '../components/Shot';
import { C } from '../lib/colors';
import { FONT } from '../lib/fonts';
import { LAYOUT, PHONE_VIEWPORT, shot } from '../lib/layout';
import { clamp01 } from '../lib/motion';
import { BBL, bbShot, THEME_COUNT } from './layout';
import { BB, down, up } from './timing';

const V = PHONE_VIEWPORT;
const clampI = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Касание пальцем: кружок-рябь. */
const Tap: React.FC<{ frame: number; at: number; x: number; y: number }> = ({ frame, at, x, y }) => {
  const t = interpolate(frame - at, [0, 18], [0, 1], clampI);
  if (frame < at || t >= 1) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 30,
        top: y - 30,
        width: 60,
        height: 60,
        borderRadius: '50%',
        background: 'rgba(51, 144, 236, 0.28)',
        transform: `scale(${0.4 + 0.9 * t})`,
        opacity: 1 - t,
      }}
    />
  );
};

/** Вход: в поле уже «прилетело» alex, точки пароля, нажатие Sign in. */
const Login: React.FC<{ frame: number; fly: number }> = ({ frame, fly }) => {
  const L = LAYOUT.light.login;
  const dots = BB.pass.filter((t) => frame >= t).length;
  const press = clamp01(up(frame, BB.press, 10)) - clamp01(up(frame, BB.press + 10, 16));
  const ring = (r: typeof L.usernameBox, on: boolean) =>
    on && (
      <div
        style={{
          position: 'absolute',
          left: r.x,
          top: r.y,
          width: r.w,
          height: r.h,
          borderRadius: 12,
          border: `1px solid ${C.brand}`,
        }}
      />
    );
  return (
    <>
      <Shot src={shot('phone-login-light')} w={V.w} h={V.h} />
      {ring(L.usernameBox, fly > 0.5 && frame < BB.pass[0])}
      {ring(L.password, frame >= BB.pass[0] && frame < BB.press)}
      <div
        style={{
          position: 'absolute',
          left: L.username.x + L.paddingLeft,
          top: L.username.y,
          height: L.username.h,
          display: 'flex',
          alignItems: 'center',
          fontFamily: FONT,
          fontSize: L.fontSize,
          color: C.appInk,
          opacity: clamp01((fly - 0.6) / 0.4),
        }}
      >
        alex
      </div>
      <div
        style={{
          position: 'absolute',
          left: L.password.x + L.passwordPaddingLeft,
          top: L.password.y,
          height: L.password.h,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {Array.from({ length: dots }, (_, i) => (
          <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: C.appInk }} />
        ))}
      </div>
      <Crop
        src={shot('phone-login-light')}
        rect={L.button}
        viewport={V}
        radius={12}
        style={{ transform: `scale(${1 - 0.05 * press})`, filter: `brightness(${1 - 0.12 * press})` }}
      />
    </>
  );
};

/** Список чатов: кольцо сторис у Mia пульсирует, касание открывает сторис кругом от аватара. */
const ListAndStory: React.FC<{ frame: number }> = ({ frame }) => {
  const av = BBL.chats.storyAvatar;
  const cx = av.x + av.w / 2;
  const cy = av.y + av.h / 2;
  const pulse = (at: number) => {
    const t = interpolate(frame - at, [0, 24], [0, 1], clampI);
    return frame >= at && t < 1 ? (
      <div
        key={at}
        style={{
          position: 'absolute',
          left: cx - 34,
          top: cy - 34,
          width: 68,
          height: 68,
          borderRadius: '50%',
          border: `3px solid ${C.brand}`,
          transform: `scale(${1 + 0.6 * t})`,
          opacity: 1 - t,
        }}
      />
    ) : null;
  };
  const open = Math.max(0, up(frame, BB.storyOpen)) * (1 - down(frame, BB.storyClose));
  const progress = interpolate(frame, [BB.storyOpen + 8, BB.storyClose], [0, 1], clampI);
  const bar = BBL.story.progress;
  return (
    <>
      <Shot src={bbShot('chats-light')} w={V.w} h={V.h} />
      {pulse(BB.ring)}
      {pulse(BB.ring + 15)}
      <Tap frame={frame} at={BB.storyOpen - 6} x={cx} y={cy} />
      {open > 0.001 && (
        <div
          style={{ position: 'absolute', inset: 0, clipPath: `circle(${open * 950}px at ${cx}px ${cy}px)` }}
        >
          <div
            style={{ position: 'absolute', inset: 0, transform: `scale(${1.08 - 0.08 * Math.min(1, open)})` }}
          >
            <Shot src={bbShot('story-light')} w={V.w} h={V.h} />
          </div>
          <div
            style={{
              position: 'absolute',
              left: bar.x,
              top: bar.y,
              width: bar.w * progress,
              height: bar.h,
              borderRadius: 2,
              background: '#ffffff',
            }}
          />
        </div>
      )}
    </>
  );
};

/** Группа: Alex голосует — полосы опроса растут; Mia прислала голосовое — оно проигрывается. */
const Group: React.FC<{ frame: number }> = ({ frame }) => {
  const G = BBL.group;
  const voted = clamp01(up(frame, BB.vote + 6, 12));
  const grow = up(frame, BB.vote + 6);
  const playing = clamp01(up(frame, BB.voice, 8));
  const played = interpolate(frame, [BB.voice + 4, BB.voiceEnd], [0, 1], clampI);
  const opt = G.options[0];
  return (
    <>
      <Shot src={bbShot('group-light')} w={V.w} h={V.h} />
      {voted > 0 && <Shot src={bbShot('group-voted-light')} w={V.w} h={V.h} style={{ opacity: voted }} />}
      {frame >= BB.vote + 6 &&
        BBL.voted.bars.map((bar, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: G.options[i].x,
              top: G.options[i].y,
              width: Math.max(0, bar.w * grow),
              height: G.options[i].h,
              borderRadius: bar.radius,
              background: bar.color,
            }}
          />
        ))}
      <Tap frame={frame} at={BB.vote} x={opt.x + 60} y={opt.y + opt.h / 2} />
      {frame >= BB.voice && (
        <>
          <Crop
            src={bbShot('group-played-light')}
            rect={G.play}
            viewport={V}
            radius="50%"
            style={{ opacity: playing }}
          />
          <Crop
            src={bbShot('group-played-light')}
            rect={G.wave}
            viewport={V}
            style={{ width: G.wave.w * played }}
          />
        </>
      )}
      <Tap frame={frame} at={BB.voice - 4} x={G.play.x + G.play.w / 2} y={G.play.y + G.play.h / 2} />
    </>
  );
};

/** Оформление: на каждом ударе чат перекрашивается кругом из правого верхнего угла. */
const Themes: React.FC<{ frame: number }> = ({ frame }) => {
  const steps = BB.themes.map((at, i) => ({ at, n: (i % THEME_COUNT) + 1 }));
  const active = steps.filter((s) => frame >= s.at).slice(-2);
  return (
    <>
      {active.map((s) => (
        <div
          key={s.at}
          style={{
            position: 'absolute',
            inset: 0,
            clipPath: `circle(${Math.max(0, up(frame, s.at, 24)) * 980}px at ${V.w}px 0px)`,
          }}
        >
          <Shot src={bbShot(`theme-${s.n}`)} w={V.w} h={V.h} />
        </div>
      ))}
    </>
  );
};

/** Всё, что показывает экран телефона в билборде. */
export const BillboardScreen: React.FC<{ frame: number; fly: number }> = ({ frame, fly }) => {
  const toList = clamp01(up(frame, BB.toList));
  const loginOut = clamp01(toList / 0.5);
  const listIn = clamp01((toList - 0.45) / 0.55);
  const push = clamp01(up(frame, BB.group));
  return (
    <>
      {loginOut < 1 && (
        <div style={{ position: 'absolute', inset: 0, opacity: 1 - loginOut }}>
          <Login frame={frame} fly={fly} />
        </div>
      )}
      {listIn > 0 && frame < BB.group + 40 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: listIn,
            transform: `translateY(${(1 - listIn) * 16}px) translateX(${-110 * push}px)`,
          }}
        >
          <ListAndStory frame={frame} />
          <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: 0.18 * push }} />
        </div>
      )}
      {frame >= BB.group && frame < BB.themes[0] + 40 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translateX(${(1 - up(frame, BB.group)) * V.w}px)`,
            boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.12)',
          }}
        >
          <Group frame={frame} />
        </div>
      )}
      {frame >= BB.themes[0] && <Themes frame={frame} />}
    </>
  );
};
