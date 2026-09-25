import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  adminBoostMembers,
  adminListChats,
  adminListPremiumRequests,
  adminResetPassword,
  adminResolvePremiumRequest,
  adminSetChatBadges,
  adminSetPremium,
  adminSetUserBadges,
  adminSetRole,
  adminSetSpamblock,
  adminSetProfileLock,
  getOwnerId,
  deleteChat,
  errorKey,
  listUsers,
  PREMIUM_FOREVER,
  setBanned,
  type PremiumRequest,
} from '../../supabase/api';
import { isPremium, isSpamblocked, type UserProfile } from '../../supabase/types';
import { useApp, useMe } from '../../app/store';
import { displayNameOf, useProfile } from '../../app/profiles';
import { Avatar } from '../../ui/Avatar';
import { Badges } from '../../ui/Badges';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Confirm, Modal } from '../../ui/Modal';
import { PageHeader, Spinner } from '../../ui/misc';
import { NftDialog } from './NftDialog';
import { nameColorStyle } from '../../app/themes';
import { AdminEditProfileDialog } from './AdminEditProfileDialog';

type AdminChat = Awaited<ReturnType<typeof adminListChats>>[number];
type Tab = 'users' | 'chats' | 'requests';

const DAY = 86_400_000;
const untilIso = (days: number | null) =>
  days === null ? PREMIUM_FOREVER : new Date(Date.now() + days * DAY).toISOString();

/** Админ-панель: пользователи (бан, пароль, галочка, SCAM, премиум), каналы (галочка, SCAM, накрутка), заявки. */
export default function AdminPanel() {
  const { t } = useTranslation();
  const role = useApp((s) => s.profile?.role);
  const [tab, setTab] = useState<Tab>('users');
  const [q, setQ] = useState('');

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

  return (
    <div className="screen">
      <PageHeader title={t('admin.title')} back="/" />
      <div className="tabs">
        {(['users', 'chats', 'requests'] as Tab[]).map((x) => (
          <button key={x} className={tab === x ? 'active' : ''} onClick={() => setTab(x)}>
            {t(`admin.tab_${x}`)}
          </button>
        ))}
      </div>
      <div className="scroll">
        {tab !== 'requests' && (
          <div className="pad-x">
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('common.search')}
            />
          </div>
        )}
        {tab === 'users' && <UsersTab q={q} />}
        {tab === 'chats' && <ChatsTab q={q} />}
        {tab === 'requests' && <RequestsTab />}
      </div>
    </div>
  );
}

function useFail() {
  const { t } = useTranslation();
  const showToast = useApp((s) => s.showToast);
  return (e: unknown) => showToast(t(errorKey(e)));
}

