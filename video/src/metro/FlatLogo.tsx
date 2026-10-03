import { FONT } from '../lib/fonts';

// Плоский логотип в духе Metro: облачко и «b» из public/icon.svg, только белым и без градиента.
// «b» вырезана маской — сквозь неё виден фон, на любом цвете.
const BUBBLE =
  'M120 250c0-70 60-122 136-122s136 52 136 122-60 122-136 122c-14 0-28-2-41-5l-58 30 13-52c-31-22-50-56-50-95z';

export const FlatLogo: React.FC<{
  size: number;
  color?: string;
  style?: React.CSSProperties;
  id?: string;
}> = ({ size, color = '#ffffff', style, id = 'flat-logo' }) => (
  <svg width={size} height={size} viewBox="110 118 292 292" style={style}>
    <defs>
      <mask id={id}>
        <rect x="0" y="0" width="512" height="512" fill="white" />
        <text
          x="256"
          y="300"
          textAnchor="middle"
          fontFamily={FONT}
          fontWeight={700}
          fontSize={150}
          fill="black"
        >
          b
        </text>
      </mask>
    </defs>
    <path d={BUBBLE} fill={color} mask={`url(#${id})`} />
  </svg>
);
