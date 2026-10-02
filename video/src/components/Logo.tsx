import { Img } from 'remotion';

/** Иконка Bobogram (public/icon.svg из приложения, как есть) с мягким синим свечением. */
export const Logo: React.FC<{ src: string; size: number; glow?: number; style?: React.CSSProperties }> = ({
  src,
  size,
  glow = 1,
  style,
}) => (
  <div style={{ position: 'absolute', width: size, height: size, ...style }}>
    <div
      style={{
        position: 'absolute',
        inset: -size * 0.6,
        borderRadius: '50%',
        background: `radial-gradient(circle, rgba(143, 208, 255, ${0.55 * glow}) 0%, rgba(51, 144, 236, ${0.25 * glow}) 35%, rgba(51, 144, 236, 0) 70%)`,
      }}
    />
    <Img
      src={src}
      style={{
        position: 'absolute',
        inset: 0,
        width: size,
        height: size,
        filter: `drop-shadow(0 ${size * 0.08}px ${size * 0.16}px rgba(10, 31, 68, ${0.35 * glow}))`,
      }}
    />
  </div>
);
