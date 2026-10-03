import { interpolate } from 'remotion';
import { Crop, Shot } from '../components/Shot';
import { C } from '../lib/colors';
import { FONT } from '../lib/fonts';
import { PHONE_VIEWPORT, type Row } from '../lib/layout';
import { clamp01 } from '../lib/motion';
import { RU, ru } from './layout';
import { up } from './timing';

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
        background: 'rgba(51, 144, 236, 0.3)',
        transform: `scale(${0.4 + 0.9 * t})`,
        opacity: 1 - t,
      }}
    />
  );
};

// Обои чата «sky» (src/app/themes.ts) — тот же CSS, что у .chat-screen на весь экран.
const SKY = 'linear-gradient(160deg, #cfe8ff 0%, #e8f3ff 50%, #fdfbff 100%)';

/**
 * Новый пузырь: кусок настоящего экрана «выпрыгивает» на своём месте. Под ним — обои чата,
 * чтобы на снимке «после» пузырь не стоял заранее.
 */
const Pop: React.FC<{ frame: number; at: number; src: string; row: Row }> = ({ frame, at, src, row }) => {
  if (frame < at) return null;
  const k = up(frame, at);
  const b = row.bubble;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: SKY,
          clipPath: `inset(${b.y - 2}px ${V.w - b.x - b.w - 2}px ${V.h - b.y - b.h - 3}px ${b.x - 2}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: clamp01(k * 1.6),
          transformOrigin: `${row.own ? b.x + b.w : b.x}px ${b.y + b.h}px`,
          transform: `translateY(${(1 - k) * 18}px) scale(${0.72 + 0.28 * k})`,
        }}
      >
        <Crop
          src={src}
          rect={b}
          viewport={V}
          radius={row.style?.radius ?? 15}
          style={{ boxShadow: '0 1px 1px rgba(0, 0, 0, 0.12)' }}
        />
      </div>
    </>
  );
};

/** Список чатов → кольцо сторис у Mia пульсирует → сторис раскрывается кругом, бежит прогресс. */
export const StoriesScreen: React.FC<{ frame: number; ring: number; open: number; end: number }> = ({
  frame,
  ring,
  open,
  end,
}) => {
  const av = RU.chats.storyAvatar;
  const cx = av.x + av.w / 2;
  const cy = av.y + av.h / 2;
  const k = Math.max(0, up(frame, open));
  const progress = interpolate(frame, [open + 8, end], [0, 1], clampI);
  const bar = RU.story.progress;
  const pulseRing = (at: number) => {
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
  return (
    <>
      <Shot src={ru('chats')} w={V.w} h={V.h} />
      {pulseRing(ring)}
      {pulseRing(ring + 15)}
      <Tap frame={frame} at={open - 6} x={cx} y={cy} />
      {k > 0.001 && (
        <div style={{ position: 'absolute', inset: 0, clipPath: `circle(${k * 950}px at ${cx}px ${cy}px)` }}>
          <div
            style={{ position: 'absolute', inset: 0, transform: `scale(${1.08 - 0.08 * Math.min(1, k)})` }}
          >
            <Shot src={ru('story')} w={V.w} h={V.h} />
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

/** Чат с Mia: в поле ввода по буквам печатается фраза, на доле она уходит пузырём. */
export const TypingScreen: React.FC<{ frame: number; text: string; times: number[]; send: number }> = ({
  frame,
  text,
  times,
  send,
}) => {
  const c = RU.mia.composer;
  const chars = Array.from(text);
  const n = times.filter((t) => frame >= t).length;
  const caret = frame < send && (frame - (times[n - 1] ?? 0) < 12 || Math.floor(frame / 30) % 2 === 0);
  const sent = clamp01(up(frame, send, 8));
  const rows = RU.miaSent.rows;
  return (
    <>
      <Shot src={ru('mia')} w={V.w} h={V.h} />
      {frame >= times[0] && sent < 1 && (
        <div style={{ opacity: 1 - sent }}>
          {/* Плейсхолдер «Сообщение» закрываем цветом поля и печатаем поверх */}
          <div
            style={{
              position: 'absolute',
              left: c.x + 4,
              top: c.y + 4,
              width: c.w - 8,
              height: c.h - 8,
              background: c.bg,
              borderRadius: 10,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: c.x + c.paddingLeft,
              top: c.y,
              height: c.h,
              maxWidth: c.w - c.paddingLeft - 6,
              display: 'flex',
              alignItems: 'center',
              fontFamily: FONT,
              fontSize: c.font,
              color: c.color,
              whiteSpace: 'pre',
              overflow: 'hidden',
            }}
          >
            {chars.slice(0, n).join('')}
            {caret && (
              <span style={{ width: 1.5, height: c.font * 1.2, marginLeft: 1, background: C.brand }} />
            )}
          </div>
        </div>
      )}
      {sent > 0 && (
        <>
          <Shot src={ru('mia-sent')} w={V.w} h={V.h} style={{ opacity: sent }} />
          <Pop frame={frame} at={send} src={ru('mia-sent')} row={rows[rows.length - 1]} />
        </>
      )}
    </>
  );
};

/** Опрос в группе «Друзья»: Alex голосует — полосы растут. */
export const PollScreen: React.FC<{ frame: number; vote: number }> = ({ frame, vote }) => {
  const g = RU.group;
  const voted = clamp01(up(frame, vote + 4, 8));
  const grow = up(frame, vote + 4);
  const opt = g.options[0];
  return (
    <>
      <Shot src={ru('group-poll')} w={V.w} h={V.h} />
      {voted > 0 && <Shot src={ru('group-voted')} w={V.w} h={V.h} style={{ opacity: voted }} />}
      {frame >= vote + 4 &&
        g.bars.map((bar, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: bar.x,
              top: bar.y,
              width: Math.max(0, bar.w * grow),
              height: bar.h,
              borderRadius: 8,
              background: bar.color,
            }}
          />
        ))}
      <Tap frame={frame} at={vote} x={opt.x + 60} y={opt.y + opt.h / 2} />
    </>
  );
};

/** «Где собираемся?» → на доле приходит «В нашем любимом кафе! ☕». */
export const CafeScreen: React.FC<{ frame: number; answer: number }> = ({ frame, answer }) => {
  const shown = clamp01(up(frame, answer, 6));
  const rows = RU.groupA.rows;
  return (
    <>
      <Shot src={ru('group-q')} w={V.w} h={V.h} />
      {shown > 0 && (
        <>
          <Shot src={ru('group-a')} w={V.w} h={V.h} style={{ opacity: shown }} />
          <Pop frame={frame} at={answer} src={ru('group-a')} row={rows[rows.length - 1]} />
        </>
      )}
    </>
  );
};
