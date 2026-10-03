import { Shot } from '../components/Shot';
import { SHADOW } from '../lib/colors';
import { DESKTOP_VIEWPORT } from '../lib/layout';
import { ru } from './layout';

const DESK = DESKTOP_VIEWPORT;
const TAB = { w: 820, h: 1180 } as const;

/** Ноутбук: тонкая чёрная рамка экрана, светлое основание. Экран — настоящий Bobogram на ПК. */
export const Laptop: React.FC<{ width: number; src?: string }> = ({ width, src = ru('desktop') }) => {
  const bezel = width * 0.018;
  const screenW = width - bezel * 2;
  const scale = screenW / DESK.w;
  const screenH = DESK.h * scale;
  return (
    <div style={{ position: 'relative', width, filter: 'drop-shadow(0 30px 60px rgba(10,31,68,0.35))' }}>
      <div
        style={{
          position: 'relative',
          width,
          height: screenH + bezel * 2,
          borderRadius: width * 0.02,
          background: '#0b0b0d',
          padding: bezel,
        }}
      >
        <div style={{ position: 'relative', width: screenW, height: screenH, overflow: 'hidden' }}>
          <div
            style={{ width: DESK.w, height: DESK.h, transform: `scale(${scale})`, transformOrigin: '0 0' }}
          >
            <Shot src={src} w={DESK.w} h={DESK.h} />
          </div>
        </div>
      </div>
      <div
        style={{
          width: width * 1.14,
          marginLeft: -width * 0.07,
          height: width * 0.035,
          background: 'linear-gradient(#f2f6fb, #c9d6e6)',
          borderRadius: `0 0 ${width * 0.03}px ${width * 0.03}px`,
        }}
      />
    </div>
  );
};

/** Монитор на тонкой ножке. */
export const Monitor: React.FC<{ width: number; src?: string }> = ({ width, src = ru('desktop') }) => {
  const bezel = width * 0.016;
  const screenW = width - bezel * 2;
  const scale = screenW / DESK.w;
  return (
    <div
      style={{ position: 'relative', width, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      <div
        style={{
          width,
          height: DESK.h * scale + bezel * 2,
          padding: bezel,
          borderRadius: width * 0.015,
          background: '#0b0b0d',
          boxShadow: SHADOW,
        }}
      >
        <div style={{ width: screenW, height: DESK.h * scale, overflow: 'hidden', position: 'relative' }}>
          <div
            style={{ width: DESK.w, height: DESK.h, transform: `scale(${scale})`, transformOrigin: '0 0' }}
          >
            <Shot src={src} w={DESK.w} h={DESK.h} />
          </div>
        </div>
      </div>
      <div
        style={{ width: width * 0.06, height: width * 0.09, background: 'linear-gradient(#c9d6e6, #9fb3cc)' }}
      />
      <div style={{ width: width * 0.3, height: width * 0.018, borderRadius: 8, background: '#c9d6e6' }} />
    </div>
  );
};

/** Планшет: та же чёрная рамка, экран 820×1180 (на планшете Bobogram в две колонки). */
export const Tablet: React.FC<{ width: number; src?: string }> = ({ width, src = ru('tablet') }) => {
  const bezel = width * 0.045;
  const screenW = width - bezel * 2;
  const scale = screenW / TAB.w;
  return (
    <div
      style={{
        width,
        height: TAB.h * scale + bezel * 2,
        padding: bezel,
        borderRadius: width * 0.07,
        background: '#0b0b0d',
        boxShadow: SHADOW,
      }}
    >
      <div
        style={{
          width: screenW,
          height: TAB.h * scale,
          overflow: 'hidden',
          position: 'relative',
          borderRadius: width * 0.03,
        }}
      >
        <div style={{ width: TAB.w, height: TAB.h, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
          <Shot src={src} w={TAB.w} h={TAB.h} />
        </div>
      </div>
    </div>
  );
};
