import { FONT } from '../lib/fonts';
import { clamp01 } from '../lib/motion';
import { up } from './timing';

// Чёрно-белые оп-арт вставки — замена танцорам из рекламы Windows 8 (тот же графичный фон,
// только без людей и стока). Узор только медленно плывёт: никаких вспышек и пульсации контрастного
// рисунка на долях (это опасно для людей с фоточувствительностью). Ритм задают пузыри.
export type Pattern = 'rings' | 'stripes' | 'checker' | 'dots' | 'zigzag';

function background(p: Pattern, t: number): React.CSSProperties {
  switch (p) {
    case 'rings': {
      const r = 52;
      return {
        background: `repeating-radial-gradient(circle at ${50 + 6 * Math.sin(t * 0.7)}% ${50 + 5 * Math.cos(t * 0.5)}%, #000 0 ${r}px, #fff ${r}px ${r * 2}px)`,
      };
    }
    case 'stripes':
      return {
        background: 'repeating-linear-gradient(45deg, #000 0 56px, #fff 56px 112px)',
        backgroundSize: '160px 160px',
        backgroundPosition: `${t * 120}px 0`,
      };
    case 'checker': {
      const s = 160;
      return {
        background: 'repeating-conic-gradient(#000 0 25%, #fff 0 50%)',
        backgroundSize: `${s}px ${s}px`,
        backgroundPosition: '50% 50%',
      };
    }
    case 'dots': {
      const s = 96;
      return {
        background: `radial-gradient(circle, #000 32px, transparent 33px) 0 0 / ${s}px ${s}px, #fff`,
        backgroundPosition: `${t * 60}px ${t * 30}px`,
      };
    }
    case 'zigzag':
      return {
        background:
          'linear-gradient(135deg, #000 25%, transparent 25%) -60px 0 / 120px 120px, linear-gradient(225deg, #000 25%, transparent 25%) -60px 0 / 120px 120px, linear-gradient(315deg, #000 25%, transparent 25%) 0 0 / 120px 120px, linear-gradient(45deg, #000 25%, #fff 25%) 0 0 / 120px 120px',
        backgroundPosition: `${-60 + t * 80}px 0, ${-60 + t * 80}px 0, ${t * 80}px 0, ${t * 80}px 0`,
      };
  }
}

export interface Bubble {
  /** Кадр появления (на доле). */
  at: number;
  text: string;
  x: number;
  y: number;
  /** Свой (синий, справа) или входящий (белый). */
  own?: boolean;
  size?: number;
}

interface Props {
  frame: number;
  from: number;
  pattern: Pattern;
  rotate?: number;
  bubbles?: Bubble[];
  children?: React.ReactNode;
}

/** Оп-арт фон и пузыри сообщений, которые «выпрыгивают» на долях. */
export const OpArt: React.FC<Props> = ({ frame, from, pattern, rotate = 0, bubbles = [], children }) => {
  const t = (frame - from) / 60;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#fff' }}>
      <div
        style={{
          position: 'absolute',
          inset: -400,
          transform: `rotate(${rotate + t * 4}deg)`,
          ...background(pattern, t),
        }}
      />
      {bubbles.map((b, i) => {
        const k = up(frame, b.at);
        if (frame < b.at) return null;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: b.x,
              top: b.y,
              transformOrigin: b.own ? '100% 100%' : '0 100%',
              transform: `translate(${b.own ? '-100%' : '0'}, -100%) scale(${0.6 + 0.4 * k}) rotate(${(1 - k) * (b.own ? 6 : -6)}deg)`,
              opacity: clamp01(k * 1.6),
              padding: '22px 34px',
              borderRadius: 40,
              borderBottomLeftRadius: b.own ? 40 : 10,
              borderBottomRightRadius: b.own ? 10 : 40,
              background: b.own ? '#3390ec' : '#ffffff',
              color: b.own ? '#ffffff' : '#0f0f0f',
              boxShadow: '0 18px 50px rgba(0, 0, 0, 0.35)',
              fontFamily: FONT,
              fontSize: b.size ?? 64,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
            }}
          >
            {b.text}
          </div>
        );
      })}
      {children}
    </div>
  );
};
