import { AbsoluteFill } from 'remotion';
import { C } from '../lib/colors';

interface Props {
  /** Дрейф 0 → 1 за ролик. */
  t: number;
  /** Сдвиг камеры от исходной точки — для лёгкого параллакса пятен. */
  parallax: { x: number; y: number };
}

/**
 * Диагональный градиент от тёмно-синего (слева снизу) к небесному (справа сверху)
 * и три мягких световых пятна. Левая половина остаётся тёмной — на ней белые подписи.
 */
export const Background: React.FC<Props> = ({ t, parallax }) => {
  const angle = 52 + 6 * t; // градиент медленно поворачивается
  const shift = 8 * t;
  const blob = (x: number, y: number, k: number) => ({
    left: x - parallax.x * k,
    top: y - parallax.y * k,
  });
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${angle}deg, ${C.navyDeep} 0%, ${C.navy} ${30 + shift}%, #1b55a3 ${58 + shift}%, ${C.sky} ${84 + shift / 2}%, ${C.skyLight} 100%)`,
        overflow: 'hidden',
      }}
    >
      {/* Небесное свечение справа сверху, за устройствами */}
      <div
        style={{
          position: 'absolute',
          ...blob(1180 + 120 * t, -380 + 60 * t, 0.12),
          width: 1300,
          height: 1300,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(223, 241, 255, 0.55) 0%, rgba(143, 208, 255, 0.22) 38%, rgba(143, 208, 255, 0) 70%)`,
        }}
      />
      {/* Фирменный синий — мягкое пятно у правого нижнего края */}
      <div
        style={{
          position: 'absolute',
          ...blob(1250 - 160 * t, 520 - 40 * t, 0.2),
          width: 1100,
          height: 1100,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(51, 144, 236, 0.45) 0%, rgba(51, 144, 236, 0) 65%)`,
        }}
      />
      {/* Глубина слева снизу — под подписями */}
      <div
        style={{
          position: 'absolute',
          ...blob(-420 + 80 * t, 380 - 60 * t, 0.06),
          width: 1200,
          height: 1200,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(10, 31, 68, 0.7) 0%, rgba(10, 31, 68, 0) 65%)`,
        }}
      />
    </AbsoluteFill>
  );
};
