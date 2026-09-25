import { accountEmail, supabase } from './client';
import type {
  CallRow,
  Chat,
  ForwardRef,
  LastMessage,
  MediaInfo,
  Member,
  Message,
  ReplyRef,
  UserProfile,
} from './types';
import { normalizeUsername } from '../lib/username';

type Row = Record<string, unknown>;

const ms = (v: unknown): number => (v ? Date.parse(String(v)) : 0);
const msOrNull = (v: unknown): number | null => (v ? Date.parse(String(v)) : null);

/** Ошибка Supabase/PostgREST → понятный код. */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function check<T>(res: { data: T; error: { code?: string; message: string } | null }): T {
  if (res.error) throw new ApiError(res.error.code ?? 'unknown', res.error.message);
  return res.data;
}

// ---------- преобразование строк ----------
export function toProfile(r: Row): UserProfile {
  return {
    uid: String(r.id),
    username: String(r.username ?? ''),
    displayName: String(r.display_name ?? ''),
    bio: String(r.bio ?? ''),
    avatar: (r.avatar as string | null) ?? null,
    role: r.role === 'admin' ? 'admin' : 'user',
    banned: r.banned === true,
    hideLastSeen: r.hide_last_seen === true,
    lastSeen: msOrNull(r.last_seen),
    createdAt: ms(r.created_at),
    verified: r.verified === true,
    scam: r.scam === true,
    premiumUntil: msOrNull(r.premium_until),
    nameColor: (r.name_color as string | null) ?? null,
    emojiStatus: (r.emoji_status as string | null) ?? null,
    profileBg: (r.profile_bg as string | null) ?? null,
    spamUntil: msOrNull(r.spam_until),
    profileLocked: r.profile_locked === true,
    isBot: r.is_bot === true,
    coOwner: r.co_owner === true,
    developer: r.developer === true,
    nftUsernames: ((r.nft_usernames as { username: string }[] | null) ?? []).map((n) => n.username).sort(),
  };
}

function toLast(v: unknown): LastMessage | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Row;
  return {
    id: String(r.id),
    text: String(r.text ?? ''),
    senderId: String(r.sender_id),
    createdAt: ms(r.created_at),
    deleted: r.deleted === true,
    system: (r.system as LastMessage['system']) ?? null,
    call: (r.call as LastMessage['call']) ?? null,
    media: (r.media as LastMessage['media']) ?? null,
  };
}

export function toChat(r: Row): Chat {
  return {
    id: String(r.id),
    type: r.type as Chat['type'],
    title: (r.title as string | null) ?? null,
    description: String(r.description ?? ''),
    avatar: (r.avatar as string | null) ?? null,
    ownerId: (r.owner_id as string | null) ?? null,
    inviteCode: (r.invite_code as string | null) ?? null,
    pinnedMessageIds: (r.pinned_message_ids as string[] | null) ?? [],
    lastMessage: toLast(r.last_message),
    createdAt: ms(r.created_at),
    updatedAt: ms(r.updated_at),
    myRole: (r.my_role as Chat['myRole']) ?? null,
    lastReadAt: ms(r.last_read_at),
    pinned: r.pinned === true,
    muted: r.muted === true,
    clearedAt: ms(r.cleared_at),
    unread: Number(r.unread ?? 0),
    memberCount: Number(r.member_count ?? 0),
    otherId: (r.other_id as string | null) ?? null,
    othersReadAt: ms(r.others_read_at),
    verified: r.verified === true,
    scam: r.scam === true,
  };
}

/**
 * Realtime не присылает большие неизменённые поля (TOAST в Postgres): например, после
 * смены last_seen в профиле нет аватарки, после реакции на длинное сообщение — текста.
 * Недостающие поля берём из прежней версии.
 */
export function keepUnchanged<T extends object>(
  fresh: T,
  old: T | undefined,
  row: Row,
  fields: [string, keyof T][],
): T {
  if (!old) return fresh;
  const out = { ...fresh };
  for (const [col, key] of fields) if (!(col in row)) out[key] = old[key];
  return out;
}

