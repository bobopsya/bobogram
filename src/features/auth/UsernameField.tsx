import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isUsernameFree } from '../../firebase/db';
import { normalizeUsername, validateUsername } from '../../lib/username';

export type UsernameStatus = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onStatus: (s: UsernameStatus) => void;
  /** Мой uid: своё текущее имя считается свободным. */
  myUid?: string;
}

/** Поле @юзернейма с живой проверкой формата и занятости. */
export function UsernameField({ value, onChange, onStatus, myUid }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UsernameStatus>('idle');
  const error = value ? validateUsername(value) : null;

  useEffect(() => {
    if (!value) return update('idle');
    if (error) return update('invalid');
    update('checking');
    let cancelled = false;
    const timer = window.setTimeout(() => {
      isUsernameFree(value, myUid)
        .then((free) => !cancelled && update(free ? 'free' : 'taken'))
        .catch(() => !cancelled && update('idle'));
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };

    function update(s: UsernameStatus) {
      setStatus(s);
      onStatus(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, error, myUid]);

  let hint = t('auth.usernameHint');
  let cls = 'field-hint';
  if (error) {
    hint = t(`username.${error}`);
    cls += ' error';
  } else if (status === 'checking') hint = t('auth.checking');
  else if (status === 'free') {
    hint = t('auth.usernameFree');
    cls += ' ok';
  } else if (status === 'taken') {
    hint = t('auth.usernameTaken');
    cls += ' error';
  }

  return (
    <label className="field">
      <span className="field-label">{t('auth.username')}</span>
      <div className="field-prefix">
        <span>@</span>
        <input
          value={value}
          onChange={(e) => onChange(normalizeUsername(e.target.value))}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          maxLength={32}
          required
        />
      </div>
      <span className={cls}>{hint}</span>
    </label>
  );
}
