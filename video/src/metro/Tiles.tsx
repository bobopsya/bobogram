import { Crop } from '../components/Shot';
import { FONT } from '../lib/fonts';
import { PHONE_VIEWPORT } from '../lib/layout';
import { clamp01 } from '../lib/motion';
import { FlatLogo } from './FlatLogo';
import { M, RU, ru } from './layout';
import { e8, up } from './timing';

export const U = 200; // сторона маленькой плитки
export const GAP = 14;
const STEP = U + GAP;

interface TileDef {
  col: number;
  row: number;
  w?: number;
  h?: number;
  bg: string;
  label: string;
  ink?: string;
  /** Содержимое плитки; peek — 0/1, «живая» плитка показывает вторую сторону. */
  render: (peek: number) => React.ReactNode;
}

const text = (size: number, weight = 300, color = '#fff'): React.CSSProperties => ({
  fontFamily: FONT,
  fontSize: size,
  fontWeight: weight,
  color,
  lineHeight: 1.15,
  letterSpacing: '-0.01em',
});

/** Аватар Mia: кусок настоящего экрана (кружок в ленте сторис). */
const MiaAvatar: React.FC<{ size: number }> = ({ size }) => {
  const a = RU.chats.storyAvatar;
  return (
    <div style={{ position: 'relative', width: size, height: size, borderRadius: '50%', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', transform: `scale(${size / a.w})`, transformOrigin: '0 0' }}>
        <Crop src={ru('chats')} rect={a} viewport={PHONE_VIEWPORT} style={{ left: 0, top: 0 }} />
      </div>
    </div>
  );
};

/** Две стороны живой плитки: вторая выезжает снизу. */
const Live: React.FC<{ peek: number; a: React.ReactNode; b: React.ReactNode }> = ({ peek, a, b }) => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
    <div style={{ position: 'absolute', inset: 0, transform: `translateY(${-100 * peek}%)` }}>{a}</div>
    <div style={{ position: 'absolute', inset: 0, transform: `translateY(${100 - 100 * peek}%)` }}>{b}</div>
  </div>
);

const Pad: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: 'absolute', inset: 0, padding: 22, ...style }}>{children}</div>
);

const Bars: React.FC = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
    {[0.67, 0.33, 0.12].map((v, i) => (
      <div key={i} style={{ height: 18, borderRadius: 3, background: 'rgba(255,255,255,0.25)' }}>
        <div style={{ width: `${v * 100}%`, height: '100%', borderRadius: 3, background: '#fff' }} />
      </div>
    ))}
  </div>
);

const Wave: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 5, height: 70, marginTop: 14 }}>
    {[10, 26, 40, 22, 52, 34, 18, 44, 30, 14, 36, 24].map((h, i) => (
      <div key={i} style={{ width: 7, height: h, borderRadius: 4, background: '#fff' }} />
    ))}
  </div>
);