function UsersTab({ q }: { q: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const showToast = useApp((s) => s.showToast);
  const fail = useFail();
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [menu, setMenu] = useState<{ user: UserProfile; x: number; y: number } | null>(null);
  const [resetFor, setResetFor] = useState<UserProfile | null>(null);
  const [nftFor, setNftFor] = useState<UserProfile | null>(null);
  const [editFor, setEditFor] = useState<UserProfile | null>(null);
  const [subMenu, setSubMenu] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null);
  const lastMenuPos = useRef<{ x: number; y: number } | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  const load = () => void listUsers().then(setUsers).catch(fail);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);
  useEffect(
    () =>
      void getOwnerId()
        .then(setOwnerId)
        .catch(() => undefined),
    [],
  );

  const patch = (uid: string, p: Partial<UserProfile>) =>
    setUsers((list) => list?.map((u) => (u.uid === uid ? { ...u, ...p } : u)) ?? null);

  const act = (p: Promise<unknown>, uid: string, change: Partial<UserProfile>) =>
    void p.then(() => patch(uid, change)).catch(fail);

  const ql = q.trim().toLowerCase().replace(/^@/, '');
  if (!users) {
    return (
      <div className="center-pad">
        <Spinner />
      </div>
    );
  }

  // Второе меню открывается на месте первого.
  const openSub = (subItems: MenuItem[]) => {
    const at = menu ?? lastMenuPos.current;
    if (at) setSubMenu({ items: subItems, x: at.x, y: at.y });
  };

  const items = (u: UserProfile): MenuItem[] => {
    const isOwner = u.uid === ownerId;
    const list: MenuItem[] = [
      { icon: 'edit', label: t('admin.editProfile'), onClick: () => setEditFor(u) },
      {
        icon: 'check',
        label: u.verified ? t('admin.unverify') : t('admin.verify'),
        onClick: () =>
          act(adminSetUserBadges(u.uid, { verified: !u.verified }), u.uid, { verified: !u.verified }),
      },
      {
        icon: 'ban',
        label: u.scam ? t('admin.unscam') : t('admin.scam'),
        danger: !u.scam,
        onClick: () => act(adminSetUserBadges(u.uid, { scam: !u.scam }), u.uid, { scam: !u.scam }),
      },
    ];
    // Премиум — во втором меню, чтобы основное было короче.
    const premiumItems: MenuItem[] = (
      [
        [t('admin.premium7'), 7],
        [t('admin.premium30'), 30],
        [t('admin.premium365'), 365],
        [t('admin.premiumForever'), null],
      ] as const
    ).map(([label, days]) => ({
      icon: 'star',
      label,
      onClick: () => {
        const until = untilIso(days);
        act(adminSetPremium(u.uid, until), u.uid, { premiumUntil: Date.parse(until) });
      },
    }));
    if (isPremium(u)) {
      premiumItems.push({
        icon: 'close',
        label: t('admin.premiumRemove'),
        onClick: () => act(adminSetPremium(u.uid, null), u.uid, { premiumUntil: null }),
      });
    }
    list.push({ icon: 'star', label: t('admin.premiumMenu'), onClick: () => openSub(premiumItems) });
    if (u.uid !== me && !isOwner) {
      list.push({
        icon: 'lock',
        label: u.profileLocked ? t('admin.unlockProfile') : t('admin.lockProfile'),
        onClick: () =>
          act(adminSetProfileLock(u.uid, !u.profileLocked), u.uid, { profileLocked: !u.profileLocked }),
      });
    }
    list.push({ icon: 'gem', label: t('nft.menu'), onClick: () => setNftFor(u) });
    if (u.uid !== me && !isOwner) {
      list.push({
        icon: 'shield',
        label: u.role === 'admin' ? t('admin.removeAdmin') : t('admin.makeAdmin'),
        onClick: () => {
          const role = u.role === 'admin' ? 'user' : 'admin';
          act(adminSetRole(u.uid, role === 'admin'), u.uid, { role });
        },
      });
      if (isSpamblocked(u)) {
        list.push({
          icon: 'close',
          label: t('admin.spamblockRemove'),
          onClick: () => act(adminSetSpamblock(u.uid, null), u.uid, { spamUntil: null }),
        });
      } else {
        const spamItems: MenuItem[] = (
          [
            [t('admin.spamblock1'), 1],
            [t('admin.spamblock7'), 7],
            [t('admin.spamblockForever'), null],
          ] as const
        ).map(([label, days]) => ({
          icon: 'ban',
          label,
          danger: true,
          onClick: () => {
            const until = untilIso(days);
            act(adminSetSpamblock(u.uid, until), u.uid, { spamUntil: Date.parse(until) });
          },
        }));
        list.push({
          icon: 'ban',
          label: t('admin.spamblockMenu'),
          danger: true,
          onClick: () => openSub(spamItems),
        });
      }
    }
    if (u.uid !== me && !isOwner) {
      list.push({
        icon: 'lock',
        label: t('admin.resetPassword'),
        onClick: () => {
          setPassword('');
          setResetFor(u);
        },
      });
      list.push({
        icon: 'ban',
        label: u.banned ? t('admin.unban') : t('admin.ban'),
        danger: !u.banned,
        onClick: () => act(setBanned(u.uid, !u.banned), u.uid, { banned: !u.banned }),
      });
    }
    return list;
  };

  return (
    <>
      {users
        .filter(
          (u) =>
            !ql ||
            u.username.toLowerCase().includes(ql) ||
            u.displayName.toLowerCase().includes(ql) ||
            u.nftUsernames.some((n) => n.toLowerCase().includes(ql)),
        )
        .map((u) => (
          <div key={u.uid} className="list-item">
            <button className="plain row gap grow min0" onClick={() => navigate(`/profile/${u.uid}`)}>
              <Avatar name={u.displayName} seed={u.uid} src={u.avatar} size={40} />
              <div className="list-item-body">
                <div className="list-item-title">
                  <span className="ellipsis" style={nameColorStyle(u.nameColor)}>
                    {u.displayName}
                  </span>
                  <Badges
                    verified={u.verified}
                    scam={u.scam}
                    premium={isPremium(u)}
                    emoji={u.emojiStatus}
                    size={15}
                  />
                  {u.role === 'admin' && '🛡️'}
                </div>
                <div className={u.banned ? 'list-item-sub danger' : 'list-item-sub'}>
                  @{u.username}
                  {u.nftUsernames.length > 0 && ` · 💎 ${u.nftUsernames.length}`}
                  {isSpamblocked(u) && ` · 🚫 ${t('admin.spamblocked')}`}
                  {u.profileLocked && ` · 🔒`}
                  {u.uid === ownerId && ` · 👑 ${t('admin.owner')}`}
                  {u.banned && ` · ${t('admin.banned')}`}
                  {isPremium(u) &&
                    ` · ⭐ ${
                      new Date(u.premiumUntil!).getFullYear() >= 9999
                        ? t('admin.forever')
                        : new Date(u.premiumUntil!).toLocaleDateString(i18n.language)
                    }`}
                </div>
              </div>
            </button>
            <button
              className="icon-btn"
              aria-label={t('nft.menu')}
              title={t('nft.menu')}
              onClick={() => setNftFor(u)}
            >
              <Icon name="gem" />
            </button>
            <button
              className="icon-btn"
              aria-label="more"
              onClick={(e) => {
                const pos = { x: e.clientX - 200, y: e.clientY };
                lastMenuPos.current = pos;
                setMenu({ user: u, ...pos });
              }}
            >
              <Icon name="more" />
            </button>
          </div>
        ))}
      {menu && <Menu x={menu.x} y={menu.y} items={items(menu.user)} onClose={() => setMenu(null)} />}
      {subMenu && <Menu x={subMenu.x} y={subMenu.y} items={subMenu.items} onClose={() => setSubMenu(null)} />}
      {editFor && (
        <AdminEditProfileDialog
          user={editFor}
          onSaved={(p) => patch(editFor.uid, p)}
          onClose={() => setEditFor(null)}
        />
      )}
      {nftFor && (
        <NftDialog
          user={nftFor}
          onChange={(names) => patch(nftFor.uid, { nftUsernames: names })}
          onClose={() => setNftFor(null)}
        />
      )}
      {resetFor && (
        <Modal
          title={t('admin.resetPasswordFor', { username: resetFor.username })}
          onClose={() => setResetFor(null)}
          footer={
            <button
              className="btn btn-primary"
              disabled={password.length < 6}
              onClick={() => {
                void adminResetPassword(resetFor.uid, password)
                  .then(() => showToast(t('admin.passwordReset')))
                  .catch(fail);
                setResetFor(null);
              }}
            >
              {t('common.save')}
            </button>
          }
        >
          <label className="field">
            <span className="field-label">{t('settings.newPassword')}</span>
            <input value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
            <span className="field-hint">{t('auth.passwordHint')}</span>
          </label>
        </Modal>
      )}
    </>
  );
}

