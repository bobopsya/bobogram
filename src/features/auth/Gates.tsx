import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { authErrorKey, logout, refreshVerification, resendVerification } from '../../firebase/auth';
import { createProfile } from '../../firebase/db';
import { useApp } from '../../app/store';
import { UsernameField, type UsernameStatus } from './UsernameField';

/** Экран «подтвердите почту». Проверяет подтверждение сам при возврате во вкладку. */
export function VerifyEmailScreen() {
  const { t } = useTranslation();
  const email = useApp((s) => s.user?.email ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const check = () => document.visibilityState === 'visible' && void refreshVerification().catch(() => false);
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 5000);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, []);

  const checkNow = async () => {
    setBusy(true);
    try {
      const ok = await refreshVerification();
      if (!ok) setMsg(t('auth.verifyNotYet'));
    } catch (err) {
      setMsg(t(authErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await resendVerification();
      setMsg(t('auth.verifySent'));
    } catch (err) {
      setMsg(t(authErrorKey(err)));
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-emoji">📬</div>
        <h2>{t('auth.verifyTitle')}</h2>
        <p className="muted">{t('auth.verifyText', { email })}</p>
        {msg && <p className="form-info">{msg}</p>}
        <button className="btn btn-primary btn-block" onClick={checkNow} disabled={busy}>
          {t('auth.verifyCheck')}
        </button>
        <div className="auth-links">
          <button className="link" onClick={resend}>
            {t('auth.verifyResend')}
          </button>
          <button className="link" onClick={() => void logout()}>
            {t('auth.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Если при регистрации юзернейм успели занять — выбираем новый. */
export function PickUsernameScreen() {
  const { t } = useTranslation();
  const uid = useApp((s) => s.user!.uid);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<UsernameStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status !== 'free') return;
    setBusy(true);
    setError(null);
    try {
      await createProfile(uid, username, name);
    } catch (err) {
      setError(t(authErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h2>{t('auth.pickUsernameTitle')}</h2>
        <p className="muted">{t('auth.pickUsernameText')}</p>
        <label className="field">
          <span className="field-label">{t('auth.displayName')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required />
        </label>
        <UsernameField value={username} onChange={setUsername} onStatus={setStatus} />
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || status !== 'free'}>
          {t('common.done')}
        </button>
        <div className="auth-links">
          <button type="button" className="link" onClick={() => void logout()}>
            {t('auth.logout')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function BannedScreen() {
  const { t } = useTranslation();
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-emoji">⛔</div>
        <h2>{t('auth.bannedTitle')}</h2>
        <p className="muted">{t('auth.bannedText')}</p>
        <button className="btn btn-block" onClick={() => void logout()}>
          {t('auth.logout')}
        </button>
      </div>
    </div>
  );
}

export function SetupNeededScreen() {
  const { t } = useTranslation();
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-emoji">🛠️</div>
        <h2>{t('setup.title')}</h2>
        <p className="muted">{t('setup.text')}</p>
      </div>
    </div>
  );
}
