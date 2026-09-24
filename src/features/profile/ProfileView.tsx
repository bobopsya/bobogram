import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, useMe } from '../../app/store';
import { findUserByUsername, setBlocked } from '../../firebase/db';
import { usePresence, useProfile } from '../../app/profiles';
import { privateChatId, savedChatId } from '../../lib/ids';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { Confirm } from '../../ui/Modal';
import { FullScreenSpinner, PageHeader } from '../../ui/misc';
import { lastSeenText } from '../chat/ChatHeader';
import { startCall } from '../calls/callStore';
import { ShareProfile } from './ShareProfile';

export function profileLink(username: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}#/u/${username}`;
}

/** Открытие профиля по ссылке …/#/u/username */
export function UsernameRoute() {
  const { username = '' } = useParams();
  const { t } = useTranslation();
  const [uid, setUid] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    findUserByUsername(username)
      .then((p) => !cancelled && setUid(p?.uid ?? null))
      .catch(() => !cancelled && setUid(null));
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (uid === undefined) return <FullScreenSpinner />;
  if (uid === null) {
    return (
      <div className="screen">
        <PageHeader title={t('profile.title')} back="/" />
        <div className="empty-main">
          <span className="pill">{t('profile.notFound')}</span>
        </div>
      </div>
    );
  }
  return <ProfileScreen uid={uid} />;
}

export function ProfileRoute() {
  const { uid = '' } = useParams();
  return <ProfileScreen uid={uid} />;
}

function ProfileScreen({ uid }: { uid: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const profile = useProfile(uid);
  const presence = usePresence(uid);
  const hideMine = useApp((s) => s.profile?.hideLastSeen ?? false);
  const blocked = useApp((s) => s.blocked.includes(uid));
  const showToast = useApp((s) => s.showToast);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [share, setShare] = useState(false);

  if (profile === undefined) return <FullScreenSpinner />;
  if (profile === null) {
    return (
      <div className="screen">
        <PageHeader title={t('profile.title')} back={() => navigate(-1)} />
        <div className="empty-main">
          <span className="pill">{t('profile.notFound')}</span>
        </div>
      </div>
    );
  }

  const isMe = uid === me;
  const chatId = isMe ? savedChatId(me) : privateChatId(me, uid);

  return (
    <div className="screen">
      <PageHeader
        title={t('profile.title')}
        back={() => navigate(-1)}
        actions={
          isMe ? (
            <button className="icon-btn" onClick={() => navigate('/settings/profile')} aria-label={t('common.edit')}>
              <Icon name="edit" />
            </button>
          ) : undefined
        }
      />
      <div className="scroll">
        <div className="profile-hero">
          <Avatar name={profile.displayName} seed={uid} src={profile.avatar} size={112} />
          <h2>{profile.displayName}</h2>
          <p className={presence?.online ? 'accent-text' : 'muted'}>
            {isMe ? t('chats.online') : lastSeenText(presence, hideMine, t, i18n.language)}
          </p>
        </div>

        <div className="action-row">
          <button className="action-btn" onClick={() => navigate(`/c/${chatId}`)}>
            <Icon name={isMe ? 'bookmark' : 'send'} />
            <span>{isMe ? t('chats.savedMessages') : t('profile.sendMessage')}</span>
          </button>
          {!isMe && !blocked && (
            <>
              <button className="action-btn" onClick={() => startCall(chatId, uid, false)}>
                <Icon name="phone" />
                <span>{t('chat.callAudio')}</span>
              </button>
              <button className="action-btn" onClick={() => startCall(chatId, uid, true)}>
                <Icon name="video" />
                <span>{t('chat.callVideo')}</span>
              </button>
            </>
          )}
          <button className="action-btn" onClick={() => setShare(true)}>
            <Icon name="qr" />
            <span>{t('profile.qr')}</span>
          </button>
        </div>

        <div className="info-list">
          <button
            className="info-item"
            onClick={() =>
              void navigator.clipboard?.writeText('@' + profile.username).then(() => showToast(t('common.copied')))
            }
          >
            <Icon name="user" />
            <div>
              <div>@{profile.username}</div>
              <div className="muted small">{t('profile.username')}</div>
            </div>
          </button>
          {profile.bio && (
            <div className="info-item">
              <Icon name="edit" />
              <div>
                <div className="pre-wrap">{profile.bio}</div>
                <div className="muted small">{t('profile.bio')}</div>
              </div>
            </div>
          )}
          <button
            className="info-item"
            onClick={() =>
              void navigator.clipboard?.writeText(profileLink(profile.username)).then(() => showToast(t('common.copied')))
            }
          >
            <Icon name="link" />
            <div className="min0">
              <div className="ellipsis">{profileLink(profile.username)}</div>
              <div className="muted small">{t('profile.link')}</div>
            </div>
          </button>
          {!isMe && (
            <button
              className="info-item danger"
              onClick={() => (blocked ? void setBlocked(me, uid, false) : setConfirmBlock(true))}
            >
              <Icon name="ban" />
              <div>{blocked ? t('profile.unblock') : t('profile.block')}</div>
            </button>
          )}
        </div>
      </div>

      {confirmBlock && (
        <Confirm
          text={t('profile.blockConfirm', { name: profile.displayName })}
          confirmLabel={t('profile.block')}
          cancelLabel={t('common.cancel')}
          danger
          onConfirm={() => void setBlocked(me, uid, true)}
          onClose={() => setConfirmBlock(false)}
        />
      )}
      {share && <ShareProfile username={profile.username} onClose={() => setShare(false)} />}
    </div>
  );
}
