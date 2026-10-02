import { FONT } from '../lib/fonts';
import { clamp01 } from '../lib/motion';
import { down, up } from './timing';

export interface Line {
  /** Кадр появления строки (на ударе). */
  at: number;
  text: string;
}

interface Props {
  frame: number;
  lines: Line[];
  out: number;
  align?: 'left' | 'center';
  x?: number;
  y?: number;
  size?: number;
}

/**
 * Подпись для билборда: одна–две короткие строки по 1–2 слова, 168 px — читается издалека.
 * Строки появляются на ударах «снизу + масштаб + fade», уходят вверх быстрее.
 */
export const BigCaption: React.FC<Props> = ({
  frame,
  lines,
  out,
  align = 'left',
  x = 120,
  y = 540,
  size = 168,
}) => {
  if (frame < lines[0].at || frame > out + 20) return null;
  const gone = down(frame, out);
  return (
    <div
      style={{
        position: 'absolute',
        left: align === 'left' ? x : 0,
        width: align === 'left' ? undefined : '100%',
        top: y,
        transform: `translateY(-50%) translateY(${-60 * gone}px)`,
        opacity: 1 - gone,
        textAlign: align,
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.02,
        letterSpacing: '-0.03em',
        color: '#ffffff',
        whiteSpace: 'nowrap',
        textShadow: '0 10px 60px rgba(10, 31, 68, 0.4)',
      }}
    >
      {lines.map((l) => {
        const k = up(frame, l.at);
        return (
          <div
            key={l.at + l.text}
            style={{
              opacity: clamp01(k),
              transform: `translateY(${(1 - k) * 70}px) scale(${0.94 + 0.06 * k})`,
              transformOrigin: align === 'left' ? '0 100%' : '50% 100%',
            }}
          >
            {l.text}
          </div>
        );
      })}
    </div>
  );
};
