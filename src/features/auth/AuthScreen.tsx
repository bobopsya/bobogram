import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { errorKey, login, register } from '../../supabase/api';
import { normalizeUsername } from '../../lib/username';
import { UsernameField, type UsernameStatus } from './UsernameField';
import { LanguagePicker } from '../settings/LanguagePicker';

type Mode = 'login' | 'register' | 'forgot';

export function AuthScreen() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'register') {
      if (usernameStatus !== 'free') return;
      if (password !== password2) return setError(t('auth.passwordsDiffer'));
    }
    setBusy(true);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, name, password);
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'forgot') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-emoji">🔑</div>
          <h2>{t('auth.forgotTitle')}</h2>
          <p className="muted">{t('auth.forgotText')}</p>
          <button className="btn btn-primary btn-block" onClick={() => switchMode('login')}>
            {t('common.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
        </div>
        <h1>{t('common.appName')}</h1>
        <h2>{mode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle')}</h2>

        {mode === 'login' ? (
          <label className="field">
            <span className="field-label">{t('auth.username')}</span>
            <div className="field-prefix">
              <span>@</span>
              <input
                value={username}
                onChange={(e) => setUsername(normalizeUsername(e.target.value))}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                required
              />
            </div>
          </label>
        ) : (
          <>
            <label className="field">
              <span className="field-label">{t('auth.displayName')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={64} required />
            </label>
            <UsernameField value={username} onChange={setUsername} onStatus={setUsernameStatus} />
          </>
        )}

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
        {mode === 'register' && (
          <label className="field">
            <span className="field-label">{t('auth.password2')}</span>
            <input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>
        )}

        {error && <p className="form-error">{error}</p>}

        <button className="btn btn-primary btn-block" disabled={busy || (mode === 'register' && usernameStatus !== 'free')}>
          {busy ? t('common.loading') : mode === 'login' ? t('auth.login') : t('auth.register')}
        </button>

        <div className="auth-links">
          {mode === 'login' ? (
            <>
              <button type="button" className="link" onClick={() => switchMode('register')}>
                {t('auth.noAccount')}
              </button>
              <button type="button" className="link" onClick={() => switchMode('forgot')}>
                {t('auth.forgot')}
              </button>
            </>
          ) : (
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
