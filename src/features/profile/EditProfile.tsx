import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, useMe, useMyProfile } from '../../app/store';
import { errorKey, setProfileStyle, updateProfile, type ProfileStyle } from '../../supabase/api';
import { StylePicker } from './StylePicker';
import { BIO_MAX, BIO_MAX_PREMIUM, isPremium } from '../../supabase/types';
import { makeAvatar } from '../../lib/image';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { PageHeader } from '../../ui/misc';
import { UsernameField, type UsernameStatus } from '../auth/UsernameField';

export function EditProfileScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const profile = useMyProfile();
  const showToast = useApp((s) => s.showToast);
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [username, setUsername] = useState(profile.username);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('free');
  const [avatar, setAvatar] = useState(profile.avatar);
  const bioMax = isPremium(profile) ? BIO_MAX_PREMIUM : BIO_MAX;
  const [busy, setBusy] = useState(false);
  const locked = !!profile.profileLocked;
  const [style, setStyle] = useState<ProfileStyle>({
    nameColor: profile.nameColor ?? null,
    emojiStatus: profile.emojiStatus ?? null,
    profileBg: profile.profileBg ?? null,
  });
  const [styleBusy, setStyleBusy] = useState(false);
  const saveStyle = async () => {
    setStyleBusy(true);
    try {
      await setProfileStyle(profile.uid, style);
      useApp.setState({ profile: { ...profile, ...style } });
      showToast(t('profile.saved'));
    } catch (e) {
      showToast(t(errorKey(e)));
    } finally {
      setStyleBusy(false);
    }
  };
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const usernameChanged = username !== profile.username;
  const canSave =
    name.trim().length > 0 && (!usernameChanged || usernameStatus === 'free' || usernameStatus === 'idle');

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAvatar(await makeAvatar(file));
    } catch {
      setError(t('errors.avatarTooBig'));
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateProfile(me, {
        displayName: name.trim(),
        bio: bio.trim(),
        avatar,
        ...(usernameChanged ? { username } : {}),
      });
      showToast(t('profile.saved'));
      navigate(-1);
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <PageHeader
        title={t('profile.edit')}
        back={() => navigate(-1)}
        actions={
          <button
            className="icon-btn"
            onClick={save}
            disabled={!canSave || busy || locked}
            aria-label={t('common.save')}
          >
            <Icon name="check" />
          </button>
        }
      />
      <div className="scroll form-page">
        {locked && <p className="notice">{t('errors.profileLocked')}</p>}
        <fieldset className="bare-fieldset" disabled={locked}>
          <div className="profile-hero">
            <button className="avatar-edit plain" onClick={() => fileRef.current?.click()}>
              <Avatar name={name || profile.username} seed={me} src={avatar} size={112} />
              <span className="avatar-edit-badge">
                <Icon name="edit" size={18} />
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void pickAvatar(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          <div className="row gap">
            <button className="btn btn-text" onClick={() => fileRef.current?.click()}>
              {t('profile.changeAvatar')}
            </button>
            {avatar && (
                <button className="btn btn-text danger" onClick={() => setAvatar(null)}>
                {t('profile.removeAvatar')}
              </button>
            )}
          </div>
        </div>

          <label className="field">
            <span className="field-label">{t('auth.displayName')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
          </label>
          <UsernameField
            value={username}
            onChange={setUsername}
            onStatus={setUsernameStatus}
            current={profile.username}
          />
          <label className="field">
            <span className="field-label">{t('profile.bio')}</span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={bioMax}
              rows={3}
              placeholder={t('profile.bioPlaceholder')}
            />
            <span className="field-hint">{bioMax - bio.length}</span>
          </label>
        </fieldset>
        <div className="section-title">{t('style.title')}</div>
        {isPremium(profile) ? (
          <>
            <StylePicker value={style} onChange={setStyle} />
            <button className="btn btn-block" onClick={() => void saveStyle()} disabled={styleBusy}>
              {t('common.save')}
            </button>
          </>
        ) : (
          <button className="info-item" onClick={() => navigate('/settings/premium')}>
            <Icon name="star" />
            <div className="muted small">{t('style.premiumOnly')}</div>
          </button>
        )}
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary btn-block" onClick={save} disabled={!canSave || busy || locked}>
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}
