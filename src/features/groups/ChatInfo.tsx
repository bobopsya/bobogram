import { useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useApp, useMe } from '../../app/store';
import type { Chat } from '../../firebase/types';
import { CHANNEL_MAX_MEMBERS, GROUP_MAX_MEMBERS } from '../../firebase/types';
import {
  addMembers,
  deleteGroup,
  inviteLink,
  leaveGroup,
  removeMember,
  resetInvite,
  setAdmin,
  updateGroupInfo,
} from '../../firebase/groups';
import { setChatMuted } from '../../firebase/db';
import { authErrorKey } from '../../firebase/auth';
import { displayNameOf, usePresence, useProfile } from '../../app/profiles';
import { isMuted } from '../../app/sounds';
import { makeAvatar } from '../../lib/image';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Confirm, Modal } from '../../ui/Modal';
import { FullScreenSpinner, PageHeader, Switch } from '../../ui/misc';
import { useChat } from '../chat/useChatData';
import { lastSeenText } from '../chat/ChatHeader';
import { ShareLink } from '../profile/ShareProfile';
import { PeoplePicker } from './PeoplePicker';

export function ChatInfoRoute() {
  const { chatId = '' } = useParams();
  const me = useMe();
  const { chat, status } = useChat(chatId, me);
  if (status === 'loading') return <FullScreenSpinner />;
  if (!chat || (chat.type !== 'group' && chat.type !== 'channel')) return <Navigate to={`/c/${chatId}`} replace />;
  return <ChatInfo chat={chat} me={me} />;
}

function MemberRow({ chat, uid, me, canManage }: { chat: Chat; uid: string; me: string; canManage: boolean }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const p = useProfile(uid);
  const presence = usePresence(uid);
  const hideMine = useApp((s) => s.profile?.hideLastSeen ?? false);
  const showToast = useApp((s) => s.showToast);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const isOwner = chat.ownerId === uid;
  const isAdmin = chat.admins.includes(uid);

  const items: MenuItem[] = [];
  if (canManage && uid !== me && !isOwner) {
    if (chat.ownerId === me) {
      items.push(
        isAdmin
          ? { icon: 'user', label: t('groups.removeAdmin'), onClick: () => void setAdmin(chat, uid, false) }
          : { icon: 'shield', label: t('groups.makeAdmin'), onClick: () => void setAdmin(chat, uid, true) },
      );
    }
    if (!isAdmin || chat.ownerId === me) {
      items.push({
        icon: 'trash',
        label: t('groups.removeMember'),
        danger: true,
        onClick: () => void removeMember(chat, me, uid).catch((e) => showToast(t(authErrorKey(e)))),
      });
    }
  }

  return (
    <>
      <div className="list-item">
        <button className="plain row gap grow min0" onClick={() => navigate(`/profile/${uid}`)}>
          <Avatar name={displayNameOf(p, '?')} seed={uid} src={p?.avatar} size={42} online={presence?.online} />
          <div className="list-item-body">
            <div className="list-item-title ellipsis">{uid === me ? t('common.you') : displayNameOf(p, '…')}</div>
            <div className={presence?.online ? 'list-item-sub accent-text' : 'list-item-sub'}>
              {lastSeenText(presence, hideMine, t, i18n.language)}
            </div>
          </div>
        </button>
        {(isOwner || isAdmin) && <span className="muted small">{isOwner ? t('groups.owner') : t('groups.admin')}</span>}
        {items.length > 0 && (
          <button className="icon-btn small" onClick={(e) => setMenu({ x: e.clientX - 200, y: e.clientY })}>
            <Icon name="more" size={18} />
          </button>
        )}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  );
}

