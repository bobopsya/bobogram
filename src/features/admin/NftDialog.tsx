import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminGrantNft, adminRevokeNft, errorKey, isUsernameFree } from '../../supabase/api';
import type { UserProfile } from '../../supabase/types';
import { normalizeUsername, validateUsername } from '../../lib/username';
import { useApp } from '../../app/store';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';

/** Выдача и отзыв вторых/коллекционных юзернеймов пользователя. */
export function NftDialog({
  user,
  onChange,
  onClose,
}: {
  user: UserProfile;
  onChange: (names: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [names, setNames] = useState(user.nftUsernames);
  const [value, setValue] = useState('');
  const [free, setFree] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const name = normalizeUsername(value);
  const invalid = name ? validateUsername(name) : null;
  const matchesPrimary = !!name && name.toLowerCase() === user.username.toLowerCase();

  useEffect(() => {
    setFree(null);
    if (!name || invalid) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void isUsernameFree(name)
        .then((ok) => !cancelled && setFree(ok))
        .catch(() => undefined);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [name, invalid]);

  const update = (next: string[]) => {
    setNames(next);
    onChange(next);
  };

  const grant = async () => {
    setBusy(true);
    try {
      await adminGrantNft(user.uid, name);
      update([...names, name].sort());
      setValue('');
    } catch (e) {
      showToast(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const revoke = (n: string) =>
    void adminRevokeNft(n)
      .then(() => update(names.filter((x) => x !== n)))
      .catch((e: unknown) => showToast(t(errorKey(e))));

  return (
    <Modal
      title={t('nft.title', { username: user.username })}
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary"
          disabled={!name || !!invalid || matchesPrimary || free !== true || busy}
          onClick={() => void grant()}
        >
          {t('nft.grant')}
        </button>
      }
    >
      {names.length > 0 ? (
        <div className="nft-list">
          {names.map((n) => (
            <div key={n} className="nft-list-item">
              <span>💎 @{n}</span>
              <button
                className="icon-btn small"
                onClick={() => revoke(n)}
                aria-label={t('nft.revoke')}
                title={t('nft.revoke')}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">{t('nft.none')}</p>
      )}
      <label className="field">
        <span className="field-label">{t('nft.newName')}</span>
        <div className="field-prefix">
          <span>@</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
          />
        </div>
        <span className={invalid || free === false ? 'field-hint danger' : 'field-hint'}>
          {invalid
            ? t(`username.${invalid}`)
            : matchesPrimary || free === false
              ? t('nft.taken')
              : free
                ? t('nft.free')
                : t('nft.hint')}
        </span>
      </label>
    </Modal>
  );
}
