import QRCode from 'qrcode';
import { Img } from 'remotion';
import { C, SHADOW } from '../lib/colors';
import { FONT } from '../lib/fonts';
import { clamp01 } from '../lib/motion';

// Настоящая ссылка на профиль в формате приложения (src/supabase/api.ts → profileLink).
const LINK = 'https://bobogram.org/#/u/mia_chen';
const qr = QRCode.create(LINK, { errorCorrectionLevel: 'H' });
const N = qr.modules.size;

/** Модули QR одним path — быстро и чётко при любом масштабе. */
const QR_PATH = (() => {
  let d = '';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (qr.modules.get(y, x)) d += `M${x} ${y}h1v1h-1z`;
  return d;
})();

const W = 400;
const QR_SIZE = 272;

interface Props {
  /** Аватар Mia: кусок настоящего экрана поиска. */
  avatar: React.ReactNode;
  icon: string;
  /** Сканер-рамка: 0 — нет, 1 — защёлкнулась. */
  scan: number;
  /** Вспышка в момент «щелчка». */
  flash: number;
}

/** Карточка профиля с QR-кодом (как «Поделиться профилем» в приложении). */
export const QrCard: React.FC<Props> = ({ avatar, icon, scan, flash }) => {
  const bracket = 1.28 - 0.28 * scan;
  return (
    <div
      style={{
        width: W,
        borderRadius: 36,
        background: C.white,
        boxShadow: SHADOW,
        padding: '34px 0 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: FONT,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 26 }}>
        <div style={{ position: 'relative', width: 64, height: 64, borderRadius: '50%', overflow: 'hidden' }}>
          {avatar}
        </div>
        <div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: C.navyDeep,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
            }}
          >
            Mia Chen
          </div>
          <div style={{ fontSize: 28, fontWeight: 500, color: C.brand, lineHeight: 1.25 }}>@mia_chen</div>
        </div>
      </div>
      <div style={{ position: 'relative', width: QR_SIZE, height: QR_SIZE }}>
        <svg width={QR_SIZE} height={QR_SIZE} viewBox={`-1 -1 ${N + 2} ${N + 2}`} shapeRendering="crispEdges">
          <path d={QR_PATH} fill={C.navyDeep} />
        </svg>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 64,
            height: 64,
            transform: 'translate(-50%, -50%)',
            borderRadius: 16,
            background: C.white,
            padding: 5,
          }}
        >
          <Img src={icon} style={{ width: 54, height: 54 }} />
        </div>
        {/* Вспышка сканера */}
        <div
          style={{
            position: 'absolute',
            inset: -8,
            borderRadius: 18,
            background: C.brand,
            opacity: 0.22 * flash,
          }}
        />
        {/* Сканер-рамка: четыре уголка защёлкиваются вокруг кода */}
        <svg
          width={QR_SIZE + 72}
          height={QR_SIZE + 72}
          viewBox="0 0 344 344"
          style={{
            position: 'absolute',
            left: -36,
            top: -36,
            opacity: clamp01(scan * 1.4),
            transform: `scale(${bracket})`,
          }}
          fill="none"
          stroke={C.brand}
          strokeWidth={8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 72V30a22 22 0 0122-22h42" />
          <path d="M272 8h42a22 22 0 0122 22v42" />
          <path d="M336 272v42a22 22 0 01-22 22h-42" />
          <path d="M72 336H30a22 22 0 01-22-22v-42" />
        </svg>
      </div>
    </div>
  );
};
