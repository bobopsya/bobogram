import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store';
import { createChat, errorKey } from '../../supabase/api';
import { refreshChats } from '../../app/session';
import { CHANNEL_MAX_MEMBERS, GROUP_MAX_MEMBERS, GROUP_MAX_MEMBERS_PREMIUM, isPremium } from '../../supabase/types';
import { makeAvatar } from '../../lib/image';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { PageHeader } from '../../ui/misc';
import { PeoplePicker } from './PeoplePicker';

/** Создание группы (сначала участники, потом название) или канала (сразу название). */
export function NewGroupScreen({ kind }: { kind: 'group' | 'channel' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const showToast = useApp((s) => s.showToast);
  const [step, setStep] = useState<'members' | 'info'>(kind === 'group' ? 'members' : 'info');
  const [members, setMembers] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const premium = useApp((s) => isPremium(s.profile));
  const max = (kind === 'group' ? (premium ? GROUP_MAX_MEMBERS_PREMIUM : GROUP_MAX_MEMBERS) : CHANNEL_MAX_MEMBERS) - 1;

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const id = await createChat({ kind, title, description, avatar, members });
      refreshChats(0);
      navigate(`/c/${id}`, { replace: true });
    } catch (err) {
      showToast(t(errorKey(err)));
      setBusy(false);
    }
  };

  if (step === 'members') {
    return (
      <div className="screen">
        <PageHeader
          title={t('groups.addMembers')}
          back={() => navigate(-1)}
          actions={
            <button className="icon-btn" onClick={() => setStep('info')} aria-label={t('common.next')}>
              <Icon name="forward" />
            </button>
          }
        />
        <div className="scroll">
          <PeoplePicker selected={members} onChange={setMembers} max={max} />
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <PageHeader
        title={kind === 'group' ? t('chats.newGroup') : t('chats.newChannel')}
        back={() => (kind === 'group' ? setStep('members') : navigate(-1))}
      />
      <div className="scroll form-page">
        <div className="row gap center-v">
          <button className="avatar-edit plain" onClick={() => fileRef.current?.click()}>
            <Avatar name={title || '?'} seed={title || 'new'} src={avatar} size={72} icon={avatar ? undefined : 'plus'} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) setAvatar(await makeAvatar(file).catch(() => null));
            }}
          />
          <label className="field grow">
            <span className="field-label">{kind === 'group' ? t('groups.groupName') : t('groups.channelName')}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={64} autoFocus />
          </label>
        </div>
        <label className="field">
          <span className="field-label">{t('groups.description')}</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} rows={3} />
        </label>
        {kind === 'group' && (
          <p className="muted small">{t('chats.members', { count: members.length + 1 })}</p>
        )}
        <button className="btn btn-primary btn-block" disabled={!title.trim() || busy} onClick={create}>
          {kind === 'group' ? t('groups.createGroup') : t('groups.createChannel')}
        </button>
      </div>
    </div>
  );
}
