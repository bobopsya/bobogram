import type { Theme } from '../lib/layout';

/** Пузырь «печатает…» в стиле входящего сообщения приложения: три точки бегут волной. */
export const TypingDots: React.FC<{ frame: number; theme: Theme; style?: React.CSSProperties }> = ({
  frame,
  theme,
  style,
}) => {
  const dark = theme === 'dark';
  return (
    <div
      style={{
        position: 'absolute',
        width: 66,
        height: 33.6,
        borderRadius: '15px 15px 15px 4px',
        background: dark ? '#212121' : '#ffffff',
        boxShadow: '0 1px 1px rgba(0, 0, 0, 0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        ...style,
      }}
    >
      {[0, 1, 2].map((i) => {
        // Волна: каждая точка на треть периода позже (период 18 кадров).
        const phase = ((frame - i * 6) / 18) * Math.PI * 2;
        const k = (Math.sin(phase) + 1) / 2;
        return (
          <div
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: dark ? '#aaaaaa' : '#707579',
              opacity: 0.35 + 0.65 * k,
              transform: `translateY(${-3 * k}px)`,
            }}
          />
        );
      })}
    </div>
  );
};
