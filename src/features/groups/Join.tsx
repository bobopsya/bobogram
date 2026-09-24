import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { errorKey, getInvite, joinByInvite, type InvitePreview } from '../../supabase/api';
import { refreshChats } from '../../app/session';
import { Avatar } from '../../ui/Avatar';
import { FullScreenSpinner, PageHeader } from '../../ui/misc';

export function JoinScreen() {
  const { code = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InvitePreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInvite(code)
      .then((inv) => !cancelled && setInvite(inv))
      .catch(() => !cancelled && setInvite(null));
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (invite === undefined) return <FullScreenSpinner />;

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await joinByInvite(code);
      refreshChats(0);
      navigate(`/c/${id}`, { replace: true });
    } catch (err) {
      setError(t(errorKey(err)));
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <PageHeader title={t('groups.joinTitle')} back="/" />
      <div className="scroll">
        {!invite ? (
          <div className="empty-main">
            <span className="pill">{t('groups.invalidInvite')}</span>
          </div>
        ) : (
          <div className="profile-hero">
            <Avatar name={invite.title} seed={invite.chatId} src={invite.avatar} size={112} />
            <h2>{invite.title}</h2>
            <p className="muted">
              {invite.type === 'channel'
                ? t('chats.subscribers', { count: invite.memberCount })
                : t('chats.members', { count: invite.memberCount })}
            </p>
            {error && <p className="form-error">{error}</p>}
            {invite.isMember ? (
              <button className="btn btn-primary" onClick={() => navigate(`/c/${invite.chatId}`)}>
                {t('groups.alreadyMember')}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => void join()} disabled={busy}>
                {invite.type === 'channel' ? t('groups.subscribe') : t('groups.join')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
