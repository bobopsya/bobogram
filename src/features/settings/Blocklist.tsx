import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, useMe } from '../../app/store';
import { setBlocked } from '../../firebase/db';
import { displayNameOf, useProfile } from '../../app/profiles';
import { Avatar } from '../../ui/Avatar';
import { PageHeader } from '../../ui/misc';

function Row({ uid, me }: { uid: string; me: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const p = useProfile(uid);
  return (
    <div className="list-item">
      <button className="plain row gap grow" onClick={() => navigate(`/profile/${uid}`)}>
        <Avatar name={displayNameOf(p, '?')} seed={uid} src={p?.avatar} size={42} />
        <div className="list-item-body">
          <div className="list-item-title">{displayNameOf(p, '…')}</div>
          {p && <div className="list-item-sub">@{p.username}</div>}
        </div>
      </button>
      <button className="btn btn-text" onClick={() => void setBlocked(me, uid, false)}>
        {t('profile.unblock')}
      </button>
    </div>
  );
}

export function BlocklistScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const blocked = useApp((s) => s.blocked);
  return (
    <div className="screen">
      <PageHeader title={t('settings.blocklist')} back="/settings" />
      <div className="scroll">
        {blocked.length === 0 ? (
          <div className="list-empty">{t('settings.blocklistEmpty')}</div>
        ) : (
          blocked.map((uid) => <Row key={uid} uid={uid} me={me} />)
        )}
      </div>
    </div>
  );
}
