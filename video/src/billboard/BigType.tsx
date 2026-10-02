import { FONT } from '../lib/fonts';
import { clamp01 } from '../lib/motion';

export const BIG = { size: 320, left: 501, y: 540 } as const;

interface Props {
  frame: number;
  /** Сколько букв после «@» уже напечатано. */
  typed: number;
  times: readonly number[];
  /** Перелёт в поле логина: 0 — на месте, 1 — в поле. */
  fly: number;
  target: { x: number; y: number; size: number };
  /** Общая прозрачность и масштаб появления (для замыкания петли). */
  enter: number;
}

/**
 * Огромное «@alex» на весь кадр: буквы печатаются по ударам, мигает каретка,
 * затем слово улетает в поле юзернейма на телефоне. Ненапечатанные буквы занимают
 * место, но прозрачны — слово не прыгает по мере набора.
 */
export const BigType: React.FC<Props> = ({ frame, typed, times, fly, target, enter }) => {
  const word = 'alex';
  // Каретка мигает раз в удар (30 кадров) — 900 делится на 60, петля не рвёт ритм.
  const caret = Math.floor(frame / 30) % 2 === 0 || times.some((t) => frame >= t && frame - t < 12);
  const k = clamp01(fly);
  const scale = 1 + (target.size / BIG.size - 1) * k;
  const dx = (target.x - BIG.left) * k;
  const dy = (target.y - BIG.y) * k;
  return (
    <div
      style={{
        position: 'absolute',
        left: BIG.left,
        top: BIG.y,
        transformOrigin: '0 50%',
        transform: `translate(${dx}px, ${dy}px) translateY(-50%) translateY(${(1 - enter) * 60}px) scale(${scale * (0.94 + 0.06 * enter)})`,
        opacity: clamp01(enter) * (1 - clamp01((k - 0.55) / 0.35)),
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: BIG.size,
        lineHeight: 1,
        letterSpacing: '-0.03em',
        color: '#ffffff',
        whiteSpace: 'pre',
        textShadow: '0 12px 80px rgba(10, 31, 68, 0.45)',
      }}
    >
      <span style={{ position: 'relative' }}>@{typed === 0 && caret && k === 0 && <Caret />}</span>
      {Array.from(word).map((ch, i) => (
        <span
          key={i}
          style={{ position: 'relative', opacity: i < typed ? clamp01((frame - times[i]) / 6 + 0.3) : 0 }}
        >
          {ch}
          {i === typed - 1 && caret && k === 0 && <Caret />}
        </span>
      ))}
    </div>
  );
};

/** Небесно-голубая каретка сразу за последним напечатанным символом. */
const Caret: React.FC = () => (
  <span
    style={{
      position: 'absolute',
      left: '100%',
      marginLeft: 10,
      top: '8%',
      width: 14,
      height: '84%',
      borderRadius: 7,
      background: '#8fd0ff',
      boxShadow: '0 0 30px rgba(143, 208, 255, 0.8)',
    }}
  />
);