// Стена плиток «Пуск»: те же функции Bobogram, что в приложении.
const TILES: TileDef[] = [
  {
    col: 0,
    row: 0,
    bg: M.blue,
    label: 'Чаты',
    render: () => (
      <Pad style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FlatLogo size={92} id="tile-chats" />
        <div style={{ ...text(56, 300), position: 'absolute', right: 24, top: 18 }}>5</div>
      </Pad>
    ),
  },
  {
    col: 1,
    row: 0,
    bg: M.cobalt,
    label: 'Мия Чен',
    render: (peek) => (
      <Live
        peek={peek}
        a={
          <Pad style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 40 }}>
            <MiaAvatar size={112} />
          </Pad>
        }
        b={
          <Pad>
            <div style={text(28, 400)}>Мия Чен</div>
            <div style={{ ...text(24, 300), marginTop: 8, opacity: 0.9 }}>в сети</div>
          </Pad>
        }
      />
    ),
  },
  {
    col: 0,
    row: 1,
    w: 2,
    bg: M.sky,
    label: 'Сторис',
    render: () => (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <Crop
          src={ru('story')}
          rect={{ x: 0, y: 330, w: 390, h: 188 }}
          viewport={PHONE_VIEWPORT}
          style={{ left: 0, top: 0, transform: `scale(${(2 * U + GAP) / 390})`, transformOrigin: '0 0' }}
        />
      </div>
    ),
  },
  {
    col: 0,
    row: 2,
    w: 2,
    bg: M.steel,
    label: 'Друзья',
    render: (peek) => (
      <Live
        peek={peek}
        a={
          <Pad>
            <div style={text(30, 400)}>Где собираемся?</div>
            <div style={{ ...text(24, 300), marginTop: 10, opacity: 0.85 }}>Сэм Ривера</div>
          </Pad>
        }
        b={
          <Pad>
            <div style={text(30, 400)}>В нашем любимом кафе! ☕</div>
            <div style={{ ...text(24, 300), marginTop: 10, opacity: 0.85 }}>Мия Чен</div>
          </Pad>
        }
      />
    ),
  },
  {
    col: 2.35,
    row: 0,
    bg: M.navy,
    label: 'Опросы',
    render: () => (
      <Pad>
        <Bars />
      </Pad>
    ),
  },
  {
    col: 3.35,
    row: 0,
    bg: M.azure,
    label: 'Голосовые',
    render: () => (
      <Pad>
        <Wave />
      </Pad>
    ),
  },
  {
    col: 2.35,
    row: 1,
    w: 2,
    h: 2,
    bg: M.blue,
    label: 'Мия Чен',
    render: (peek) => (
      <Live
        peek={peek}
        a={
          <Pad style={{ padding: 30 }}>
            <MiaAvatar size={90} />
            <div style={{ ...text(46, 300), marginTop: 26 }}>Нашла тебя по @username 👋</div>
          </Pad>
        }
        b={
          <Pad style={{ padding: 30 }}>
            <MiaAvatar size={90} />
            <div style={{ ...text(46, 300), marginTop: 26 }}>Отлично! Увидимся в субботу?</div>
          </Pad>
        }
      />
    ),
  },
  {
    col: 4.7,
    row: 0,
    bg: M.white,
    label: 'QR-код',
    ink: M.navy,
    render: () => (
      <Pad style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 44 }}>
        <svg width={104} height={104} viewBox="0 0 7 7" shapeRendering="crispEdges">
          {/* Стилизованный «QR»: три метки позиционирования */}
          {[
            [0, 0],
            [4, 0],
            [0, 4],
          ].map(([x, y]) => (
            <g key={`${x}${y}`}>
              <rect x={x} y={y} width={3} height={3} fill={M.navy} />
              <rect x={x + 0.5} y={y + 0.5} width={2} height={2} fill="#fff" />
              <rect x={x + 1} y={y + 1} width={1} height={1} fill={M.navy} />
            </g>
          ))}
          <rect x={4} y={4} width={1} height={1} fill={M.navy} />
          <rect x={5.5} y={5} width={1} height={1.5} fill={M.navy} />
          <rect x={4} y={5.8} width={1} height={1} fill={M.navy} />
        </svg>
      </Pad>
    ),
  },
  {
    col: 5.7,
    row: 0,
    bg: M.night,
    label: 'Темы',
    render: () => (
      <Pad style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 44 }}>
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: '50%',
            background: `linear-gradient(90deg, #ffffff 50%, ${M.blue} 50%)`,
            border: '4px solid #fff',
          }}
        />
      </Pad>
    ),
  },
  {
    col: 4.7,
    row: 1,
    w: 2,
    bg: M.cobalt,
    label: 'Каналы',
    render: () => (
      <Pad>
        <div style={text(30, 400)}>Советы Bobogram</div>
        <div style={{ ...text(24, 300), marginTop: 10, opacity: 0.9 }}>
          Поделитесь QR-кодом — друзья найдут вас за секунду
        </div>
      </Pad>
    ),
  },
  {
    col: 4.7,
    row: 2,
    bg: M.steel,
    label: 'Без сети',
    render: () => (
      <Pad style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 44 }}>
        <svg
          viewBox="0 0 24 24"
          width={92}
          height={92}
          fill="none"
          stroke="#fff"
          strokeWidth={1.8}
          strokeLinecap="round"
        >
          <path d="M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19.5h.01M2 9a15 15 0 0120 0" />
        </svg>
      </Pad>
    ),
  },
  {
    col: 5.7,
    row: 2,
    bg: M.ice,
    label: 'Профиль',
    ink: M.navy,
    render: () => (
      <Pad style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 40 }}>
        <div style={text(48, 400, M.navy)}>@alex</div>
      </Pad>
    ),
  },
  {
    col: 7.05,
    row: 0,
    w: 2,
    bg: M.blue,
    label: 'Bobogram',
    render: () => (
      <Pad style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <FlatLogo size={110} id="tile-brand" />
        <div style={text(40, 300)}>bobogram.org</div>
      </Pad>
    ),
  },
  {
    col: 7.05,
    row: 1,
    bg: M.azure,
    label: 'Языки',
    render: () => (
      <Pad>
        <div style={text(32, 400)}>RU · EN</div>
        <div style={{ ...text(30, 400), marginTop: 6 }}>हिन्दी · 中文</div>
      </Pad>
    ),
  },
  {
    col: 8.05,
    row: 1,
    bg: M.navy,
    label: 'Группы',
    render: () => (
      <Pad style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 40 }}>
        <div style={text(64, 300)}>50</div>
      </Pad>
    ),
  },
  {
    col: 7.05,
    row: 2,
    w: 2,
    bg: M.sky,
    label: 'Светлая и тёмная',
    render: () => (
      <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
        <div style={{ flex: 1, background: '#eaf4ff' }} />
        <div style={{ flex: 1, background: '#0f1b2d' }} />
      </div>
    ),
  },
];

