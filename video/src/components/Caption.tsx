import { FONT } from '../lib/fonts';
import { clamp01, fall, rise } from '../lib/motion';

export interface Phrase {
  /** Кадр появления (на ударе). */
  at: number;
  text: string;
  /** true — фраза дописывается в ту же строку, иначе начинает новую строку вместо старой. */
  append?: boolean;
}

interface Props {
  /** Кадр ролика (не относительный кадр Sequence). */
  frame: number;
  phrases: Phrase[];
  /** Кадр, когда подпись уходит (за 6–8 кадров до смены сцены). */
  out: number;
  /** Положение строки. */
  x?: number;
  y?: number;
  align?: 'left' | 'center';
  size?: number;
}

/**
 * Крупная подпись в одну строку. Фразы появляются на ударах: дописываются в строку
 * или сменяют её. Старая строка уходит вверх быстрее, чем входит новая.
 */
export const Caption: React.FC<Props> = ({
  frame,
  phrases,
  out,
  x = 120,
  y = 540,
  align = 'left',
  size = 100,
}) => {
  // Делим фразы на строки.
  const lines: Phrase[][] = [];
  for (const p of phrases) {
    if (p.append && lines.length) lines[lines.length - 1].push(p);
    else lines.push([p]);
  }
  return (
    <>
      {lines.map((line, i) => {
        const start = line[0].at;
        const end = i + 1 < lines.length ? lines[i + 1][0].at : out;
        if (frame < start || frame > end + 10) return null;
        const gone = fall(frame, end);
        return (
          <div
            key={start}
            style={{
              position: 'absolute',
              top: y,
              left: align === 'left' ? x : 0,
              width: align === 'left' ? undefined : '100%',
              textAlign: align,
              transform: `translateY(-50%) translateY(${-46 * gone}px)`,
              opacity: 1 - gone,
              whiteSpace: 'nowrap',
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: size,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              color: '#ffffff',
              textShadow: '0 6px 40px rgba(10, 31, 68, 0.35)',
            }}
          >
            {line.map((p, j) => {
              const k = rise(frame, p.at);
              return (
                <span
                  key={p.at}
                  style={{
                    display: 'inline-block',
                    opacity: clamp01(k),
                    transform: `translateY(${(1 - k) * 44}px) scale(${0.94 + 0.06 * k})`,
                    transformOrigin: '0 100%',
                  }}
                >
                  {j > 0 ? ' ' : ''}
                  {p.text}
                </span>
              );
            })}
          </div>
        );
      })}
    </>
  );
};
