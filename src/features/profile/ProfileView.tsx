import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, useMe } from '../../app/store';
import { errorKey, findUserByUsername, openPrivateChat, profileLink, setBlocked } from '../../supabase/api';
import { usePresence, useProfile } from '../../app/profiles';
import { refreshBlocked } from '../../app/session';
import { useOpenChatWith } from '../chats/ChatList';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { Confirm } from '../../ui/Modal';
import { FullScreenSpinner, PageHeader } from '../../ui/misc';
import { lastSeenText } from '../chat/ChatHeader';
import { startCall } from '../calls/callStore';
import { ShareProfile } from './ShareProfile';
import { ReportDialog } from '../chat/ReportDialog';
import { Badges, ScamWarning } from '../../ui/Badges';
import { isPremium } from '../../supabase/types';
import { nameColorStyle, profileBgCss } from '../../app/themes';

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
  const [reporting, setReporting] = useState(false);
  const openChatWith = useOpenChatWith();
  const block = (b: boolean) =>
    void setBlocked(uid, b)
      .then(refreshBlocked)
      .catch((e) => showToast(t(errorKey(e))));

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
  const call = async (video: boolean) => {
    try {
      startCall(await openPrivateChat(uid), uid, video);
    } catch (e) {
      showToast(t(errorKey(e)));
    }
  };

  return (
    <div className="screen">
      <PageHeader
        title={t('profile.title')}
        back={() => navigate(-1)}
        actions={
          isMe ? (
            <button
              className="icon-btn"
              onClick={() => navigate('/settings/profile')}
              aria-label={t('common.edit')}
            >
              <Icon name="edit" />
            </button>
          ) : undefined
        }
      />
      <div className="scroll">
        {profile.scam && <ScamWarning />}
        <div
          className={profile.profileBg ? 'profile-hero styled' : 'profile-hero'}
          style={profile.profileBg ? { background: profileBgCss(profile.profileBg) } : undefined}
        >
          <Avatar name={profile.displayName} seed={uid} src={profile.avatar} size={112} />
          <h2 className="name-with-badges">
            <span style={profile.profileBg ? undefined : nameColorStyle(profile.nameColor)}>
              {profile.displayName}
            </span>
            <Badges
              verified={profile.verified}
              scam={profile.scam}
              premium={isPremium(profile)}
              emoji={profile.emojiStatus}
              developer={profile.developer}
              size={22}
            />
          </h2>
          <p className={presence?.online ? 'accent-text' : 'muted'}>
            {isMe ? t('chats.online') : lastSeenText(presence, hideMine, t, i18n.language)}
          </p>
        </div>

        <div className="action-row">
          <button className="action-btn" onClick={() => void openChatWith(uid)}>
            <Icon name={isMe ? 'bookmark' : 'send'} />
            <span>{isMe ? t('chats.savedMessages') : t('profile.sendMessage')}</span>
          </button>
          {!isMe && !blocked && (
            <>
              <button className="action-btn" onClick={() => void call(false)}>
                <Icon name="phone" />
                <span>{t('chat.callAudio')}</span>
              </button>
              <button className="action-btn" onClick={() => void call(true)}>
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
              void navigator.clipboard
                ?.writeText('@' + profile.username)
                .then(() => showToast(t('common.copied')))
            }
          >
            <Icon name="user" />
            <div>
              <div>@{profile.username}</div>
              <div className="muted small">{t('profile.username')}</div>
            </div>
          </button>
          {(profile.nftUsernames ?? []).length > 0 && (
            <div className="info-item">
              <Icon name="gem" />
              <div className="min0">
                <div className="nft-names">
                  {profile.nftUsernames.map((name) => (
                    <button
                      key={name}
                      className="nft-name plain"
                      onClick={() =>
                        void navigator.clipboard
                          ?.writeText('@' + name)
                          .then(() => showToast(t('common.copied')))
                      }
                    >
                      💎 @{name}
                    </button>
                  ))}
                </div>
                <div className="muted small">{t('nft.collectible')}</div>
              </div>
            </div>
          )}
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
              void navigator.clipboard
                ?.writeText(profileLink(profile.username))
                .then(() => showToast(t('common.copied')))
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
              onClick={() => (blocked ? block(false) : setConfirmBlock(true))}
            >
              <Icon name="ban" />
              <div>{blocked ? t('profile.unblock') : t('profile.block')}</div>
            </button>
          )}
          {!isMe && !profile.isBot && (
            <button className="info-item danger" onClick={() => setReporting(true)}>
              <Icon name="flag" />
              <div>{t('report.action')}</div>
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
          onConfirm={() => block(true)}
          onClose={() => setConfirmBlock(false)}
        />
      )}
      {share && <ShareProfile username={profile.username} onClose={() => setShare(false)} />}
      {reporting && <ReportDialog userId={uid} onClose={() => setReporting(false)} />}
    </div>
  );
}