export const PROFILE_LARGE_FIELDS: [string, keyof UserProfile][] = [
  ['avatar', 'avatar'],
  ['bio', 'bio'],
  // Не колонка профиля: в realtime-событиях профиля её нет никогда.
  ['nft_usernames', 'nftUsernames'],
];
export const MESSAGE_LARGE_FIELDS: [string, keyof Message][] = [
  ['text', 'text'],
  ['reactions', 'reactions'],
  ['boost_reactions', 'boostReactions'],
  ['reply_to', 'replyTo'],
  ['forwarded_from', 'forwardedFrom'],
  ['media', 'media'],
];

export function toMessage(r: Row): Message {
  return {
    id: String(r.id),
    chatId: String(r.chat_id),
    senderId: String(r.sender_id),
    text: String(r.text ?? ''),
    createdAt: ms(r.created_at),
    editedAt: msOrNull(r.edited_at),
    deleted: r.deleted === true,
    deletedFor: (r.deleted_for as string[] | null) ?? [],
    replyTo: (r.reply_to as ReplyRef | null) ?? null,
    forwardedFrom: (r.forwarded_from as ForwardRef | null) ?? null,
    reactions: (r.reactions as Record<string, string[]> | null) ?? {},
    system: (r.system as Message['system']) ?? null,
    call: (r.call as Message['call']) ?? null,
    views: Number(r.views ?? 0),
    boostViews: Number(r.boost_views ?? 0),
    boostReactions: (r.boost_reactions as Record<string, number> | null) ?? {},
    media: (r.media as MediaInfo | null) ?? null,
    pending: false,
  };
}

export function toCall(r: Row): CallRow {
  return {
    id: String(r.id),
    callerId: String(r.caller_id),
    calleeId: String(r.callee_id),
    chatId: String(r.chat_id),
    video: r.video === true,
    status: r.status as CallRow['status'],
    offer: (r.offer as RTCSessionDescriptionInit | null) ?? null,
    answer: (r.answer as RTCSessionDescriptionInit | null) ?? null,
    createdAt: ms(r.created_at),
  };
}

// ---------- аккаунт ----------
export async function isUsernameFree(name: string): Promise<boolean> {
  return check(await supabase.rpc('username_available', { p_username: normalizeUsername(name) })) === true;
}

export async function register(username: string, displayName: string, password: string): Promise<void> {
  const name = normalizeUsername(username);
  const { error } = await supabase.auth.signUp({
    email: accountEmail(),
    password,
    options: { data: { username: name, display_name: displayName.trim() } },
  });
  if (error) {
    // Триггер не смог создать профиль — почти всегда это занятый юзернейм.
    if (/database error/i.test(error.message)) throw new ApiError('username_taken', error.message);
    throw new ApiError(error.code ?? 'auth', error.message);
  }
}

export async function login(username: string, password: string): Promise<void> {
  const email = check(await supabase.rpc('login_email', { p_username: normalizeUsername(username) })) as
    string | null;
  if (!email) throw new ApiError('invalid_credentials', 'no such user');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new ApiError(error.code ?? 'invalid_credentials', error.message);
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut();
}

export async function changePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new ApiError(error.code ?? 'auth', error.message);
}

/** Код ошибки → ключ перевода. */
export function errorKey(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const msg = (err as { message?: string })?.message ?? '';
  if (code === 'username_taken' || code === '23505') return 'auth.usernameTaken';
  if (code === 'invalid_credentials') return 'errors.wrongCredentials';
  if (code === 'weak_password') return 'errors.weakPassword';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit')
    return 'errors.tooManyRequests';
  if (msg.includes('protected user')) return 'errors.protectedUser';
  if (code === '42501') return /blocked/.test(msg) ? 'chat.blockedByThem' : 'errors.permission';
  if (msg.includes('spamblock')) return 'errors.spamblock';
  if (msg.includes('profile locked')) return 'errors.profileLocked';
  if (msg.includes('too many reports')) return 'report.tooMany';
  if (msg.includes('protected user')) return 'errors.protectedUser';
  if (msg.includes('too many members')) return 'errors.tooManyMembers';
  if (msg.includes('pin limit')) return 'errors.pinLimit';
  if (msg.includes('bio too long')) return 'errors.bioTooLong';
  if (msg.includes('invalid invite')) return 'groups.invalidInvite';
  if (err instanceof TypeError || /fetch|network/i.test(msg)) return 'errors.network';
  return 'errors.generic';
}