function ChatsTab({ q }: { q: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const showToast = useApp((s) => s.showToast);
  const fail = useFail();
  const [chats, setChats] = useState<AdminChat[] | null>(null);
  const [menu, setMenu] = useState<{ chat: AdminChat; x: number; y: number } | null>(null);
  const [boostFor, setBoostFor] = useState<AdminChat | null>(null);
  const [boost, setBoost] = useState('');
  const [deleting, setDeleting] = useState<AdminChat | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void adminListChats().then(setChats).catch(fail), []);

  const patch = (id: string, p: Partial<AdminChat>) =>
    setChats((list) => list?.map((c) => (c.id === id ? { ...c, ...p } : c)) ?? null);

  if (!chats) {
    return (
      <div className="center-pad">
        <Spinner />
      </div>
    );
  }
  const ql = q.trim().toLowerCase();

  const items = (c: AdminChat): MenuItem[] => [
    { icon: 'forward', label: t('admin.open'), onClick: () => navigate(`/c/${c.id}`) },
    {
      icon: 'check',
      label: c.verified ? t('admin.unverify') : t('admin.verify'),
      onClick: () =>
        void adminSetChatBadges(c.id, { verified: !c.verified })
          .then(() => patch(c.id, { verified: !c.verified }))
          .catch(fail),
    },
    {
      icon: 'ban',
      label: c.scam ? t('admin.unscam') : t('admin.scam'),
      danger: !c.scam,
      onClick: () =>
        void adminSetChatBadges(c.id, { scam: !c.scam })
          .then(() => patch(c.id, { scam: !c.scam }))
          .catch(fail),
    },
    {
      icon: 'userPlus',
      label: t('admin.boostMembers'),
      onClick: () => {
        setBoost(String(c.boostMembers || ''));
        setBoostFor(c);
      },
    },
    { icon: 'trash', label: t('admin.deleteChat'), danger: true, onClick: () => setDeleting(c) },
  ];

  return (
    <>
      {chats
        .filter((c) => !ql || c.title.toLowerCase().includes(ql))
        .map((c) => (
          <div key={c.id} className="list-item">
            <button className="plain row gap grow min0" onClick={() => navigate(`/c/${c.id}`)}>
              <Avatar
                name={c.title}
                seed={c.id}
                src={c.avatar}
                size={40}
                icon={c.type === 'channel' ? 'megaphone' : undefined}
              />
              <div className="list-item-body">
                <div className="list-item-title">
                  <span className="ellipsis">{c.title}</span>
                  <Badges verified={c.verified} scam={c.scam} size={15} />
                </div>
                <div className="list-item-sub">
                  {c.type === 'channel'
                    ? t('chats.subscribers', { count: c.memberCount + c.boostMembers })
                    : t('chats.members', { count: c.memberCount + c.boostMembers })}
                  {c.boostMembers > 0 && ` (${t('admin.real', { count: c.memberCount })})`}
                </div>
              </div>
            </button>
            <button
              className="icon-btn"
              aria-label="more"
              onClick={(e) => setMenu({ chat: c, x: e.clientX - 220, y: e.clientY })}
            >
              <Icon name="more" />
            </button>
          </div>
        ))}
      {menu && <Menu x={menu.x} y={menu.y} items={items(menu.chat)} onClose={() => setMenu(null)} />}
      {boostFor && (
        <Modal
          title={t('admin.boostMembers')}
          onClose={() => setBoostFor(null)}
          footer={
            <button
              className="btn btn-primary"
              onClick={() => {
                const n = Math.max(0, Math.round(Number(boost) || 0));
                void adminBoostMembers(boostFor.id, n)
                  .then(() => {
                    patch(boostFor.id, { boostMembers: n });
                    showToast(t('admin.boostSaved'));
                  })
                  .catch(fail);
                setBoostFor(null);
              }}
            >
              {t('common.save')}
            </button>
          }
        >
          <p className="muted small">{t('admin.boostMembersHint', { count: boostFor.memberCount })}</p>
          <label className="field">
            <span className="field-label">{t('admin.extraMembers')}</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={boost}
              onChange={(e) => setBoost(e.target.value)}
            />
          </label>
        </Modal>
      )}
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
    </>
  );
}

