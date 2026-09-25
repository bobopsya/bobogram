import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface BadgeFlags {
  verified?: boolean;
  scam?: boolean;
  premium?: boolean;
  /** Эмодзи-статус: показывается вместо звезды премиума. */
  emoji?: string | null;
  /** Разработчик Bobogram: зелёный «</>». */
  developer?: boolean;
}

/** Зелёный «</>»; по нажатию — подсказка «Разработчик Bobogram». */
export function DeveloperBadge({ size = 16 }: { size?: number }) {
  const { t } = useTranslation();
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
      className="dev-badge"
      role="button"
      tabIndex={0}
      aria-label={t('badges.developer')}
      style={{ fontSize: Math.round(size * 0.62), height: size }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setOpen((v) => !v);
      }}
      onKeyDown={(e) => e.key === 'Enter' && setOpen((v) => !v)}
    >
      {'</>'}
      {open && (
        <span className="dev-popover" role="tooltip">
          <strong>{t('badges.developer')}</strong>
          <span>{t('badges.developerHint')}</span>
        </span>
      )}
    </span>
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
  size = 16,
}: BadgeFlags & { size?: number }) {
  if (!verified && !scam && !premium && !emoji && !developer) return null;
  return (
    <span className="badges">
      {verified && <VerifiedIcon size={size} />}
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