export async function updateProfile(
  uid: string,
  patch: Partial<{
    displayName: string;
    bio: string;
    avatar: string | null;
    hideLastSeen: boolean;
    username: string;
  }>,
): Promise<void> {
  const row: Row = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.bio !== undefined) row.bio = patch.bio;
  if (patch.avatar !== undefined) row.avatar = patch.avatar;
  if (patch.hideLastSeen !== undefined) row.hide_last_seen = patch.hideLastSeen;
  if (patch.username !== undefined) row.username = normalizeUsername(patch.username);
  check(await supabase.from('profiles').update(row).eq('id', uid));
}

export async function touchLastSeen(uid: string): Promise<void> {
  await supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', uid);
}

/** Профиль вместе с НФТ-юзернеймами. */
const PROFILE_SELECT = '*, nft_usernames(username)';

export async function fetchProfiles(ids: string[]): Promise<UserProfile[]> {
  return (check(await supabase.from('profiles').select(PROFILE_SELECT).in('id', ids)) as Row[]).map(
    toProfile,
  );
}

/** По основному или НФТ-юзернейму. */
export async function findUserByUsername(name: string): Promise<UserProfile | null> {
  const rows = check(
    await supabase.rpc('find_profile_by_username', { p_username: normalizeUsername(name) }),
  ) as Row[] | null;
  const id = rows?.[0]?.id as string | undefined;
  if (!id) return null;
  return (await fetchProfiles([id]))[0] ?? null;
}

export async function searchUsers(prefix: string): Promise<UserProfile[]> {
  const p = normalizeUsername(prefix).replace(/[%_\\]/g, '\\$&');
  if (!p) return [];
  const [byName, byNft] = await Promise.all([
    supabase.from('profiles').select(PROFILE_SELECT).ilike('username', `${p}%`).limit(20),
    supabase.from('nft_usernames').select('owner_id').ilike('username', `${p}%`).limit(20),
  ]);
  const found = (check(byName) as Row[]).map(toProfile);
  const have = new Set(found.map((u) => u.uid));
  const extra = [...new Set((check(byNft) as Row[]).map((r) => String(r.owner_id)))].filter(
    (id) => !have.has(id),
  );
  return extra.length ? [...found, ...(await fetchProfiles(extra))] : found;
}

export async function listUsers(): Promise<UserProfile[]> {
  const rows = check(
    await supabase.from('profiles').select(PROFILE_SELECT).order('created_at').limit(500),
  ) as Row[];
  return rows.map(toProfile);
}

// ---------- чёрный список ----------
export async function fetchBlocked(): Promise<string[]> {
  return (check(await supabase.from('blocks').select('blocked_id')) as Row[]).map((r) =>
    String(r.blocked_id),
  );
}

export async function setBlocked(other: string, blocked: boolean): Promise<void> {
  if (blocked) check(await supabase.from('blocks').upsert({ blocked_id: other }, { ignoreDuplicates: true }));
  else check(await supabase.from('blocks').delete().eq('blocked_id', other));
}

// ---------- чаты ----------
export async function fetchChats(chatId?: string): Promise<Chat[]> {
  const rows = check(await supabase.rpc('get_chats', chatId ? { p_chat: chatId } : {})) as Row[];
  return rows.map(toChat);
}

export async function openPrivateChat(other: string): Promise<string> {
  return check(await supabase.rpc('get_or_create_private_chat', { p_other: other })) as string;
}

export async function openSavedChat(): Promise<string> {
  return check(await supabase.rpc('get_saved_chat')) as string;
}

