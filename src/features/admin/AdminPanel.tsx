import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { adminListChats, adminResetPassword, deleteChat, errorKey, listUsers, setBanned } from '../../supabase/api';
import type { UserProfile } from '../../supabase/types';
import { useApp, useMe } from '../../app/store';
import { Avatar } from '../../ui/Avatar';
import { Confirm, Modal } from '../../ui/Modal';
import { PageHeader, Section, Spinner } from '../../ui/misc';

type AdminChat = Awaited<ReturnType<typeof adminListChats>>[number];

/** Админ-панель: бан, новый пароль и модерация групп/каналов. Личные чаты недоступны. */
export default function AdminPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const role = useApp((s) => s.profile?.role);
  const showToast = useApp((s) => s.showToast);
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [chats, setChats] = useState<AdminChat[] | null>(null);
  const [q, setQ] = useState('');
  const [deleting, setDeleting] = useState<AdminChat | null>(null);
  const [resetFor, setResetFor] = useState<UserProfile | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const fail = (e: unknown) => showToast(t(errorKey(e)));

  useEffect(() => {
    if (role !== 'admin') return;
    void listUsers().then(setUsers).catch(fail);
    void adminListChats().then(setChats).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  if (role !== 'admin') {
    return (
      <div className="screen">
        <PageHeader title={t('admin.title')} back="/" />
        <div className="empty-main">
          <span className="pill">{t('admin.notAdmin')}</span>
        </div>
      </div>
    );
  }

  const ql = q.trim().toLowerCase().replace(/^@/, '');

  const setBan = (u: UserProfile, banned: boolean) => {
    void setBanned(u.uid, banned)
      .then(() => setUsers((list) => list?.map((x) => (x.uid === u.uid ? { ...x, banned } : x)) ?? null))
      .catch(fail);
  };

  const doReset = () => {
    const u = resetFor!;
    void adminResetPassword(u.uid, newPassword)
      .then(() => showToast(t('admin.passwordReset')))
      .catch(fail);
    setResetFor(null);
  };

  return (
    <div className="screen">
      <PageHeader title={t('admin.title')} back="/" />
      <div className="scroll">
        <p className="setting-hint">{t('admin.hint')}</p>
        <div className="pad-x">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} />
        </div>

        <Section title={t('admin.users')}>
          {!users ? (
            <div className="center-pad">
              <Spinner />
            </div>
          ) : (
            users
              .filter((u) => !ql || u.username.toLowerCase().includes(ql) || u.displayName.toLowerCase().includes(ql))
              .map((u) => (
                <div key={u.uid} className="list-item">
                  <button className="plain row gap grow min0" onClick={() => navigate(`/profile/${u.uid}`)}>
                    <Avatar name={u.displayName} seed={u.uid} src={u.avatar} size={40} />
                    <div className="list-item-body">
                      <div className="list-item-title ellipsis">
                        {u.displayName} {u.role === 'admin' && '🛡️'}
                      </div>
                      <div className={u.banned ? 'list-item-sub danger' : 'list-item-sub'}>
                        @{u.username} {u.banned && `· ${t('admin.banned')}`}
                      </div>
                    </div>
                  </button>
                  {u.uid !== me && (
                    <>
                      <button
                        className="btn btn-text small"
                        onClick={() => {
                          setNewPassword('');
                          setResetFor(u);
                        }}
                      >
                        {t('admin.resetPassword')}
                      </button>
                      <button
                        className={u.banned ? 'btn btn-text small' : 'btn btn-text small danger'}
                        onClick={() => setBan(u, !u.banned)}
                      >
                        {u.banned ? t('admin.unban') : t('admin.ban')}
                      </button>
                    </>
                  )}
                </div>
              ))
          )}
        </Section>

        <Section title={t('admin.chats')}>
          {!chats ? (
            <div className="center-pad">
              <Spinner />
            </div>
          ) : (
            chats
              .filter((c) => !ql || c.title.toLowerCase().includes(ql))
              .map((c) => (
                <div key={c.id} className="list-item">
                  <button className="plain row gap grow min0" onClick={() => navigate(`/c/${c.id}`)}>
                    <Avatar name={c.title} seed={c.id} src={c.avatar} size={40} icon={c.type === 'channel' ? 'megaphone' : undefined} />
                    <div className="list-item-body">
                      <div className="list-item-title ellipsis">{c.title}</div>
                      <div className="list-item-sub">
                        {c.type === 'channel'
                          ? t('chats.subscribers', { count: c.memberCount })
                          : t('chats.members', { count: c.memberCount })}
                      </div>
                    </div>
                  </button>
                  <button className="btn btn-text small danger" onClick={() => setDeleting(c)}>
                    {t('admin.deleteChat')}
                  </button>
                </div>
              ))
          )}
        </Section>
      </div>

      {deleting && (
        <Confirm
          text={t('groups.deleteConfirm', { title: deleting.title })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onConfirm={() =>
            void deleteChat(deleting.id)
              .then(() => setChats((list) => list?.filter((x) => x.id !== deleting.id) ?? null))
              .catch(fail)
          }
          onClose={() => setDeleting(null)}
        />
      )}

      {resetFor && (
        <Modal
          title={t('admin.resetPasswordFor', { username: resetFor.username })}
          onClose={() => setResetFor(null)}
          footer={
            <button className="btn btn-primary" disabled={newPassword.length < 6} onClick={doReset}>
              {t('common.save')}
            </button>
          }
        >
          <label className="field">
            <span className="field-label">{t('settings.newPassword')}</span>
            <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="off" />
            <span className="field-hint">{t('auth.passwordHint')}</span>
          </label>
        </Modal>
      )}
    </div>
  );
}
