import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, useMe } from '../../app/store';
import { getInvite, joinByInvite, type InvitePreview } from '../../firebase/groups';
import { authErrorKey } from '../../firebase/auth';
import { Avatar } from '../../ui/Avatar';
import { FullScreenSpinner, PageHeader } from '../../ui/misc';

export function JoinScreen() {
  const { code = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const chats = useApp((s) => s.chats);
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

  const already = invite && chats.some((c) => c.id === invite.chatId);

  const join = async () => {
    if (!invite) return;
    setBusy(true);
    setError(null);
    try {
      await joinByInvite(code, invite, me);
      navigate(`/c/${invite.chatId}`, { replace: true });
    } catch (err) {
      const c = (err as { code?: string }).code;
      setError(c === 'permission-denied' ? t('groups.invalidInvite') : t(authErrorKey(err)));
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
            <p className="muted">{invite.type === 'channel' ? t('groups.channel') : t('groups.group')}</p>
            {error && <p className="form-error">{error}</p>}
            {already ? (
              <button className="btn btn-primary" onClick={() => navigate(`/c/${invite.chatId}`)}>
                {t('groups.alreadyMember')}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={join} disabled={busy}>
                {invite.type === 'channel' ? t('groups.subscribe') : t('groups.join')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