export async function fetchMembers(chatId: string): Promise<Member[]> {
  const rows = check(
    await supabase
      .from('chat_members')
      .select('user_id, role, last_read_at')
      .eq('chat_id', chatId)
      .order('joined_at'),
  ) as Row[];
  return rows.map((r) => ({
    userId: String(r.user_id),
    role: r.role as Member['role'],
    lastReadAt: ms(r.last_read_at),
  }));
}

export async function markRead(chatId: string): Promise<void> {
  check(await supabase.rpc('mark_read', { p_chat: chatId }));
}

export async function setChatPrefs(
  chatId: string,
  prefs: { pinned?: boolean; muted?: boolean },
): Promise<void> {
  check(
    await supabase.rpc('set_chat_prefs', {
      p_chat: chatId,
      p_pinned: prefs.pinned ?? null,
      p_muted: prefs.muted ?? null,
    }),
  );
}

export async function setPinnedMessages(chatId: string, ids: string[]): Promise<void> {
  check(await supabase.rpc('set_pinned_messages', { p_chat: chatId, p_ids: ids }));
}

export async function clearChatForMe(chatId: string): Promise<void> {
  check(await supabase.rpc('clear_chat_for_me', { p_chat: chatId }));
}

// ---------- сообщения ----------
export const PAGE_SIZE = 50;

export async function fetchMessages(chatId: string, before?: number, count = PAGE_SIZE): Promise<Message[]> {
  const rows = check(
    await supabase.rpc('get_messages', {
      p_chat: chatId,
      p_before: before ? new Date(before).toISOString() : null,
      p_count: count,
    }),
  ) as Row[];
  return rows.map(toMessage).reverse();
}

export async function fetchMessage(id: string): Promise<Message | null> {
  const rows = check(await supabase.from('messages').select('*').eq('id', id)) as Row[];
  return rows[0] ? toMessage(rows[0]) : null;
}

export interface OutgoingMessage {
  id: string;
  chatId: string;
  text: string;
  replyTo?: ReplyRef | null;
  forwardedFrom?: ForwardRef | null;
  call?: Message['call'];
  media?: MediaInfo | null;
}

export async function sendMessageNow(m: OutgoingMessage): Promise<void> {
  check(
    await supabase.rpc('send_message', {
      p_id: m.id,
      p_chat: m.chatId,
      p_text: m.text,
      p_reply_to: m.replyTo ?? null,
      p_forwarded_from: m.forwardedFrom ?? null,
      p_call: m.call ?? null,
      p_media: m.media ?? null,
    }),
  );
}

export async function editMessage(id: string, text: string): Promise<void> {
  check(await supabase.rpc('edit_message', { p_id: id, p_text: text }));
}

export async function deleteMessage(id: string, forAll: boolean): Promise<void> {
  check(await supabase.rpc('delete_message', { p_id: id, p_for_all: forAll }));
}

export async function toggleReaction(id: string, emoji: string): Promise<void> {
  check(await supabase.rpc('toggle_reaction', { p_id: id, p_emoji: emoji }));
}

