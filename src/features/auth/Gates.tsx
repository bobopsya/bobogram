import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPunishment, logout, type Punishment } from '../../supabase/api';
import { useApp } from '../../app/store';

function Screen({
  emoji,
  title,
  text,
  extra = [],
  withLogout,
}: {
  emoji: string;
  title: string;
  text: string;
  extra?: string[];
  withLogout?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-emoji">{emoji}</div>
        <h2>{title}</h2>
        <p className="muted">{text}</p>
        {extra.map((line) => (
          <p key={line} className="muted">
            {line}
          </p>
        ))}
        {withLogout && (
          <button className="btn btn-block" onClick={() => void logout()}>
            {t('auth.logout')}
          </button>
        )}
      </div>
    </div>
  );
}

export function BannedScreen() {
  const { t, i18n } = useTranslation();
  const uid = useApp((s) => s.userId);
  const [pun, setPun] = useState<Punishment | null>(null);
  useEffect(() => {
    if (uid) void getPunishment(uid).then(setPun, () => undefined);
  }, [uid]);

  // Временный бан снимает сервер раз в минуту — после срока обновляем страницу сами.
  const until = pun?.banUntil ?? null;
  useEffect(() => {
    if (!until) return;
    const wait = until - Date.now() + 65_000;
    if (wait > 2_000_000_000) return;
    const timer = window.setTimeout(() => window.location.reload(), Math.max(wait, 5_000));
    return () => window.clearTimeout(timer);
  }, [until]);

  const extra = [
    pun?.banReason ? t('auth.bannedReason', { reason: pun.banReason }) : '',
    until
      ? t('auth.bannedUntil', {
          date: new Date(until).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' }),
        })
      : '',
  ].filter(Boolean);
  return <Screen emoji="⛔" title={t('auth.bannedTitle')} text={t('auth.bannedText')} extra={extra} withLogout />;
}

/** Идут работы: всем, кроме админов. Админ входит по ссылке внизу. */
export function MaintenanceScreen({
  message,
  until,
  onAdmin,
  withLogout,
}: {
  message: string | null;
  until: number | null;
  onAdmin?: () => void;
  withLogout?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const extra = [
    message ?? '',
    until
      ? t('maintenance.until', {
          date: new Date(until).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' }),
        })
      : '',
  ].filter(Boolean);
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-emoji">🛠️</div>
        <h2>{t('maintenance.title')}</h2>
        <p className="muted">{t('maintenance.text')}</p>
        {extra.map((line) => (
          <p key={line} className="muted">
            {line}
          </p>
        ))}
        {withLogout && (
          <button className="btn btn-block" onClick={() => void logout()}>
            {t('auth.logout')}
          </button>
        )}
        {onAdmin && (
          <button type="button" className="link" onClick={onAdmin}>
            {t('maintenance.admin')}
          </button>
        )}
      </div>
    </div>
  );
}

export function NoProfileScreen() {
  const { t } = useTranslation();
  return <Screen emoji="🤔" title={t('profile.notFound')} text={t('errors.generic')} withLogout />;
}

export function SetupNeededScreen() {
  const { t } = useTranslation();
  return <Screen emoji="🛠️" title={t('setup.title')} text={t('setup.text')} />;
}
