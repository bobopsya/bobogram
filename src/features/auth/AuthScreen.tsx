import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { authErrorKey, login, register, resetPassword } from '../../firebase/auth';
import { UsernameField, type UsernameStatus } from './UsernameField';
import { LanguagePicker } from '../settings/LanguagePicker';

type Mode = 'login' | 'register' | 'reset';

export function AuthScreen() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (mode === 'register' && usernameStatus !== 'free') return;
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else if (mode === 'register') await register(email, password, name, username);
      else {
        await resetPassword(email);
        setInfo(t('auth.resetSent'));
      }
    } catch (err) {
      setError(t(authErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'login' ? t('auth.loginTitle') : mode === 'register' ? t('auth.registerTitle') : t('auth.resetTitle');

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
        </div>
        <h1>{t('common.appName')}</h1>
        <h2>{title}</h2>

        {mode === 'reset' && <p className="muted">{t('auth.resetText')}</p>}

        <label className="field">
          <span className="field-label">{t('auth.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            required
          />
        </label>

        {mode !== 'reset' && (
          <label className="field">
            <span className="field-label">{t('auth.password')}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
            {mode === 'register' && <span className="field-hint">{t('auth.passwordHint')}</span>}
          </label>
        )}

        {mode === 'register' && (
          <>
            <label className="field">
              <span className="field-label">{t('auth.displayName')}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                maxLength={64}
                required
              />
            </label>
            <UsernameField value={username} onChange={setUsername} onStatus={setUsernameStatus} />
          </>
        )}

        {error && <p className="form-error">{error}</p>}
        {info && <p className="form-info">{info}</p>}

        <button
          className="btn btn-primary btn-block"
          disabled={busy || (mode === 'register' && usernameStatus !== 'free')}
        >
          {busy ? t('common.loading') : mode === 'login' ? t('auth.login') : mode === 'register' ? t('auth.register') : t('auth.sendReset')}
        </button>

        <div className="auth-links">
          {mode === 'login' && (
            <>
              <button type="button" className="link" onClick={() => switchMode('register')}>
                {t('auth.noAccount')}
              </button>
              <button type="button" className="link" onClick={() => switchMode('reset')}>
                {t('auth.forgot')}
              </button>
            </>
          )}
          {mode !== 'login' && (
            <button type="button" className="link" onClick={() => switchMode('login')}>
              {t('auth.haveAccount')}
            </button>
          )}
        </div>
        <LanguagePicker compact />
      </form>
    </div>
  );
}
