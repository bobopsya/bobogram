import { C, GLASS } from '../lib/colors';
import { FONT } from '../lib/fonts';
import { clamp01, lerp } from '../lib/motion';

/** Плашка «Works offline»: значок «нет сети» превращается в галочку. */
export const OfflineBadge: React.FC<{ enter: number; done: number; style?: React.CSSProperties }> = ({
  enter,
  done,
  style,
}) => {
  const d = clamp01(done);
  return (
    <div
      style={{
        position: 'absolute',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '12px 34px 12px 14px',
        borderRadius: 999,
        ...GLASS,
        fontFamily: FONT,
        fontWeight: 600,
        fontSize: 44,
        lineHeight: 1.2,
        color: C.navyDeep,
        whiteSpace: 'nowrap',
        opacity: clamp01(enter),
        ...style,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 60,
          height: 60,
          borderRadius: '50%',
          background: `color-mix(in srgb, ${C.brand} ${d * 100}%, #dbe5f2)`,
          transform: `scale(${1 + 0.12 * Math.sin(Math.PI * d)})`,
        }}
      >
        {/* Wi-Fi с косой чертой */}
        <svg
          viewBox="0 0 24 24"
          width={34}
          height={34}
          style={{
            position: 'absolute',
            left: 13,
            top: 13,
            opacity: 1 - d,
            transform: `scale(${1 - 0.4 * d})`,
          }}
          fill="none"
          stroke={C.navy}
          strokeWidth={2.2}
          strokeLinecap="round"
        >
          <path d="M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01M2 9a15 15 0 0120 0" />
          <path d="M3 3l18 18" />
        </svg>
        {/* Галочка рисуется штрихом */}
        <svg
          viewBox="0 0 24 24"
          width={34}
          height={34}
          style={{ position: 'absolute', left: 13, top: 13 }}
          fill="none"
          stroke="#ffffff"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={lerp(1, 0, d)}
          />
        </svg>
      </div>
      Works offline
    </div>
  );
};