/** Одна плитка: влетает с поворотом (как старт «Пуска»), подпись внизу слева. */
const Tile: React.FC<{ def: TileDef; enter: number; peek: number }> = ({ def, enter, peek }) => {
  const w = (def.w ?? 1) * U + ((def.w ?? 1) - 1) * GAP;
  const h = (def.h ?? 1) * U + ((def.h ?? 1) - 1) * GAP;
  const k = clamp01(enter);
  return (
    <div
      style={{
        position: 'absolute',
        left: def.col * STEP,
        top: def.row * STEP,
        width: w,
        height: h,
        background: def.bg,
        overflow: 'hidden',
        opacity: k,
        transformOrigin: '0 50%',
        transform: `perspective(1600px) translateX(${(1 - enter) * 160}px) rotateY(${(1 - enter) * 70}deg)`,
      }}
    >
      {def.render(peek)}
      <div style={{ ...text(24, 400, def.ink ?? '#fff'), position: 'absolute', left: 16, bottom: 12 }}>
        {def.label}
      </div>
    </div>
  );
};

interface WallProps {
  frame: number;
  /** Кадр, когда стена появляется (плитки влетают волной по восьмым долям). */
  from: number;
  /** Сдвиг панорамы влево, px. */
  pan: number;
  scale?: number;
  /** Если true — плитки уже на месте (повторное появление стены). */
  settled?: boolean;
  /** Номер восьмой доли, с которой «живые» плитки переворачиваются. */
  peekAt?: number;
}

/** Стартовый экран «Пуск» в синих тонах. */
export const TileWall: React.FC<WallProps> = ({ frame, from, pan, scale = 1, settled, peekAt }) => {
  const peek = peekAt === undefined ? 0 : clamp01(up(frame, e8(peekAt)));
  return (
    <div style={{ position: 'absolute', inset: 0, background: M.night, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 92,
          ...text(84, 300),
          opacity: settled ? 1 : clamp01(up(frame, from)),
        }}
      >
        Пуск
      </div>
      <div
        style={{
          position: 'absolute',
          left: 120 - pan,
          top: 250,
          transformOrigin: `${pan + 840}px 330px`,
          transform: `scale(${scale})`,
        }}
      >
        {TILES.map((t, i) => (
          <Tile
            key={i}
            def={t}
            enter={settled ? 1 : up(frame, from + Math.round(t.col * 3) + t.row * 2)}
            peek={peek}
          />
        ))}
      </div>
    </div>
  );
};

export { MiaAvatar };
