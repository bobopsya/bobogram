import { Img } from 'remotion';
import { PHONE, PHONE_BODY, PHONE_VIEWPORT } from '../lib/layout';
import { SHADOW } from '../lib/colors';
import { clamp01, lerp } from '../lib/motion';

interface Props {
  children: React.ReactNode;
  /** Финал: 0 — телефон, 1 — телефон стал иконкой приложения. */
  morph?: number;
  icon: string;
  iconSize: number;
  /** Цвет экрана под скриншотами (виден в переходах). */
  screenBg: string;
}

/**
 * Минималистичный телефон: тонкий чёрный корпус, скругление, без бликов.
 * В финале экран гаснет, корпус заливается градиентом иконки, сжимается в квадрат
 * и на нём проявляется знак — телефон превращается в иконку из public/icon.svg.
 */
export const PhoneFrame: React.FC<Props> = ({ children, morph = 0, icon, iconSize, screenBg }) => {
  const w = lerp(PHONE_BODY.w, iconSize, morph);
  const h = lerp(PHONE_BODY.h, iconSize, morph);
  // У иконки скругление 112 из 512.
  const radius = lerp(PHONE.radius, (iconSize * 112) / 512, morph);
  const bezel = PHONE.bezel * (1 - morph);
  const fill = clamp01(morph * 2.5);
  const mark = clamp01((morph - 0.72) / 0.28);
  return (
    <div
      style={{
        position: 'absolute',
        left: (PHONE_BODY.w - w) / 2,
        top: (PHONE_BODY.h - h) / 2,
        width: w,
        height: h,
        borderRadius: radius,
        background: '#09090b',
        boxShadow: `${SHADOW}, inset 0 0 0 1.5px rgba(38, 38, 43, ${1 - fill})`,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: bezel + (w - PHONE_BODY.w) / 2,
          top: bezel + (h - PHONE_BODY.h) / 2,
          width: PHONE_VIEWPORT.w,
          height: PHONE_VIEWPORT.h,
          borderRadius: PHONE.screenRadius,
          overflow: 'hidden',
          opacity: 1 - fill,
          background: screenBg,
        }}
      >
        {children}
      </div>
      {morph > 0 && (
        <>
          {/* Градиент иконки (#37bbfe → #007dbb, как в public/icon.svg) */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: fill,
              background: 'linear-gradient(135deg, #37bbfe 0%, #007dbb 100%)',
            }}
          />
          {mark > 0 && (
            <Img
              src={icon}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'fill',
                opacity: mark,
              }}
            />
          )}
        </>
      )}
    </div>
  );
};