export function snippetOf(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

// ---------- группы и каналы ----------
export async function createChat(input: {
  kind: 'group' | 'channel';
  title: string;
  description: string;
  avatar: string | null;
  members: string[];
}): Promise<string> {
  return check(
    await supabase.rpc('create_chat', {
      p_type: input.kind,
      p_title: input.title.trim(),
      p_description: input.description.trim(),
      p_avatar: input.avatar,
      p_members: input.members,
    }),
  ) as string;
}

export async function updateChatInfo(
  chatId: string,
  info: { title: string; description: string; avatar: string | null },
) {
  check(
    await supabase.rpc('update_chat_info', {
      p_chat: chatId,
      p_title: info.title.trim(),
      p_description: info.description.trim(),
      p_avatar: info.avatar,
    }),
  );
}

export async function addMembers(chatId: string, users: string[]) {
  check(await supabase.rpc('add_members', { p_chat: chatId, p_users: users }));
}

export async function removeMember(chatId: string, user: string) {
  check(await supabase.rpc('remove_member', { p_chat: chatId, p_user: user }));
}

export async function setAdmin(chatId: string, user: string, admin: boolean) {
  check(await supabase.rpc('set_admin', { p_chat: chatId, p_user: user, p_admin: admin }));
}

export async function leaveChat(chatId: string) {
  check(await supabase.rpc('leave_chat', { p_chat: chatId }));
}

export async function deleteChat(chatId: string) {
  check(await supabase.rpc('delete_chat', { p_chat: chatId }));
}

export async function resetInvite(chatId: string): Promise<string> {
  return check(await supabase.rpc('reset_invite', { p_chat: chatId })) as string;
}

export interface InvitePreview {
  chatId: string;
  type: 'group' | 'channel';
  title: string;
  avatar: string | null;
  memberCount: number;
  isMember: boolean;
}

export async function getInvite(code: string): Promise<InvitePreview | null> {
  const rows = check(await supabase.rpc('invite_preview', { p_code: code })) as Row[];
  const r = rows[0];
  if (!r) return null;
  return {
    chatId: String(r.id),
    type: r.type as InvitePreview['type'],
    title: String(r.title ?? ''),
    avatar: (r.avatar as string | null) ?? null,
    memberCount: Number(r.member_count ?? 0),
    isMember: r.is_member === true,
  };
}

export async function joinByInvite(code: string): Promise<string> {
  return check(await supabase.rpc('join_by_invite', { p_code: code })) as string;
}

export function inviteLink(code: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}#/join/${code}`;
}

export function profileLink(username: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}#/u/${username}`;
}

// ---------- админ сервиса ----------
export async function setBanned(uid: string, banned: boolean) {
  check(await supabase.rpc('set_banned', { p_user: uid, p_banned: banned }));
}

export async function adminListChats() {
  const rows = check(await supabase.rpc('admin_list_chats')) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    type: r.type as 'group' | 'channel',
    title: String(r.title ?? ''),
    avatar: (r.avatar as string | null) ?? null,
    memberCount: Number(r.member_count ?? 0),
    boostMembers: Number(r.boost_members ?? 0),
    verified: r.verified === true,
    scam: r.scam === true,
  }));
}

export async function adminSetUserBadges(uid: string, badges: { verified?: boolean; scam?: boolean }) {
  check(
    await supabase.rpc('admin_set_user_badges', {
      p_user: uid,
      p_verified: badges.verified ?? null,
      p_scam: badges.scam ?? null,
    }),
  );
}

export async function adminSetChatBadges(chatId: string, badges: { verified?: boolean; scam?: boolean }) {
  check(
    await supabase.rpc('admin_set_chat_badges', {
      p_chat: chatId,
      p_verified: badges.verified ?? null,
      p_scam: badges.scam ?? null,
    }),
  );
}

export async function adminBoostMembers(chatId: string, boost: number) {
  check(
    await supabase.rpc('admin_boost_members', { p_chat: chatId, p_boost: Math.max(0, Math.round(boost)) }),
  );
}

export async function adminBoostMessage(msgId: string, views: number, reactions: Record<string, number>) {
  check(
    await supabase.rpc('admin_boost_message', {
      p_msg: msgId,
      p_views: Math.max(0, Math.round(views)),
      p_reactions: reactions,
    }),
  );
}

/** Премиум «навсегда» — дата в далёком будущем. */
export const PREMIUM_FOREVER = '9999-12-31T00:00:00Z';

export async function adminUpdateProfile(
  uid: string,
  patch: { displayName?: string; username?: string; bio?: string; avatar?: string | null },
): Promise<void> {
  check(
    await supabase.rpc('admin_update_profile', {
      p_user: uid,
      p_display_name: patch.displayName ?? null,
      p_username: patch.username !== undefined ? normalizeUsername(patch.username) : null,
      p_bio: patch.bio ?? null,
      p_avatar: patch.avatar ?? null,
      p_clear_avatar: patch.avatar === null,
    }),
  );
}

export async function adminSetRole(uid: string, admin: boolean): Promise<void> {
  check(await supabase.rpc('admin_set_role', { p_user: uid, p_admin: admin }));
}

