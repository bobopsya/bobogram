import { AbsoluteFill, Img, Sequence, useCurrentFrame } from 'remotion';
import icon from '../../../public/icon.svg';
import { PhoneFrame } from '../components/PhoneFrame';
import { Shot } from '../components/Shot';
import { FONT } from '../lib/fonts';
import { PHONE_BODY, PHONE_VIEWPORT } from '../lib/layout';
import { clamp01, lerp } from '../lib/motion';
import { Laptop, Monitor, Tablet } from './Devices';
import { FlatLogo } from './FlatLogo';
import { M, ru } from './layout';
import { OpArt } from './OpArt';
import { CafeScreen, PollScreen, StoriesScreen, TypingScreen } from './PhoneScreens';
import { MiaAvatar, TileWall, U } from './Tiles';
import { CUT, e8, pulse, up } from './timing';

const TYPED = 'Друзья всегда на связи 💙';

/** Крупный тонкий текст Metro: въезжает справа и проявляется. */
const MetroText: React.FC<{
  frame: number;
  at: number;
  text: string;
  x?: number;
  y: number;
  size: number;
  align?: 'left' | 'center';
  color?: string;
  weight?: number;
}> = ({ frame, at, text, x = 120, y, size, align = 'left', color = '#fff', weight = 300 }) => {
  const k = up(frame, at);
  return (
    <div
      style={{
        position: 'absolute',
        left: align === 'left' ? x : 0,
        width: align === 'center' ? '100%' : undefined,
        top: y,
        transform: `translateY(-50%) translateX(${(1 - k) * 140}px)`,
        opacity: clamp01(k * 1.5),
        textAlign: align,
        fontFamily: FONT,
        fontWeight: weight,
        fontSize: size,
        lineHeight: 1.08,
        letterSpacing: '-0.02em',
        color,
        whiteSpace: 'pre',
      }}
    >
      {text}
    </div>
  );
};

/** Телефон на сцене: центр (x, y) и масштаб. */
const Phone: React.FC<{
  x: number;
  y: number;
  scale: number;
  children: React.ReactNode;
  origin?: string;
}> = ({ x, y, scale, children, origin = '50% 50%' }) => (
  <div
    style={{
      position: 'absolute',
      left: x - PHONE_BODY.w / 2,
      top: y - PHONE_BODY.h / 2,
      width: PHONE_BODY.w,
      height: PHONE_BODY.h,
      transform: `scale(${scale})`,
      transformOrigin: origin,
    }}
  >
    <PhoneFrame icon={icon} iconSize={260} screenBg="#ffffff">
      {children}
    </PhoneFrame>
  </div>
);

/** Сцена от склейки до склейки; внутри — кадр всего ролика. */
const Cut: React.FC<{ from: number; to: number; bg?: string; children: React.ReactNode }> = ({
  from,
  to,
  bg,
  children,
}) => (
  <Sequence from={from} durationInFrames={to - from} layout="none">
    <AbsoluteFill style={{ background: bg }}>{children}</AbsoluteFill>
  </Sequence>
);

/** Большая плитка, выезжающая справа поверх оп-арта (как плитка «Карты» в рекламе). */
const BigTile: React.FC<{
  frame: number;
  at: number;
  bg: string;
  label: string;
  children: React.ReactNode;
}> = ({ frame, at, bg, label, children }) => {
  const k = up(frame, at);
  if (frame < at) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 960 - U * 1.6,
        top: 540 - U * 0.8,
        width: U * 3.2,
        height: U * 1.6,
        background: bg,
        transform: `perspective(1600px) translateX(${(1 - k) * 900}px) rotateY(${(1 - k) * -40}deg)`,
        boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
      }}
    >
      {children}
      <div
        style={{ position: 'absolute', left: 26, bottom: 20, fontFamily: FONT, fontSize: 40, color: '#fff' }}
      >
        {label}
      </div>
    </div>
  );
};

