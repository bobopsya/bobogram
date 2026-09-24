import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, getDocs, limit, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../../firebase/init';
import { toChat, toProfile, userRef } from '../../firebase/db';
import { deleteGroup } from '../../firebase/groups';
import { authErrorKey } from '../../firebase/auth';
import type { Chat, UserProfile } from '../../firebase/types';
import { useApp, useMe } from '../../app/store';
import { Avatar } from '../../ui/Avatar';
import { Confirm } from '../../ui/Modal';
import { PageHeader, Section, Spinner } from '../../ui/misc';

/** Админ-панель: бан пользователей и модерация групп/каналов. Личные чаты недоступны. */
export default function AdminPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const role = useApp((s) => s.profile?.role);
  const showToast = useApp((s) => s.showToast);
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [q, setQ] = useState('');
  const [deleting, setDeleting] = useState<Chat | null>(null);

  useEffect(() => {
    if (role !== 'admin') return;
    void getDocs(query(collection(db, 'users'), limit(500))).then((snap) =>
      setUsers(snap.docs.map((d) => toProfile(d)!).filter(Boolean)),
    );
    void getDocs(query(collection(db, 'chats'), where('type', 'in', ['group', 'channel']), limit(500))).then((snap) =>
      setChats(snap.docs.map((d) => toChat(d)!).filter(Boolean)),
    );
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
  const fail = (e: unknown) => showToast(t(authErrorKey(e)));

  const setBan = (u: UserProfile, banned: boolean) => {
    void updateDoc(userRef(u.uid), { banned })
      .then(() => setUsers((list) => list?.map((x) => (x.uid === u.uid ? { ...x, banned } : x)) ?? null))
      .catch(fail);
  };

  return (
    <div className="screen">
      <PageHeader title={t('admin.title')} back="/" />
      <div className="scroll">
        <p className="setting-hint">{t('admin.hint')}</p>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} />

        <Section title={t('admin.users')}>
          {!users ? (
            <div className="center-pad">
              <Spinner />
            </div>
          ) : (
            users
              .filter((u) => !ql || u.usernameLower.includes(ql) || u.displayName.toLowerCase().includes(ql))
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
                    <button className={u.banned ? 'btn btn-text' : 'btn btn-text danger'} onClick={() => setBan(u, !u.banned)}>
                      {u.banned ? t('admin.unban') : t('admin.ban')}
                    </button>
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
              .filter((c) => !ql || (c.title ?? '').toLowerCase().includes(ql))
              .map((c) => (
                <div key={c.id} className="list-item">
                  <button className="plain row gap grow min0" onClick={() => navigate(`/c/${c.id}`)}>
                    <Avatar name={c.title ?? ''} seed={c.id} src={c.avatar} size={40} icon={c.type === 'channel' ? 'megaphone' : undefined} />
                    <div className="list-item-body">
                      <div className="list-item-title ellipsis">{c.title}</div>
                      <div className="list-item-sub">
                        {c.type === 'channel'
                          ? t('chats.subscribers', { count: c.members.length })
                          : t('chats.members', { count: c.members.length })}
                      </div>
                    </div>
                  </button>
                  <button className="btn btn-text danger" onClick={() => setDeleting(c)}>
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
            void deleteGroup(deleting)
              .then(() => setChats((list) => list?.filter((x) => x.id !== deleting.id) ?? null))
              .catch(fail)
          }
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
