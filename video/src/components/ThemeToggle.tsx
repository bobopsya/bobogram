import { C, GLASS } from '../lib/colors';
import { clamp01, lerp } from '../lib/motion';

export const TOGGLE = { w: 168, h: 76, knob: 60 } as const;

/** Переключатель темы: синяя «таблетка» переезжает с солнца на луну. */
export const ThemeToggle: React.FC<{
  enter: number;
  on: number;
  press: number;
  style?: React.CSSProperties;
}> = ({ enter, on, press, style }) => {
  const pad = (TOGGLE.h - TOGGLE.knob) / 2;
  const knobX = lerp(pad, TOGGLE.w - pad - TOGGLE.knob, on);
  const icon = (x: number, active: boolean, children: React.ReactNode) => (
    <svg
      viewBox="0 0 24 24"
      width={30}
      height={30}
      style={{ position: 'absolute', left: x + (TOGGLE.knob - 30) / 2, top: pad + (TOGGLE.knob - 30) / 2 }}
      fill="none"
      stroke={active ? '#ffffff' : C.navy}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
  const k = clamp01(on);
  return (
    <div
      style={{
        position: 'absolute',
        width: TOGGLE.w,
        height: TOGGLE.h,
        borderRadius: TOGGLE.h / 2,
        ...GLASS,
        opacity: clamp01(enter),
        transform: `translate(-50%, -50%) translateY(${(1 - enter) * 40}px) scale(${(0.94 + 0.06 * enter) * (1 - 0.06 * press)})`,
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: knobX,
          top: pad,
          width: TOGGLE.knob,
          height: TOGGLE.knob,
          borderRadius: '50%',
          background: C.brand,
          boxShadow: '0 6px 18px rgba(51, 144, 236, 0.45)',
        }}
      />
      {icon(
        pad,
        k < 0.5,
        <>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </>,
      )}
      {icon(
        TOGGLE.w - pad - TOGGLE.knob,
        k >= 0.5,
        <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />,
      )}
    </div>
  );
};
