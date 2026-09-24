import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, useMe, useMyProfile, type ThemeMode } from '../../app/store';
import { updateProfile } from '../../firebase/db';
import { logout } from '../../firebase/auth';
import { disablePush, enablePush, pushState, type PushState } from '../../firebase/messaging';
import { isIos, isStandalone } from '../../app/effects';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { PageHeader, Section, Switch } from '../../ui/misc';
import { LanguagePicker } from './LanguagePicker';

export function SettingsScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const profile = useMyProfile();
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const sound = useApp((s) => s.sound);
  const setSound = useApp((s) => s.setSound);
  const blockedCount = useApp((s) => s.blocked.length);
  const [push, setPush] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    void pushState().then(setPush);
  }, []);

  const togglePush = async (on: boolean) => {
    setPushBusy(true);
    try {
      if (on) setPush(await enablePush(me));
      else {
        await disablePush(me);
        setPush('off');
      }
    } catch {
      setPush(await pushState());
    } finally {
      setPushBusy(false);
    }
  };

  const pushHint =
    push === 'on'
      ? t('settings.notificationsOn')
      : push === 'denied'
        ? t('settings.notificationsDenied')
        : push === 'unsupported'
          ? isIos() && !isStandalone()
            ? t('settings.installIos')
            : t('settings.notificationsUnsupported')
          : push === 'unconfigured'
            ? t('settings.notificationsNotConfigured')
            : null;

  return (
    <div className="screen">
      <PageHeader title={t('settings.title')} back="/" />
      <div className="scroll">
        <button className="settings-profile list-item" onClick={() => navigate('/settings/profile')}>
          <Avatar name={profile.displayName} seed={me} src={profile.avatar} size={64} />
          <div className="list-item-body">
            <div className="list-item-title">{profile.displayName}</div>
            <div className="list-item-sub accent-text">@{profile.username}</div>
          </div>
          <Icon name="edit" />
        </button>

        <Section title={t('settings.appearance')}>
          <div className="setting-row">
            <Icon name="moon" />
            <span>{t('settings.theme')}</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeMode)}>
              <option value="system">{t('settings.themeSystem')}</option>
              <option value="light">{t('settings.themeLight')}</option>
              <option value="dark">{t('settings.themeDark')}</option>
            </select>
          </div>
          <div className="setting-row">
            <Icon name="globe" />
            <LanguagePicker />
          </div>
        </Section>

        <Section title={t('settings.notifications')}>
          <div className="setting-row">
            <Icon name="bell" />
            <span>{t('settings.enableNotifications')}</span>
            <Switch
              checked={push === 'on'}
              onChange={(v) => !pushBusy && (push === 'on' || push === 'off') && void togglePush(v)}
            />
          </div>
          {pushHint && <p className="setting-hint">{pushHint}</p>}
          <div className="setting-row">
            <Icon name="volume" />
            <span>{t('settings.sounds')}</span>
            <Switch checked={sound} onChange={setSound} />
          </div>
        </Section>

        <Section title={t('settings.privacy')}>
          <div className="setting-row">
            <Icon name="clock" />
            <span>{t('settings.hideLastSeen')}</span>
            <Switch
              checked={profile.hideLastSeen}
              onChange={(v) => void updateProfile(me, { hideLastSeen: v })}
            />
          </div>
          <p className="setting-hint">{t('settings.hideLastSeenHint')}</p>
          <button className="setting-row" onClick={() => navigate('/settings/blocked')}>
            <Icon name="ban" />
            <span>{t('settings.blocklist')}</span>
            <span className="muted">{blockedCount || ''}</span>
          </button>
        </Section>

        {!isStandalone() && (
          <Section title={t('settings.installTitle')}>
            <p className="setting-hint">{isIos() ? t('settings.installIos') : t('settings.installOther')}</p>
          </Section>
        )}

        <Section>
          {profile.role === 'admin' && (
            <button className="setting-row" onClick={() => navigate('/admin')}>
              <Icon name="shield" />
              <span>{t('settings.adminPanel')}</span>
            </button>
          )}
          <button className="setting-row danger" onClick={() => void logout()}>
            <Icon name="logout" />
            <span>{t('auth.logout')}</span>
          </button>
        </Section>
        <p className="version muted small">{t('settings.version', { version: __APP_VERSION__ })}</p>
      </div>
    </div>
  );
}