export async function adminSetSpamblock(uid: string, until: string | null): Promise<void> {
  check(await supabase.rpc('admin_set_spamblock', { p_user: uid, p_until: until }));
}

export async function adminSetProfileLock(uid: string, locked: boolean): Promise<void> {
  check(await supabase.rpc('admin_set_profile_lock', { p_user: uid, p_locked: locked }));
}

export type ReportReason = 'spam' | 'abuse' | 'scam' | 'other';

/** Жалоба на сообщение (автор берётся из него) или на пользователя. */
export async function reportAbuse(p: {
  userId?: string;
  messageId?: string;
  reason: ReportReason;
  comment: string;
}): Promise<void> {
  check(
    await supabase.rpc('report', {
      p_user: p.userId ?? null,
      p_message: p.messageId ?? null,
      p_reason: p.reason,
      p_comment: p.comment,
    }),
  );
}

export interface ReportRow {
  id: number;
  reporterId: string;
  targetUser: string | null;
  chatId: string | null;
  reason: ReportReason;
  comment: string;
  snippet: string | null;
  createdAt: number;
  resolved: boolean;
}

export async function adminListReports(): Promise<ReportRow[]> {
  const rows = check(
    await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(200),
  ) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    reporterId: String(r.reporter_id),
    targetUser: (r.target_user as string | null) ?? null,
    chatId: (r.chat_id as string | null) ?? null,
    reason: r.reason as ReportReason,
    comment: String(r.comment ?? ''),
    snippet: (r.snippet as string | null) ?? null,
    createdAt: ms(r.created_at),
    resolved: r.resolved_at != null,
  }));
}

export async function adminResolveReport(id: number): Promise<void> {
  check(await supabase.rpc('admin_resolve_report', { p_id: id }));
}

export async function adminStats(): Promise<Record<string, number>> {
  return check(await supabase.rpc('admin_stats')) as Record<string, number>;
}

export async function ownerSetCoOwner(uid: string, on: boolean): Promise<void> {
  check(await supabase.rpc('owner_set_co_owner', { p_user: uid, p_on: on }));
}

export async function ownerSetDeveloper(uid: string, on: boolean): Promise<void> {
  check(await supabase.rpc('owner_set_developer', { p_user: uid, p_on: on }));
}

export async function adminBoostChannelViews(chatId: string, views: number): Promise<number> {
  return check(await supabase.rpc('admin_boost_channel_views', { p_chat: chatId, p_views: views })) as number;
}

export interface AutoBoost {
  views: number;
  reactions: Record<string, number>;
  boostMembers: number;
}

export async function fetchChannelBoost(chatId: string): Promise<AutoBoost> {
  const r = check(
    await supabase
      .from('chats')
      .select('auto_boost_views, auto_boost_reactions, boost_members')
      .eq('id', chatId)
      .single(),
  ) as Row;
  return {
    views: Number(r.auto_boost_views ?? 0),
    reactions: (r.auto_boost_reactions as Record<string, number> | null) ?? {},
    boostMembers: Number(r.boost_members ?? 0),
  };
}

export async function adminSetAutoBoost(
  chatId: string,
  views: number,
  reactions: Record<string, number>,
): Promise<void> {
  check(
    await supabase.rpc('admin_set_auto_boost', { p_chat: chatId, p_views: views, p_reactions: reactions }),
  );
}

export async function getOwnerId(): Promise<string | null> {
  return (check(await supabase.rpc('get_owner_id')) as string | null) ?? null;
}

export interface ProfileStyle {
  nameColor: string | null;
  emojiStatus: string | null;
  profileBg: string | null;
}

/** Админ — любому, премиум-пользователь — себе. */
export async function setProfileStyle(uid: string, style: ProfileStyle): Promise<void> {
  check(
    await supabase.rpc('set_profile_style', {
      p_user: uid,
      p_color: style.nameColor,
      p_emoji: style.emojiStatus,
      p_bg: style.profileBg,
    }),
  );
}

