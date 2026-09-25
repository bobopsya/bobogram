import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminUpdateProfile, errorKey, setProfileStyle, type ProfileStyle } from '../../supabase/api';
import type { UserProfile } from '../../supabase/types';
import { makeAvatar } from '../../lib/image';
import { useApp } from '../../app/store';
import { Avatar } from '../../ui/Avatar';
import { Modal } from '../../ui/Modal';
import { StylePicker } from '../profile/StylePicker';

/** Админ меняет пользователю имя, @имя, «О себе», аватарку и стиль профиля. */
export function AdminEditProfileDialog({
  user,
  onSaved,
  onClose,
}: {
  user: UserProfile;
  onSaved: (patch: Partial<UserProfile>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio);
  const [avatar, setAvatar] = useState(user.avatar);
  const [style, setStyle] = useState<ProfileStyle>({
    nameColor: user.nameColor ?? null,
    emojiStatus: user.emojiStatus ?? null,
    profileBg: user.profileBg ?? null,
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await adminUpdateProfile(user.uid, {
        displayName: name.trim() !== user.displayName ? name.trim() : undefined,
        username: username !== user.username ? username : undefined,
        bio: bio !== user.bio ? bio : undefined,
        avatar: avatar !== user.avatar ? avatar : undefined,
      });
      await setProfileStyle(user.uid, style);
      onSaved({ displayName: name.trim() || user.displayName, username, bio, avatar, ...style });
      showToast(t('admin.profileSaved'));
      onClose();
    } catch (e) {
      showToast(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('admin.editProfileFor', { username: user.username })}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          {t('common.save')}
        </button>
      }
    >
      <div className="stack">
        <div className="row gap center-v">
          <Avatar name={name} seed={user.uid} src={avatar} size={64} />
          <button type="button" className="btn btn-text" onClick={() => fileRef.current?.click()}>
            {t('profile.changeAvatar')}
          </button>
          {avatar && (
            <button type="button" className="btn btn-text danger" onClick={() => setAvatar(null)}>
              {t('profile.removeAvatar')}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f)
                void makeAvatar(f)
                  .then(setAvatar)
                  .catch(() => showToast(t('media.badPhoto')));
            }}
          />
        </div>
        <label className="field">
          <span className="field-label">{t('auth.displayName')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        </label>
        <label className="field">
          <span className="field-label">{t('profile.username')}</span>
          <div className="field-prefix">
            <span>@</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" />
          </div>
        </label>
        <label className="field">
          <span className="field-label">{t('profile.bio')}</span>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={200} />
        </label>
        <StylePicker value={style} onChange={setStyle} />
      </div>
    </Modal>
  );
}