function ChatInfo({ chat, me }: { chat: Chat; me: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const showToast = useApp((s) => s.showToast);
  const prefs = useApp((s) => s.prefs[chat.id]);
  const isAdmin = chat.admins.includes(me);
  const isOwner = chat.ownerId === me;
  const isMember = chat.members.includes(me);
  const isChannel = chat.type === 'channel';
  const max = isChannel ? CHANNEL_MAX_MEMBERS : GROUP_MAX_MEMBERS;
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const [share, setShare] = useState(false);
  const muted = isMuted(prefs?.mutedUntil);
  const fail = (e: unknown) => showToast(t(authErrorKey(e)));

  // Для канала участников видят только админы (как в Telegram).
  const showMembers = !isChannel || isAdmin;

  return (
    <div className="screen">
      <PageHeader
        title={isChannel ? t('groups.channel') : t('groups.group')}
        back={() => navigate(`/c/${chat.id}`)}
        actions={
          isAdmin ? (
            <button className="icon-btn" onClick={() => setEditing(true)} aria-label={t('groups.editInfo')}>
              <Icon name="edit" />
            </button>
          ) : undefined
        }
      />
      <div className="scroll">
        <div className="profile-hero">
          <Avatar name={chat.title ?? ''} seed={chat.id} src={chat.avatar} size={112} />
          <h2>{chat.title}</h2>
          <p className="muted">
            {isChannel
              ? t('chats.subscribers', { count: chat.members.length })
              : t('chats.members', { count: chat.members.length })}
          </p>
        </div>

        <div className="info-list">
          {chat.description && (
            <div className="info-item">
              <Icon name="edit" />
              <div>
                <div className="pre-wrap">{chat.description}</div>
                <div className="muted small">{t('groups.description')}</div>
              </div>
            </div>
          )}
          {isAdmin && (
            <div className="info-item">
              <Icon name="link" />
              <div className="min0 grow">
                {chat.inviteCode ? (
                  <button className="plain ellipsis block accent-text" onClick={() => setShare(true)}>
                    {inviteLink(chat.inviteCode)}
                  </button>
                ) : (
                  <div className="muted">{t('groups.inviteHint')}</div>
                )}
                <div className="muted small">{t('groups.inviteLink')}</div>
              </div>
              <button
                className="btn btn-text small"
                onClick={() => void resetInvite(chat).then(() => setShare(true)).catch(fail)}
              >
                {chat.inviteCode ? t('groups.revokeInvite') : t('groups.createInvite')}
              </button>
            </div>
          )}
          {isMember && (
            <div className="info-item">
              <Icon name="bell" />
              <div className="grow">{t('settings.notifications')}</div>
              <Switch checked={!muted} onChange={(on) => void setChatMuted(me, chat.id, on ? null : -1)} />
            </div>
          )}
        </div>

        {showMembers && (
          <div className="section">
            <h3 className="section-title">
              {isChannel ? t('groups.subscribers') : t('groups.members')} · {chat.members.length}
            </h3>
            {isAdmin && chat.members.length < max && (
              <button className="list-item accent-text" onClick={() => setAdding(true)}>
                <span className="icon-circle">
                  <Icon name="userPlus" />
                </span>
                <span>{t('groups.addMember')}</span>
              </button>
            )}
            {chat.members.map((uid) => (
              <MemberRow key={uid} chat={chat} uid={uid} me={me} canManage={isAdmin} />
            ))}
          </div>
        )}

        <div className="section">
          {isMember && !isOwner && (
            <button className="setting-row danger" onClick={() => setConfirm('leave')}>
              <Icon name="logout" />
              <span>{isChannel ? t('groups.leaveChannel') : t('groups.leaveGroup')}</span>
            </button>
          )}
          {(isOwner || useApp.getState().profile?.role === 'admin') && (
            <button className="setting-row danger" onClick={() => setConfirm('delete')}>
              <Icon name="trash" />
              <span>{isChannel ? t('groups.deleteChannel') : t('groups.deleteGroup')}</span>
            </button>
          )}
        </div>
      </div>

      {editing && <EditInfo chat={chat} me={me} onClose={() => setEditing(false)} />}
      {adding && (
        <Modal
          title={t('groups.addMembers')}
          onClose={() => setAdding(false)}
          footer={
            <button
              className="btn btn-primary"
              disabled={toAdd.length === 0}
              onClick={() => {
                void addMembers(chat, me, toAdd).catch(fail);
                setToAdd([]);
                setAdding(false);
              }}
            >
              {t('common.done')}
            </button>
          }
        >
          <PeoplePicker selected={toAdd} onChange={setToAdd} max={max - chat.members.length} exclude={chat.members} />
        </Modal>
      )}
      {confirm === 'leave' && (
        <Confirm
          text={t('groups.leaveConfirm', { title: chat.title })}
          confirmLabel={isChannel ? t('groups.leaveChannel') : t('groups.leaveGroup')}
          cancelLabel={t('common.cancel')}
          danger
          onConfirm={() => void leaveGroup(chat, me).then(() => navigate('/')).catch(fail)}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <Confirm
          text={t('groups.deleteConfirm', { title: chat.title })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onConfirm={() => void deleteGroup(chat).then(() => navigate('/')).catch(fail)}
          onClose={() => setConfirm(null)}
        />
      )}
      {share && chat.inviteCode && (
        <ShareLink link={inviteLink(chat.inviteCode)} title={t('groups.inviteLink')} onClose={() => setShare(false)} />
      )}
    </div>
  );
}

function EditInfo({ chat, me, onClose }: { chat: Chat; me: string; onClose: () => void }) {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  const [title, setTitle] = useState(chat.title ?? '');
  const [description, setDescription] = useState(chat.description);
  const [avatar, setAvatar] = useState(chat.avatar);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Modal
      title={t('groups.editInfo')}
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary"
          disabled={!title.trim()}
          onClick={() => {
            void updateGroupInfo(chat, me, { title, description, avatar }).catch((e) => showToast(t(authErrorKey(e))));
            onClose();
          }}
        >
          {t('common.save')}
        </button>
      }
    >
      <div className="stack">
        <div className="row gap center-v">
          <button className="avatar-edit plain" onClick={() => fileRef.current?.click()}>
            <Avatar name={title || '?'} seed={chat.id} src={avatar} size={72} />
          </button>
          {avatar && (
            <button className="btn btn-text danger" onClick={() => setAvatar(null)}>
              {t('profile.removeAvatar')}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) setAvatar(await makeAvatar(file).catch(() => avatar));
            }}
          />
        </div>
        <label className="field">
          <span className="field-label">{chat.type === 'group' ? t('groups.groupName') : t('groups.channelName')}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={64} />
        </label>
        <label className="field">
          <span className="field-label">{t('groups.description')}</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} rows={3} />
        </label>
      </div>
    </Modal>
  );
}
