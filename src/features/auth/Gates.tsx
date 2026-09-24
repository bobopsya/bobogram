import { useTranslation } from 'react-i18next';
import { logout } from '../../supabase/api';

function Screen({ emoji, title, text, withLogout }: { emoji: string; title: string; text: string; withLogout?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-emoji">{emoji}</div>
        <h2>{title}</h2>
        <p className="muted">{text}</p>
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
  const { t } = useTranslation();
  return <Screen emoji="⛔" title={t('auth.bannedTitle')} text={t('auth.bannedText')} withLogout />;
}

export function NoProfileScreen() {
  const { t } = useTranslation();
  return <Screen emoji="🤔" title={t('profile.notFound')} text={t('errors.generic')} withLogout />;
}

export function SetupNeededScreen() {
  const { t } = useTranslation();
  return <Screen emoji="🛠️" title={t('setup.title')} text={t('setup.text')} />;
}
