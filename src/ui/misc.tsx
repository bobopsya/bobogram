import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { useApp } from '../app/store';

export function Spinner({ size = 28 }: { size?: number }) {
  return <div className="spinner" style={{ width: size, height: size }} aria-label="loading" />;
}

export function FullScreenSpinner() {
  return (
    <div className="center-screen">
      <Spinner size={40} />
    </div>
  );
}

export function Toast() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      {toast}
    </div>
  );
}

export function OfflineBanner() {
  const online = useApp((s) => s.online);
  const { t } = useTranslation();
  if (online) return null;
  return <div className="offline-banner">{t('common.offline')}</div>;
}

interface HeaderProps {
  title: ReactNode;
  back?: string | (() => void);
  actions?: ReactNode;
}

/** Шапка вторичных экранов (профиль, настройки…). */
export function PageHeader({ title, back, actions }: HeaderProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <header className="topbar">
      {back && (
        <button
          className="icon-btn"
          aria-label={t('common.back')}
          onClick={() => (typeof back === 'function' ? back() : navigate(back))}
        >
          <Icon name="back" />
        </button>
      )}
      <div className="topbar-title">{title}</div>
      {actions}
    </header>
  );
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className={checked ? 'switch on' : 'switch'}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="section">
      {title && <h3 className="section-title">{title}</h3>}
      {children}
    </section>
  );
}
