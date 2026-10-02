import { interpolate } from 'remotion';
import { Crop, Shot } from '../components/Shot';
import { TypingDots } from '../components/TypingDots';
import { C } from '../lib/colors';
import { CUE } from '../lib/cues';
import { FONT } from '../lib/fonts';
import { LAYOUT, PHONE_VIEWPORT, shot, type Row, type Theme } from '../lib/layout';
import { clamp01, fall, rise, track } from '../lib/motion';

const V = PHONE_VIEWPORT;

/** Скругление пузыря как в приложении: «хвостик» у последнего в серии. */
const radiusOf = (r: Row) => r.style?.radius ?? '15px';

/**
 * Переписка с Mia. Каждый пузырь — кусок настоящего скриншота отдельным слоем:
 * пузыри появляются на ударах, старые съезжают вверх, реакция «выстреливает»,
 * Mia печатает, потом сообщение уходит без сети и доходит.
 */
export const ChatThread: React.FC<{ frame: number; theme: Theme }> = ({ frame, theme }) => {
  const L = LAYOUT[theme];
  const full = L.chatFull.rows; // [дата, m1, m2, m3 (ответ + реакция), m4]
  const sent = L.chatSent.rows; // то же + «On my way!»
  const src = shot(`phone-chat-full-${theme}`);
  const b = (i: number) => full[i].bubble;
  const bottomOf = (i: number, h = b(i).h) => b(i).y + h;
  const anchor = bottomOf(4);

  // Реакция: пузырь ответа сначала без строки реакций, потом дорастает.
  const reactions = full[3].reactions!;
  const cut = reactions.y - b(3).y;
  const grow = clamp01(rise(frame, CUE.react));
  const m3Height = cut + (b(3).h - cut) * Math.min(1, rise(frame, CUE.react));

  // Лента прижата к низу: каждое новое сообщение поднимает предыдущие.
  const sentShift = b(4).y - sent[4].bubble.y;
  const shift = track(frame, anchor - bottomOf(1), [
    [CUE.m2, anchor - bottomOf(2)],
    [CUE.m3, anchor - bottomOf(3, cut)],
    [CUE.react, anchor - bottomOf(3)],
    [CUE.typing, 0],
    [CUE.offlineMsg, -sentShift],
  ]);

  const pop = (at: number, own: boolean, i: number, children: React.ReactNode) => {
    if (frame < at) return null;
    const k = rise(frame, at);
    const r = full[i]?.bubble ?? b(4);
    const ox = own ? r.x + r.w : r.x;
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: clamp01(k * 1.6),
          transformOrigin: `${ox}px ${r.y + r.h}px`,
          transform: `translateY(${shift + (1 - k) * 18}px) scale(${0.72 + 0.28 * k})`,
        }}
      >
        {children}
      </div>
    );
  };

  const bubble = (i: number, height?: number) => (
    <Crop
      src={src}
      rect={b(i)}
      viewport={V}
      height={height}
      radius={full[i].system ? b(i).h / 2 : radiusOf(full[i])}
      style={{ boxShadow: full[i].system ? undefined : '0 1px 1px rgba(0, 0, 0, 0.12)' }}
    />
  );

  // Одна галочка (отправлено) из кадра «On my way!» поверх двойной, пока Mia не прочитала.
  const singleTick = sent[5].tick!;
  const m2Tick = full[2].tick!;
  const read = frame >= CUE.read;

  // «Печатает…»: пузырь с точками на месте будущего сообщения и статус в шапке.
  const typingIn = rise(frame, CUE.typing);
  const typingOut = fall(frame, CUE.m4);
  const typingOn = frame >= CUE.typing ? clamp01(typingIn) * (1 - typingOut) : 0;

  // Реакция 👍: большой палец взлетает над пузырём и оседает в чип.
  // Реакция 👍: выстреливает рядом с пузырём (справа от него пусто), а в пузыре появляется чип.
  const chip = full[3].reaction!;
  const ring = interpolate(frame - CUE.react, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const shoot = rise(frame, CUE.react);
  const shootOut = fall(frame, CUE.typing - 4);

  // Офлайн: сообщение с часиками, на ударе — галочка.
  const offlineSrc = L.chatOffline ? shot(`phone-chat-offline-${theme}`) : shot(`phone-chat-sent-${theme}`);
  const offlineRow = (L.chatOffline ?? L.chatSent).rows[5];
  const delivered = clamp01(rise(frame, CUE.sent, 6));

  const messages = L.chat.messages;
  return (
    <>
      <Shot src={shot(`phone-chat-empty-${theme}`)} w={V.w} h={V.h} />
      {/* Статус в шапке: «typing…» вместо «last seen recently» */}
      {typingOn > 0 && (
        <div
          style={{
            position: 'absolute',
            left: L.chat.status.x,
            top: L.chat.status.y,
            width: L.chat.status.w + 4,
            height: L.chat.status.h,
            background: L.chat.headerBg,
            opacity: typingOn,
            fontFamily: FONT,
            fontSize: L.chat.statusStyle.font,
            lineHeight: L.chat.statusStyle.lineHeight,
            color: theme === 'dark' ? C.appDarkAccent : C.brand,
          }}
        >
          typing…
        </div>
      )}
      {/* Лента сообщений, обрезанная по своей области между шапкой и полем ввода */}
      <div
        style={{
          position: 'absolute',
          left: messages.x,
          top: messages.y,
          width: messages.w,
          height: messages.h,
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', left: -messages.x, top: -messages.y, width: V.w, height: V.h }}>
          {pop(CUE.m1, false, 0, bubble(0))}
          {pop(CUE.m1, false, 1, bubble(1))}
          {pop(
            CUE.m2,
            true,
            2,
            <>
              {bubble(2)}
              {!read && (
                <Crop
                  src={shot(`phone-chat-sent-dark`)}
                  rect={singleTick}
                  viewport={V}
                  style={{ left: m2Tick.x, top: m2Tick.y }}
                />
              )}
            </>,
          )}
          {pop(
            CUE.m3,
            false,
            3,
            <>
              {bubble(3, m3Height)}
              {frame >= CUE.react && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      left: chip.x + chip.w / 2 - 30,
                      top: chip.y + chip.h / 2 - 30,
                      width: 60,
                      height: 60,
                      borderRadius: '50%',
                      border: `2px solid ${C.brand}`,
                      opacity: (1 - ring) * grow,
                      transform: `scale(${0.4 + 1.1 * ring})`,
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: b(3).x + b(3).w + 10,
                      top: b(3).y + 12,
                      width: 52,
                      height: 52,
                      borderRadius: '50%',
                      background: theme === 'dark' ? '#2c2c2c' : '#ffffff',
                      boxShadow: '0 6px 18px rgba(10, 31, 68, 0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 30,
                      lineHeight: 1,
                      transformOrigin: '0% 100%',
                      transform: `translateY(${(1 - shoot) * 26 - 10 * shootOut}px) scale(${Math.max(0, shoot) * (1 - 0.4 * shootOut)}) rotate(${(1 - shoot) * -25}deg)`,
                      opacity: clamp01(shoot * 2) * (1 - shootOut),
                    }}
                  >
                    👍
                  </div>
                </>
              )}
            </>,
          )}
          {typingOn > 0 && frame < CUE.m4 + 10 && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: typingOn,
                transformOrigin: `${b(4).x}px ${anchor}px`,
                transform: `translateY(${shift}px) scale(${0.72 + 0.28 * Math.min(1, typingIn)})`,
              }}
            >
              <TypingDots frame={frame} theme={theme} style={{ left: b(4).x, top: anchor - 33.6 }} />
            </div>
          )}
          {pop(CUE.m4, false, 4, bubble(4))}
          {frame >= CUE.offlineMsg && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                opacity: clamp01(rise(frame, CUE.offlineMsg) * 1.6),
                transformOrigin: `${offlineRow.bubble.x + offlineRow.bubble.w}px ${offlineRow.bubble.y + offlineRow.bubble.h}px`,
                transform: `translateY(${shift + sentShift + (1 - rise(frame, CUE.offlineMsg)) * 18}px) scale(${0.72 + 0.28 * rise(frame, CUE.offlineMsg)})`,
              }}
            >
              <Crop src={offlineSrc} rect={offlineRow.bubble} viewport={V} radius={radiusOf(offlineRow)} />
              <Crop
                src={shot(`phone-chat-sent-${theme}`)}
                rect={sent[5].bubble}
                viewport={V}
                radius={radiusOf(sent[5])}
                style={{ opacity: delivered }}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
};
