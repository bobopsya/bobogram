import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  icon: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  header?: ReactNode;
}

/** Контекстное меню в точке нажатия; не вылезает за края экрана. */
export function Menu({ x, y, items, onClose, header }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number }>({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    // Длинное меню не выше экрана — внутри листается.
    const maxHeight = vh - 16;
    const height = Math.min(r.height, maxHeight);
    setPos({
      left: Math.max(8, Math.min(x, vw - r.width - 8)),
      top: Math.max(8, Math.min(y, vh - height - 8)),
      maxHeight,
    });
  }, [x, y]);

  return createPortal(
    <div
      className="menu-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => e.target === e.currentTarget && onClose()}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="menu" ref={ref} style={pos} role="menu">
        {header}
        {items.map((item) => (
          <button
            key={item.label}
            className={item.danger ? 'menu-item danger' : 'menu-item'}
            role="menuitem"
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
