import { C, GLASS } from '../lib/colors';
import { FONT } from '../lib/fonts';
import { clamp01, rise } from '../lib/motion';

export interface Chip {
  label: string;
  /** Точка привязки на экране и сторона, к которой прижат чип. */
  x: number;
  y: number;
  side: 'left' | 'right';
  active?: boolean;
}

interface Props {
  chips: Chip[];
  frame: number;
  at: number;
  /** Финал: чипы улетают в точку to. */
  gather: number;
  to: { x: number; y: number };
}

/** Четыре языка приложения — стеклянные чипы, всплывают по очереди и мягко покачиваются. */
export const LangChips: React.FC<Props> = ({ chips, frame, at, gather, to }) => (
  <>
    {chips.map((c, i) => {
      const k = rise(frame, at + i * 2);
      const bob = Math.sin((frame - at) / 14 + i * 1.7) * 4;
      const dx = (to.x - c.x) * gather;
      const dy = (to.y - c.y) * gather;
      return (
        <div
          key={c.label}
          style={{
            position: 'absolute',
            left: c.x,
            top: c.y,
            transform: `translate(${c.side === 'left' ? '-100%' : '0'}, -50%) translate(${dx}px, ${dy + (1 - k) * 50 + bob}px) scale(${(0.94 + 0.06 * k) * (1 - 0.7 * gather)})`,
            opacity: clamp01(k) * (1 - clamp01(gather * 1.8)),
            ...GLASS,
            borderRadius: 999,
            padding: '14px 34px',
            fontFamily: FONT,
            fontWeight: 600,
            fontSize: 44,
            lineHeight: 1.2,
            color: C.navyDeep,
            whiteSpace: 'nowrap',
            outline: c.active ? `4px solid ${C.brand}` : undefined,
            outlineOffset: c.active ? -4 : undefined,
          }}
        >
          {c.label}
        </div>
      );
    })}
  </>
);
