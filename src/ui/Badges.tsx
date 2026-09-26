import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/** Подсказка под значком, не выходя за края экрана. */
function popoverPos(anchor: HTMLElement | null): CSSProperties {
  const r = anchor?.getBoundingClientRect();
  if (!r) return {};
  const width = 220;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
  const below = r.bottom + 6;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  return below + 70 > vh ? { left, bottom: vh - r.top + 6, width } : { left, top: below, width };
}

export interface BadgeFlags {
  verified?: boolean;
  scam?: boolean;
  premium?: boolean;
  /** Эмодзи-статус: показывается вместо звезды премиума. */
  emoji?: string | null;
  /** Разработчик Bobogram: зелёный «</>». */
  developer?: boolean;
  /** Основатель Bobogram: золотая корона. */
  founder?: boolean;
}

/** Значок с подсказкой по нажатию (разработчик, основатель). */
function PopoverBadge({
  className,
  label,
  hint,
  style,
  children,
}: {
  className: string;
  label: string;
  hint: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const timer = window.setTimeout(() => setOpen(false), 4000);
    document.addEventListener('pointerdown', close);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', close);
    };
  }, [open]);
  return (
    <span
      ref={ref}
      className={className}
      role="button"
      tabIndex={0}
      aria-label={label}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setOpen((v) => !v);
      }}
      onKeyDown={(e) => e.key === 'Enter' && setOpen((v) => !v)}
    >
      {children}
      {open &&
        // Поверх экрана: строка списка чатов обрезает всё, что вылезает за неё.
        createPortal(
          <span className="dev-popover" role="tooltip" style={popoverPos(ref.current)}>
            <strong>{label}</strong>
            <span>{hint}</span>
          </span>,
          document.body,
        )}
    </span>
  );
}

/** Зелёный «</>»; по нажатию — подсказка «Разработчик Bobogram». */
export function DeveloperBadge({ size = 16 }: { size?: number }) {
  const { t } = useTranslation();
  return (
    <PopoverBadge
      className="dev-badge"
      label={t('badges.developer')}
      hint={t('badges.developerHint')}
      style={{ fontSize: Math.round(size * 0.62), height: size }}
    >
      {'</>'}
    </PopoverBadge>
  );
}

/** Золотая корона; по нажатию — подсказка «Основатель Bobogram». */
export function FounderBadge({ size = 16 }: { size?: number }) {
  const { t } = useTranslation();
  return (
    <PopoverBadge className="founder-badge" label={t('badges.founder')} hint={t('badges.founderHint')}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="bg-founder" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe27a" />
            <stop offset="1" stopColor="#f0a500" />
          </linearGradient>
        </defs>
        <path
          fill="url(#bg-founder)"
          stroke="#b77900"
          strokeWidth="0.8"
          strokeLinejoin="round"
          d="M3 7.5l4.6 3.8L12 4.5l4.4 6.8L21 7.5l-1.8 10.5H4.8z"
        />
        <rect x="4.8" y="18.6" width="14.4" height="2.2" rx="1" fill="#f0a500" />
      </svg>
    </PopoverBadge>
  );
}

/** Галочка верификации, как в Telegram: синяя «печать» с белой галочкой. */
export function VerifiedIcon({ size = 16 }: { size?: number }) {
  const { t } = useTranslation();
  return (
    <svg
      className="badge-icon verified"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={t('badges.verified')}
    >
      <title>{t('badges.verified')}</title>
      <path
        fill="currentColor"
        d="M12 1.5l2.39 1.74 2.95-.12.97 2.79 2.47 1.63-.72 2.87L21.5 12l-1.44 2.59.72 2.87-2.47 1.63-.97 2.79-2.95-.12L12 22.5l-2.39-1.74-2.95.12-.97-2.79-2.47-1.63.72-2.87L2.5 12l1.44-2.59-.72-2.87 2.47-1.63.97-2.79 2.95.12z"
      />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.8 12.3l2.8 2.7 5.6-5.8"
      />
    </svg>
  );
}

/** Звезда премиума с переливом. */
export function PremiumIcon({ size = 16 }: { size?: number }) {
  const { t } = useTranslation();
  return (
    <svg
      className="badge-icon premium"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={t('badges.premium')}
    >
      <title>{t('badges.premium')}</title>
      <defs>
        <linearGradient id="bg-premium" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6c7cff" />
          <stop offset="0.5" stopColor="#b56cff" />
          <stop offset="1" stopColor="#ff7ab8" />
        </linearGradient>
      </defs>
      <path
        fill="url(#bg-premium)"
        d="M12 2.2l2.93 5.94 6.56.95-4.75 4.63 1.12 6.53L12 17.17l-5.86 3.08 1.12-6.53L2.5 9.09l6.56-.95z"
      />
    </svg>
  );
}

export function ScamBadge() {
  const { t } = useTranslation();
  return (
    <span className="scam-badge" title={t('badges.scamHint')}>
      {t('badges.scam')}
    </span>
  );
}

/** Все значки подряд — ставится сразу после имени. */
export function Badges({
  verified,
  scam,
  premium,
  emoji,
  developer,
  founder,
  size = 16,
}: BadgeFlags & { size?: number }) {
  if (!verified && !scam && !premium && !emoji && !developer && !founder) return null;
  return (
    <span className="badges">
      {verified && <VerifiedIcon size={size} />}
      {founder && <FounderBadge size={size} />}
      {developer && <DeveloperBadge size={size} />}
      {emoji ? (
        <span className="emoji-status" style={{ fontSize: size }}>
          {emoji}
        </span>
      ) : (
        premium && !verified && <PremiumIcon size={size} />
      )}
      {scam && <ScamBadge />}
    </span>
  );
}

export function ScamWarning() {
  const { t } = useTranslation();
  return (
    <div className="scam-warning" role="alert">
      <strong>{t('badges.scamWarningTitle')}</strong>
      <span>{t('badges.scamWarningText')}</span>
    </div>
  );
}