export async function adminGrantNft(uid: string, username: string): Promise<void> {
  check(
    await supabase.rpc('admin_grant_nft_username', { p_user: uid, p_username: normalizeUsername(username) }),
  );
}

export async function adminRevokeNft(username: string): Promise<void> {
  check(await supabase.rpc('admin_revoke_nft_username', { p_username: username }));
}

export async function adminSetPremium(uid: string, until: string | null) {
  check(await supabase.rpc('admin_set_premium', { p_user: uid, p_until: until }));
}

export interface PremiumRequest {
  id: number;
  userId: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

function toRequest(r: Row): PremiumRequest {
  return {
    id: Number(r.id),
    userId: String(r.user_id),
    note: String(r.note ?? ''),
    status: r.status as PremiumRequest['status'],
    createdAt: ms(r.created_at),
  };
}

export async function requestPremium(note: string) {
  check(await supabase.rpc('request_premium', { p_note: note }));
}

export async function myPremiumRequest(uid: string): Promise<PremiumRequest | null> {
  const rows = check(
    await supabase
      .from('premium_requests')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(1),
  ) as Row[];
  return rows[0] ? toRequest(rows[0]) : null;
}

export async function adminListPremiumRequests(): Promise<PremiumRequest[]> {
  const rows = check(
    await supabase
      .from('premium_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at')
      .limit(200),
  ) as Row[];
  return rows.map(toRequest);
}

export async function adminResolvePremiumRequest(id: number, approve: boolean, until: string | null) {
  check(
    await supabase.rpc('admin_resolve_premium_request', { p_id: id, p_approve: approve, p_until: until }),
  );
}

/** Адреса STUN/TURN для звонков: временные логины к своему TURN-серверу выдаёт серверная функция. */
export async function fetchIceServers(): Promise<RTCIceServer[]> {
  const fallback: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  ];
  try {
    const { data, error } = await supabase.functions.invoke('bobogram', { body: { action: 'turn' } });
    const servers = (data as { iceServers?: RTCIceServer[] } | null)?.iceServers;
    return !error && servers?.length ? servers : fallback;
  } catch {
    return fallback;
  }
}

export async function adminResetPassword(userId: string, password: string) {
  const { data, error } = await supabase.functions.invoke('bobogram', {
    body: { action: 'reset_password', userId, password },
  });
  if (error || (data as { error?: string })?.error) throw new ApiError('generic', error?.message ?? 'failed');
}

// ---------- звонки ----------
export async function createCall(call: {
  chatId: string;
  calleeId: string;
  video: boolean;
  offer: RTCSessionDescriptionInit;
}) {
  const rows = check(
    await supabase
      .from('calls')
      .insert({ chat_id: call.chatId, callee_id: call.calleeId, video: call.video, offer: call.offer })
      .select('id'),
  ) as Row[];
  return String(rows[0].id);
}

export async function fetchCall(id: string): Promise<CallRow | null> {
  const rows = check(await supabase.from('calls').select('*').eq('id', id)) as Row[];
  return rows[0] ? toCall(rows[0]) : null;
}

export async function updateCall(id: string, patch: Row) {
  check(await supabase.from('calls').update(patch).eq('id', id));
}

export async function addCandidate(callId: string, fromCaller: boolean, candidate: RTCIceCandidateInit) {
  await supabase.from('call_candidates').insert({ call_id: callId, from_caller: fromCaller, candidate });
}

export async function fetchCandidates(callId: string, fromCaller: boolean): Promise<RTCIceCandidateInit[]> {
  const rows = check(
    await supabase
      .from('call_candidates')
      .select('candidate')
      .eq('call_id', callId)
      .eq('from_caller', fromCaller)
      .order('id'),
  ) as Row[];
  return rows.map((r) => r.candidate as RTCIceCandidateInit);
}

export async function fetchRingingCalls(me: string): Promise<CallRow[]> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const rows = check(
    await supabase
      .from('calls')
      .select('*')
      .eq('callee_id', me)
      .eq('status', 'ringing')
      .gt('created_at', since),
  ) as Row[];
  return rows.map(toCall);
}
