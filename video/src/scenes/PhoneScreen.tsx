import { interpolate } from 'remotion';
import { Crop, Shot } from '../components/Shot';
import { C } from '../lib/colors';
import { CUE } from '../lib/cues';
import { FONT } from '../lib/fonts';
import { LAYOUT, PHONE_VIEWPORT, shot, type Rect, type Theme } from '../lib/layout';
import { clamp01, rise } from '../lib/motion';
import { ChatThread } from './ChatThread';

const V = PHONE_VIEWPORT;

/** Сколько символов уже «напечатано» к кадру. */
const typed = (frame: number, times: readonly number[]) => times.filter((t) => frame >= t).length;

/** Мигающая каретка (период 16 кадров), не мигает, пока идёт ввод. */
const caretOn = (frame: number, lastKey: number) =>
  frame - lastKey < 8 || Math.floor((frame - lastKey) / 8) % 2 === 0;

const FocusRing: React.FC<{ rect: Rect; radius: number; on: number }> = ({ rect, radius, on }) => (
  <div
    style={{
      position: 'absolute',
      left: rect.x,
      top: rect.y,
      width: rect.w,
      height: rect.h,
      borderRadius: radius,
      border: `1px solid ${C.brand}`,
      opacity: on,
    }}
  />
);

/** Текст, впечатанный в поле: каждая буква мягко проявляется. */
const TypedText: React.FC<{
  frame: number;
  text: string;
  times: readonly number[];
  x: number;
  rect: Rect;
  size: number;
  color: string;
  caret: boolean;
}> = ({ frame, text, times, x, rect, size, color, caret }) => {
  const n = typed(frame, times);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: rect.y,
        height: rect.h,
        display: 'flex',
        alignItems: 'center',
        fontFamily: FONT,
        fontSize: size,
        color,
        whiteSpace: 'pre',
      }}
    >
      {Array.from(text.slice(0, n)).map((ch, i) => (
        <span key={i} style={{ opacity: clamp01((frame - times[i]) / 3 + 0.35) }}>
          {ch}
        </span>
      ))}
      {caret && caretOn(frame, times[Math.max(0, n - 1)]) && (
        <span style={{ width: 1.5, height: size * 1.2, marginLeft: 1, background: color }} />
      )}
    </div>
  );
};

/** Экран вход → список чатов. */
const LoginAndList: React.FC<{ frame: number; theme: Theme }> = ({ frame, theme }) => {
  const L = LAYOUT[theme].login;
  const ink = theme === 'dark' ? '#ffffff' : C.appInk;
  const userFocus = frame >= CUE.usernameFocus && frame < CUE.passwordFocus ? 1 : 0;
  const passFocus = frame >= CUE.passwordFocus && frame < CUE.press ? 1 : 0;
  const dots = typed(frame, CUE.typePass);
  // Нажатие кнопки: вниз и обратно.
  const press = clamp01(rise(frame, CUE.press, 5)) - clamp01(rise(frame, CUE.press + 5, 8));
  // Вход гаснет, потом проявляется список — без двойной экспозиции.
  const toList = clamp01(rise(frame, CUE.toList));
  const loginOut = clamp01(toList / 0.5);
  const listIn = clamp01((toList - 0.45) / 0.55);
  return (
    <>
      {loginOut < 1 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 1 - loginOut,
            transform: `scale(${1 - 0.04 * loginOut})`,
          }}
        >
          <Shot src={shot(`phone-login-${theme}`)} w={V.w} h={V.h} />
          <FocusRing rect={L.usernameBox} radius={12} on={userFocus} />
          <FocusRing rect={L.password} radius={12} on={passFocus} />
          <TypedText
            frame={frame}
            text="alex"
            times={CUE.typeUser}
            x={L.username.x + L.paddingLeft}
            rect={L.username}
            size={L.fontSize}
            color={ink}
            caret={userFocus === 1}
          />
          <div
            style={{
              position: 'absolute',
              left: L.password.x + L.passwordPaddingLeft,
              top: L.password.y,
              height: L.password.h,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {Array.from({ length: dots }, (_, i) => (
              <div
                key={i}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: ink,
                  transform: `scale(${clamp01((frame - CUE.typePass[i]) / 3 + 0.4)})`,
                }}
              />
            ))}
          </div>
          <Crop
            src={shot(`phone-login-${theme}`)}
            rect={L.button}
            viewport={V}
            radius={12}
            style={{ transform: `scale(${1 - 0.05 * press})`, filter: `brightness(${1 - 0.12 * press})` }}
          />
        </div>
      )}
      {listIn > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: listIn,
            transform: `translateY(${(1 - listIn) * 16}px)`,
          }}
        >
          <SearchFlow frame={frame} theme={theme} />
        </div>
      )}
    </>
  );
};

