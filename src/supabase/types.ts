export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  bio: string;
  avatar: string | null;
  role: 'user' | 'admin';
  banned: boolean;
  hideLastSeen: boolean;
  lastSeen: number | null;
  createdAt: number;
  verified: boolean;
  scam: boolean;
  /** До какого момента действует премиум (мс), null — нет премиума. */
  premiumUntil: number | null;
  /** Коллекционные (НФТ) юзернеймы, выданные админом. */
  nftUsernames: string[];
  /** Стиль профиля: id цвета имени, эмодзи-статус, id фона профиля. */
  nameColor: string | null;
  emojiStatus: string | null;
  profileBg: string | null;
  /** До какого момента нельзя писать первым (мс). */
  spamUntil: number | null;
  /** Админ запретил менять имя, @имя, «О себе» и аватарку. */
  profileLocked: boolean;
  /** Служебный бот (@bobotools). */
  isBot: boolean;
  /** Со-владелец: защищён от других админов, назначает владелец. */
  coOwner: boolean;
  /** Значок разработчика Bobogram (выдаёт владелец). */
  developer: boolean;
  /** Писать в личку могут только пользователи с галочкой (и админы). */
  dmVerifiedOnly: boolean;
}

export function isSpamblocked(p: Pick<UserProfile, 'spamUntil'> | null | undefined): boolean {
  return !!p?.spamUntil && p.spamUntil > Date.now();
}

/** Какое из имён человека совпало с поиском: основное или НФТ. */
export function matchedUsername(p: UserProfile, query: string): { name: string; nft: boolean } {
  const q = query.replace(/^@/, '').toLowerCase();
  if (!q || p.username.toLowerCase().startsWith(q)) return { name: p.username, nft: false };
  const nft = p.nftUsernames.find((n) => n.toLowerCase().startsWith(q));
  return nft ? { name: nft, nft: true } : { name: p.username, nft: false };
}

export function isPremium(p: Pick<UserProfile, 'premiumUntil'> | null | undefined): boolean {
  return !!p?.premiumUntil && p.premiumUntil > Date.now();
}

export type ChatType = 'private' | 'group' | 'channel' | 'saved';
export type MemberRole = 'owner' | 'admin' | 'member';

export type SystemEvent =
  | { kind: 'created'; title: string }
  | { kind: 'joined' }
  | { kind: 'left' }
  | { kind: 'added'; uids: string[] }
  | { kind: 'removed'; uid: string }
  | { kind: 'renamed'; title: string };

export interface CallInfo {
  video: boolean;
  /** Длительность в секундах; 0 — пропущенный или отменённый звонок. */
  duration: number;
}

export interface LastMessage {
  id: string;
  text: string;
  senderId: string;
  createdAt: number;
  deleted: boolean;
  system: SystemEvent | null;
  call: CallInfo | null;
  media: { kind: MediaKind } | null;
  /** Тихое сообщение: без звука и пуша. */
  silent?: boolean;
}

export interface Chat {
  id: string;
  type: ChatType;
  title: string | null;
  description: string;
  avatar: string | null;
  ownerId: string | null;
  inviteCode: string | null;
  pinnedMessageIds: string[];
  lastMessage: LastMessage | null;
  createdAt: number;
  updatedAt: number;
  /** null — я не участник (админ сервиса смотрит группу). */
  myRole: MemberRole | null;
  lastReadAt: number;
  pinned: boolean;
  muted: boolean;
  /** Сообщения до этого момента скрыты только у текущего пользователя. */
  clearedAt: number;
  unread: number;
  memberCount: number;
  /** Собеседник в личном чате. */
  otherId: string | null;
  /** Когда другие участники последний раз читали чат (для галочек). */
  othersReadAt: number;
  verified: boolean;
  scam: boolean;
  /** Группа с темами. */
  forum: boolean;
}

/** Тема группы; id null — «Общее» (сообщения без темы). */
export interface Topic {
  id: string | null;
  title: string | null;
  emoji: string | null;
  closed: boolean;
  createdAt: number;
  lastMessage: LastMessage | null;
  unread: number;
}

export interface Member {
  userId: string;
  role: MemberRole;
  lastReadAt: number;
}

export interface ReplyRef {
  id: string;
  senderId: string;
  snippet: string;
}

export interface ForwardRef {
  senderName: string;
  chatTitle: string | null;
}

export type MediaKind = 'photo' | 'voice';

export interface MediaInfo {
  kind: MediaKind;
  /** Путь в бакете media: <uid>/<uuid>.<ext>. */
  path: string;
  mime?: string;
  size?: number;
  width?: number;
  height?: number;
  /** Длительность голосового, секунды. */
  duration?: number;
  /** Громкость по отрезкам голосового, 0..31. */
  waveform?: number[];
}

export interface Story {
  id: string;
  authorId: string;
  mediaPath: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  createdAt: number;
  expiresAt: number;
  viewed: boolean;
}

export interface StorySummary {
  count: number;
  hasUnviewed: boolean;
  firstStoryId: string | null;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  createdAt: number;
  editedAt: number | null;
  deleted: boolean;
  deletedFor: string[];
  replyTo: ReplyRef | null;
  forwardedFrom: ForwardRef | null;
  reactions: Record<string, string[]>;
  system: SystemEvent | null;
  call: CallInfo | null;
  /** Настоящие просмотры (каналы и группы). */
  views: number;
  boostViews: number;
  /** Накрутка реакций: эмодзи → сколько прибавить. */
  boostReactions: Record<string, number>;
  media: MediaInfo | null;
  /** Тема группы (null — «Общее» или обычный чат). */
  topicId?: string | null;
  /** Локальный адрес файла, пока он загружается (только у своих неотправленных). */
  localUrl?: string;
  /** Файл ещё загружается в хранилище. */
  uploading?: boolean;
  /** Ещё не дошло до сервера (офлайн-очередь). */
  pending: boolean;
  /** Сервер отказал (например, собеседник заблокировал). */
  failed?: boolean;
}

export type CallStatus = 'ringing' | 'accepted' | 'declined' | 'ended' | 'missed';

export interface CallRow {
  id: string;
  callerId: string;
  calleeId: string;
  chatId: string;
  video: boolean;
  status: CallStatus;
  offer: RTCSessionDescriptionInit | null;
  answer: RTCSessionDescriptionInit | null;
  createdAt: number;
}

export const GROUP_MAX_MEMBERS = 50;
export const GROUP_MAX_MEMBERS_PREMIUM = 200;
export const BIO_MAX = 70;
export const BIO_MAX_PREMIUM = 200;
export const PINNED_CHATS_MAX = 5;
export const PINNED_CHATS_MAX_PREMIUM = 10;
export const CHANNEL_MAX_MEMBERS = 1000;
export const MESSAGE_MAX_LENGTH = 4096;

/** Дозаполняет поля сообщения, сохранённого старой версией приложения (кэш, офлайн-очередь). */
export function normalizeMessage(m: Message): Message {
  return {
    ...m,
    deletedFor: m.deletedFor ?? [],
    reactions: m.reactions ?? {},
    views: m.views ?? 0,
    boostViews: m.boostViews ?? 0,
    boostReactions: m.boostReactions ?? {},
    media: m.media ?? null,
  };
}
