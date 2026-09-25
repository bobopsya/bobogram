import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, useMe, useMyProfile, type ThemeMode } from '../../app/store';
import { changePassword, errorKey, logout, updateProfile } from '../../supabase/api';
import { disablePush, enablePush, pushState, type PushState } from '../../supabase/push';
import { Modal } from '../../ui/Modal';
import { PremiumIcon } from '../../ui/Badges';
import { isPremium } from '../../supabase/types';
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
  const enterToSend = useApp((s) => s.enterToSend);
  const setEnterToSend = useApp((s) => s.setEnterToSend);
  const blockedCount = useApp((s) => s.blocked.length);
  const [push, setPush] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    void pushState().then(setPush);
  }, []);

  const togglePush = async (on: boolean) => {
    setPushBusy(true);
    try {
      if (on) setPush(await enablePush());
      else {
        await disablePush();
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
          <button className="setting-row" onClick={() => navigate('/settings/appearance')}>
            <Icon name="edit" />
            <span>{t('appearance.title')}</span>
            <Icon name="forward" size={18} />
          </button>
          <div className="setting-row">
            <Icon name="globe" />
            <LanguagePicker />
          </div>
        </Section>

        <Section>
          <button className="setting-row premium-row" onClick={() => navigate('/settings/premium')}>
            <PremiumIcon size={22} />
            <span>{t('premium.title')}</span>
            <span className="muted small">{isPremium(profile) ? t('premium.active') : ''}</span>
          </button>
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
          <div className="setting-row">
            <Icon name="send" />
            <span>{t('settings.enterToSend')}</span>
            <Switch checked={enterToSend} onChange={setEnterToSend} />
          </div>
          {!enterToSend && <p className="setting-hint">{t('settings.enterToSendHint')}</p>}
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

        <Section title={t('settings.account')}>
          <button className="setting-row" onClick={() => setPwOpen(true)}>
            <Icon name="lock" />
            <span>{t('settings.changePassword')}</span>
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
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
    </div>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (pw !== pw2) return setError(t('auth.passwordsDiffer'));
    setBusy(true);
    try {
      await changePassword(pw);
      showToast(t('settings.passwordChanged'));
      onClose();
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('settings.changePassword')}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={busy || pw.length < 6} onClick={() => void save()}>
          {t('common.save')}
        </button>
      }
    >
      <label className="field">
        <span className="field-label">{t('settings.newPassword')}</span>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete="new-password"
          minLength={6}
        />
        <span className="field-hint">{t('auth.passwordHint')}</span>
      </label>
      <label className="field">
        <span className="field-label">{t('auth.password2')}</span>
        <input
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          autoComplete="new-password"
        />
      </label>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