/** Ролик Bobogram в духе рекламы Windows 8: плитки Metro в синих тонах, монтаж по долям трека. */
export const Metro: React.FC = () => {
  const frame = useCurrentFrame();
  const len = (a: number, b: number) => b - a;

  // 1. Логотип на синем (как флаг Windows на оранжевом).
  const logoIn = up(frame, -14);

  // 2. Ноутбук с Bobogram, наезд в экран.
  const laptopPush = up(frame, CUT.laptop, len(CUT.laptop, CUT.wall));

  // 12. Набор фразы: буквы на шестнадцатых долях, отправка — на доле.
  const typeStart = e8(64);
  const sendAt = e8(76);
  const chars = Array.from(TYPED).length;
  const typeTimes = Array.from({ length: chars }, (_, i) =>
    Math.round(typeStart + (i * (sendAt - typeStart - 6)) / chars),
  );

  // 18. Устройства.
  const dev = (at: number) => up(frame, at);

  // 20. Логотип и bobogram.org.
  const shift = up(frame, e8(130));
  const logoX = lerp(960, 505, shift);

  return (
    <AbsoluteFill style={{ background: M.night, fontFamily: FONT }}>
      {/* 1 */}
      <Cut from={CUT.logo} to={CUT.laptop} bg={M.blue}>
        <FlatLogo
          size={300}
          id="logo-open"
          style={{
            position: 'absolute',
            left: 810,
            top: 390,
            transform: `perspective(1200px) rotateY(${(1 - logoIn) * 90}deg) scale(${1 + 0.03 * pulse(frame)})`,
          }}
        />
      </Cut>

      {/* 2 */}
      <Cut from={CUT.laptop} to={CUT.wall} bg={M.blue}>
        <div
          style={{
            position: 'absolute',
            left: 960 - 575,
            top: 150,
            transformOrigin: '575px 330px',
            transform: `scale(${1 + 0.55 * laptopPush}) translateY(${(1 - up(frame, CUT.laptop, 10)) * 60}px)`,
          }}
        >
          <Laptop width={1150} />
        </div>
      </Cut>

      {/* 3 */}
      <Cut from={CUT.wall} to={CUT.storiesTile}>
        <TileWall
          frame={frame}
          from={CUT.wall}
          pan={260 * up(frame, CUT.wall + 12, len(CUT.wall, CUT.storiesTile))}
        />
      </Cut>

      {/* 4 */}
      <Cut from={CUT.storiesTile} to={CUT.liveTile} bg={M.sky}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `scale(${0.94 + 0.06 * up(frame, CUT.storiesTile)})`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 960 - 170,
              top: 540 - 230,
              width: 340,
              height: 340,
              borderRadius: '50%',
              border: '10px solid #fff',
              padding: 18,
            }}
          >
            <MiaAvatar size={284} />
          </div>
          <div
            style={{
              position: 'absolute',
              left: 120,
              bottom: 110,
              fontFamily: FONT,
              fontWeight: 300,
              fontSize: 120,
              color: '#fff',
            }}
          >
            Сторис
          </div>
        </div>
      </Cut>

      {/* 5 */}
      <Cut from={CUT.liveTile} to={CUT.wall2} bg={M.blue}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translateY(${(1 - up(frame, CUT.liveTile)) * 220}px)`,
            opacity: clamp01(up(frame, CUT.liveTile) * 1.6),
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 120,
              top: 170,
              display: 'flex',
              alignItems: 'center',
              gap: 34,
            }}
          >
            <MiaAvatar size={150} />
            <div style={{ fontFamily: FONT, fontWeight: 400, fontSize: 60, color: '#fff' }}>Мия Чен</div>
          </div>
          <div
            style={{
              position: 'absolute',
              left: 120,
              top: 420,
              fontFamily: FONT,
              fontWeight: 300,
              fontSize: 120,
              lineHeight: 1.08,
              color: '#fff',
              letterSpacing: '-0.02em',
            }}
          >
            Отлично!
            <br />
            Увидимся в субботу?
          </div>
        </div>
      </Cut>

      {/* 6 */}
      <Cut from={CUT.wall2} to={CUT.op1}>
        <TileWall
          frame={frame}
          from={CUT.wall2}
          settled
          peekAt={24}
          pan={260 + 380 * up(frame, CUT.wall2, len(CUT.wall2, CUT.op1))}
        />
      </Cut>

      {/* 7 */}
      <Cut from={CUT.op1} to={CUT.wall3}>
        <OpArt
          frame={frame}
          from={CUT.op1}
          pattern="rings"
          bubbles={[
            { at: e8(27), text: 'Привет! 👋', x: 180, y: 420 },
            { at: e8(29), text: '@alex', x: 1740, y: 560, own: true },
            { at: e8(31), text: 'Как дела? 😊', x: 240, y: 820 },
            { at: e8(33), text: 'Отлично!', x: 1700, y: 960, own: true },
          ]}
        />
      </Cut>

      {/* 8 */}
      <Cut from={CUT.wall3} to={CUT.stories}>
        <TileWall
          frame={frame}
          from={CUT.wall3}
          settled
          peekAt={36}
          pan={640}
          scale={1 + 0.12 * up(frame, CUT.wall3)}
        />
      </Cut>

      {/* 9 */}
      <Cut from={CUT.stories} to={CUT.op2} bg={M.navy}>
        <MetroText frame={frame} at={CUT.stories} text="Сторис" y={540} size={170} />
        <Phone x={1360} y={540} scale={1.04}>
          <StoriesScreen frame={frame} ring={e8(39)} open={e8(42)} end={CUT.op2} />
        </Phone>
      </Cut>

      {/* 10 */}
      <Cut from={CUT.op2} to={CUT.op3}>
        <OpArt
          frame={frame}
          from={CUT.op2}
          pattern="stripes"
          bubbles={[
            { at: e8(53), text: 'Увидимся в субботу? 🙌', x: 200, y: 560 },
            { at: e8(55), text: 'Конечно! 💙', x: 1720, y: 820, own: true },
          ]}
        />
      </Cut>

      {/* 11 */}
      <Cut from={CUT.op3} to={CUT.typing}>
        <OpArt
          frame={frame}
          from={CUT.op3}
          pattern="checker"
          rotate={12}
          bubbles={[
            { at: e8(58), text: '🎉', x: 760, y: 640, size: 150 },
            { at: e8(60), text: '😍', x: 1160, y: 820, size: 150, own: true },
          ]}
        />
      </Cut>

      {/* 12 */}
      <Cut from={CUT.typing} to={CUT.op4} bg={M.blue}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transformOrigin: '960px 800px',
            transform: `scale(${1 + 0.1 * up(frame, CUT.typing, len(CUT.typing, CUT.op4))})`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 960 - 163 * 1.7,
              top: 800 - 830 * 1.7,
              width: PHONE_BODY.w,
              height: PHONE_BODY.h,
              transform: 'scale(1.7)',
              transformOrigin: '0 0',
            }}
          >
            <PhoneFrame icon={icon} iconSize={260} screenBg="#ffffff">
              <TypingScreen frame={frame} text={TYPED} times={typeTimes} send={sendAt} />
            </PhoneFrame>
          </div>
        </div>
      </Cut>

      {/* 13 */}
      <Cut from={CUT.op4} to={CUT.poll}>
        <OpArt frame={frame} from={CUT.op4} pattern="zigzag">
          <BigTile frame={frame} at={e8(83)} bg={M.navy} label="Опросы">
            <div
              style={{
                position: 'absolute',
                left: 40,
                right: 40,
                top: 46,
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
              }}
            >
              {[0.67, 0.33, 0.12].map((v, i) => (
                <div key={i} style={{ height: 34, borderRadius: 6, background: 'rgba(255,255,255,0.22)' }}>
                  <div
                    style={{
                      width: `${v * 100 * clamp01(up(frame, e8(85) + i * 4))}%`,
                      height: '100%',
                      borderRadius: 6,
                      background: '#fff',
                    }}
                  />
                </div>
              ))}
            </div>
          </BigTile>
        </OpArt>
      </Cut>

      {/* 14 */}
      <Cut from={CUT.poll} to={CUT.cafe} bg={M.navy}>
        <MetroText frame={frame} at={CUT.poll} text="Опросы" y={540} size={170} />
        <Phone x={1360} y={540} scale={1.04}>
          <PollScreen frame={frame} vote={e8(89)} />
        </Phone>
      </Cut>

      {/* 15 */}
      <Cut from={CUT.cafe} to={CUT.op5} bg={M.cobalt}>
        <MetroText frame={frame} at={CUT.cafe} text={'Где\nсобираемся?'} y={540} size={130} />
        <Phone x={1360} y={540} scale={1.04}>
          <CafeScreen frame={frame} answer={e8(95)} />
        </Phone>
      </Cut>

      {/* 16 */}
      <Cut from={CUT.op5} to={CUT.wall4}>
        <OpArt frame={frame} from={CUT.op5} pattern="dots">
          <BigTile frame={frame} at={e8(100)} bg={M.azure} label="Голосовые">
            <div
              style={{
                position: 'absolute',
                left: 40,
                right: 40,
                top: 60,
                height: 160,
                display: 'flex',
                alignItems: 'center',
                gap: 9,
              }}
            >
              {Array.from({ length: 34 }, (_, i) => {
                const h = 18 + 110 * Math.abs(Math.sin(i * 1.7 + 0.4)) * (0.55 + 0.45 * pulse(frame + i * 2));
                return <div key={i} style={{ flex: 1, height: h, borderRadius: 6, background: '#fff' }} />;
              })}
            </div>
          </BigTile>
        </OpArt>
      </Cut>

      {/* 17 */}
      <Cut from={CUT.wall4} to={CUT.devices}>
        <TileWall
          frame={frame}
          from={CUT.wall4}
          settled
          peekAt={104}
          pan={640}
          scale={1.15 - 0.3 * up(frame, CUT.wall4)}
        />
      </Cut>

      {/* 18 */}
      <Cut from={CUT.devices} to={CUT.tagline} bg={M.blue}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transformOrigin: '960px 560px',
            transform: `scale(${1 + 0.05 * up(frame, CUT.devices, len(CUT.devices, CUT.tagline))})`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 560,
              top: 150,
              opacity: clamp01(dev(CUT.devices) * 1.5),
              transform: `translateY(${(1 - dev(CUT.devices)) * 120}px)`,
            }}
          >
            <Monitor width={800} />
          </div>
          <div
            style={{
              position: 'absolute',
              left: 190,
              top: 400,
              opacity: clamp01(dev(e8(109)) * 1.5),
              transform: `translateY(${(1 - dev(e8(109))) * 120}px)`,
            }}
          >
            <Tablet width={330} />
          </div>
          <div style={{ opacity: clamp01(dev(e8(111)) * 1.5) }}>
            <Phone x={1560} y={640 + (1 - dev(e8(111))) * 120} scale={0.66}>
              <Shot src={ru('mia-sent')} w={PHONE_VIEWPORT.w} h={PHONE_VIEWPORT.h} />
            </Phone>
          </div>
        </div>
      </Cut>

      {/* 19 */}
      <Cut from={CUT.tagline} to={CUT.lockup} bg={M.blue}>
        <MetroText
          frame={frame}
          at={CUT.tagline}
          text="Просто @username."
          y={540}
          size={120}
          align="center"
        />
      </Cut>

      {/* 20 */}
      <Cut from={CUT.lockup} to={CUT.company} bg={M.blue}>
        <FlatLogo
          size={240}
          id="logo-lockup"
          style={{
            position: 'absolute',
            left: logoX - 120,
            top: 540 - 120,
            transform: `perspective(1200px) rotateY(${(1 - up(frame, CUT.lockup)) * 90}deg)`,
          }}
        />
        <MetroText frame={frame} at={e8(130)} text="bobogram.org" x={675} y={540} size={140} />
      </Cut>

      {/* 21: карточка компании, как белая карточка Microsoft в конце рекламы */}
      <Cut from={CUT.company} to={CUT.end} bg={M.white}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 26,
            opacity: clamp01(up(frame, CUT.company, 10)),
          }}
        >
          <Img src={icon} style={{ width: 96, height: 96 }} />
          <div
            style={{
              fontFamily: FONT,
              fontWeight: 600,
              fontSize: 72,
              color: M.navy,
              letterSpacing: '-0.02em',
            }}
          >
            bobogram
          </div>
        </div>
      </Cut>
    </AbsoluteFill>
  );
};
