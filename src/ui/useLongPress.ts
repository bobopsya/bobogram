import { useRef, type TouchEvent } from 'react';

/**
 * Долгое нажатие на телефоне (iOS не присылает contextmenu).
 * Возвращает обработчики для touch-событий.
 */
export function useLongPress(onLongPress: (x: number, y: number) => void, delay = 450) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  return {
    onTouchStart: (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
      fired.current = false;
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(10);
        onLongPress(t.clientX, t.clientY);
      }, delay);
    },
    onTouchMove: (e: TouchEvent) => {
      const t = e.touches[0];
      if (start.current && (Math.abs(t.clientX - start.current.x) > 10 || Math.abs(t.clientY - start.current.y) > 10)) {
        clear();
      }
    },
    onTouchEnd: (e: TouchEvent) => {
      clear();
      // После долгого нажатия не открываем то, на что нажали.
      if (fired.current) e.preventDefault();
    },
    onTouchCancel: clear,
  };
}