/** Список чатов → поле поиска в фокусе → печатаем mia → результат @mia_chen подсвечен. */
const SearchFlow: React.FC<{ frame: number; theme: Theme }> = ({ frame, theme }) => {
  const L = LAYOUT[theme];
  const focus = clamp01(rise(frame, CUE.searchFocus, 6));
  const results = clamp01(rise(frame, CUE.results, 6));
  const highlight = rise(frame, CUE.highlight);
  const typing = frame >= CUE.typeSearch[0];
  const field = L.chats.search;
  const box = L.chats.searchBox;
  const pulse = interpolate(frame - CUE.highlight, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const row = L.search.result;
  return (
    <>
      <Shot src={shot(`phone-chats-${theme}`)} w={V.w} h={V.h} />
      {focus > 0 && (
        <Shot src={shot(`phone-search-focus-${theme}`)} w={V.w} h={V.h} style={{ opacity: focus }} />
      )}
      {typing && results < 1 && (
        <div style={{ opacity: 1 - results }}>
          {/* Плейсхолдер исчезает с первой буквой */}
          <div
            style={{
              position: 'absolute',
              left: field.x,
              top: box.y + 2,
              width: box.x + box.w - field.x - 14,
              height: box.h - 4,
              background: theme === 'dark' ? '#212121' : '#ffffff',
            }}
          />
          <TypedText
            frame={frame}
            text="mia"
            times={CUE.typeSearch}
            x={field.x + L.chats.paddingLeft}
            rect={field}
            size={L.chats.fontSize}
            color={theme === 'dark' ? '#ffffff' : C.appInk}
            caret
          />
        </div>
      )}
      {results > 0 && (
        <>
          <Shot src={shot(`phone-search-${theme}`)} w={V.w} h={V.h} style={{ opacity: results }} />
          {frame >= CUE.highlight && (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: row.x,
                  top: row.y,
                  width: row.w,
                  height: row.h,
                  borderRadius: 14,
                  boxShadow: `0 0 0 ${2 + 10 * pulse}px rgba(51, 144, 236, ${0.45 * (1 - pulse)})`,
                }}
              />
              <Crop
                src={shot(`phone-search-${theme}`)}
                rect={row}
                viewport={V}
                radius={14}
                style={{
                  transform: `scale(${1 + 0.035 * highlight})`,
                  boxShadow: `0 0 0 2px ${C.brand}, 0 12px 28px rgba(51, 144, 236, ${0.35 * clamp01(highlight)})`,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: row.x,
                  top: row.y,
                  width: row.w,
                  height: row.h,
                  borderRadius: 14,
                  background: 'rgba(51, 144, 236, 0.10)',
                  transform: `scale(${1 + 0.035 * highlight})`,
                  opacity: clamp01(highlight),
                }}
              />
            </>
          )}
        </>
      )}
    </>
  );
};

/** Всё, что показывает экран телефона, в выбранной теме. */
export const PhoneScreen: React.FC<{ frame: number; theme: Theme }> = ({ frame, theme }) => {
  const push = clamp01(rise(frame, CUE.pushChat));
  return (
    <>
      {push < 1 && (
        <div style={{ position: 'absolute', inset: 0, transform: `translateX(${-110 * push}px)` }}>
          <LoginAndList frame={frame} theme={theme} />
          <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: 0.18 * push }} />
        </div>
      )}
      {frame >= CUE.pushChat && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translateX(${(1 - rise(frame, CUE.pushChat)) * V.w}px)`,
            boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.12)',
          }}
        >
          <ChatThread frame={frame} theme={theme} />
        </div>
      )}
    </>
  );
};
