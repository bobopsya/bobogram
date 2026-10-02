import { Img } from 'remotion';
import type { Rect } from '../lib/layout';

/** Скриншот целиком, растянутый на свой вьюпорт (картинки сняты @3x и @2x — запас на зум). */
export const Shot: React.FC<{ src: string; w: number; h: number; style?: React.CSSProperties }> = ({
  src,
  w,
  h,
  style,
}) => <Img src={src} style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, ...style }} />;

interface CropProps {
  src: string;
  /** Что вырезать из скриншота (CSS-пиксели). */
  rect: Rect;
  /** Размер вьюпорта скриншота. */
  viewport: { w: number; h: number };
  /** Видимая высота (для «растущих» элементов), по умолчанию rect.h. */
  height?: number;
  radius?: string | number;
  style?: React.CSSProperties;
}

/**
 * Кусок настоящего экрана как отдельный слой: пузырь, кнопка, строка поиска.
 * Слой стоит в своих исходных координатах, двигаем его через style.transform.
 */
export const Crop: React.FC<CropProps> = ({ src, rect, viewport, height, radius, style }) => (
  <div
    style={{
      position: 'absolute',
      left: rect.x,
      top: rect.y,
      width: rect.w,
      height: height ?? rect.h,
      overflow: 'hidden',
      borderRadius: radius,
      ...style,
    }}
  >
    <Img
      src={src}
      style={{
        position: 'absolute',
        left: -rect.x,
        top: -rect.y,
        width: viewport.w,
        height: viewport.h,
        maxWidth: 'none',
      }}
    />
  </div>
);
