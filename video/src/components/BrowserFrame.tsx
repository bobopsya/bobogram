import { BROWSER, BROWSER_SCALE, BROWSER_SIZE, DESKTOP_VIEWPORT, type Theme } from '../lib/layout';
import { C, SHADOW } from '../lib/colors';
import { FONT } from '../lib/fonts';
import { Shot } from './Shot';

/** Окно браузера на ПК: три точки и адрес bobogram.org. */
export const BrowserFrame: React.FC<{ src: string; theme: Theme }> = ({ src, theme }) => {
  const dark = theme === 'dark';
  return (
    <div
      style={{
        position: 'absolute',
        width: BROWSER_SIZE.w,
        height: BROWSER_SIZE.h,
        borderRadius: BROWSER.radius,
        overflow: 'hidden',
        background: dark ? '#1b1d21' : C.cloud,
        boxShadow: `${SHADOW}, inset 0 0 0 1px ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(10,31,68,0.08)'}`,
      }}
    >
      <div style={{ position: 'relative', height: BROWSER.toolbar, display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 9, marginLeft: 22 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{ width: 13, height: 13, borderRadius: '50%', background: dark ? '#3a4150' : '#c6d4e6' }}
            />
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 360,
            height: 34,
            borderRadius: 17,
            background: dark ? '#2a2d33' : C.white,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontFamily: FONT,
            fontWeight: 500,
            fontSize: 17,
            color: dark ? '#e6edf7' : C.navyDeep,
          }}
        >
          <svg width="13" height="15" viewBox="0 0 13 15" fill="none">
            <rect x="1" y="6.5" width="11" height="8" rx="2" fill={dark ? '#9fb3cc' : '#5b7393'} />
            <path d="M3.5 6.5V4.5a3 3 0 016 0v2" stroke={dark ? '#9fb3cc' : '#5b7393'} strokeWidth="1.6" />
          </svg>
          bobogram.org
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          width: DESKTOP_VIEWPORT.w,
          height: DESKTOP_VIEWPORT.h,
          transform: `scale(${BROWSER_SCALE})`,
          transformOrigin: '0 0',
        }}
      >
        <Shot src={src} w={DESKTOP_VIEWPORT.w} h={DESKTOP_VIEWPORT.h} />
      </div>
    </div>
  );
};