function RequestRow({ req, onDone }: { req: PremiumRequest; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const fail = useFail();
  const p = useProfile(req.userId);
  const [days, setDays] = useState<string>('30');

  const resolve = (approve: boolean) =>
    void adminResolvePremiumRequest(
      req.id,
      approve,
      approve ? untilIso(days === 'forever' ? null : Number(days)) : null,
    )
      .then(onDone)
      .catch(fail);

  return (
    <div className="request-card">
      <button className="plain row gap" onClick={() => navigate(`/profile/${req.userId}`)}>
        <Avatar name={displayNameOf(p, '?')} seed={req.userId} src={p?.avatar} size={40} />
        <div className="list-item-body">
          <div className="list-item-title">{displayNameOf(p, '…')}</div>
          <div className="list-item-sub">
            @{p?.username} · {new Date(req.createdAt).toLocaleDateString(i18n.language)}
          </div>
        </div>
      </button>
      {req.note && <p className="pre-wrap request-note">{req.note}</p>}
      <div className="row gap wrap">
        <select value={days} onChange={(e) => setDays(e.target.value)} aria-label={t('admin.duration')}>
          <option value="7">{t('admin.premium7')}</option>
          <option value="30">{t('admin.premium30')}</option>
          <option value="365">{t('admin.premium365')}</option>
          <option value="forever">{t('admin.premiumForever')}</option>
        </select>
        <button className="btn btn-primary small" onClick={() => resolve(true)}>
          {t('admin.approve')}
        </button>
        <button className="btn btn-text small danger" onClick={() => resolve(false)}>
          {t('admin.reject')}
        </button>
      </div>
    </div>
  );
}

function RequestsTab() {
  const { t } = useTranslation();
  const fail = useFail();
  const [list, setList] = useState<PremiumRequest[] | null>(null);
  const load = () => void adminListPremiumRequests().then(setList).catch(fail);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  if (!list) {
    return (
      <div className="center-pad">
        <Spinner />
      </div>
    );
  }
  if (list.length === 0) return <div className="list-empty">{t('admin.noRequests')}</div>;
  return (
    <div className="pad-x">
      {list.map((r) => (
        <RequestRow key={r.id} req={r} onDone={load} />
      ))}
    </div>
  );
}
