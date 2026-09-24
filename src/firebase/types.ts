import type { Timestamp } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  username: string;
  usernameLower: string;
  displayName: string;
  bio: string;
  avatar: string | null;
  createdAt: Timestamp | null;
  role: 'user' | 'admin';
  banned: boolean;
  hideLastSeen: boolean;
}

export type ChatType = 'private' | 'group' | 'channel' | 'saved';

export interface LastMessage {
  id: string;
  text: string;
  senderId: string;
  createdAt: Timestamp | null;
  deleted?: boolean;
  system?: boolean;
  event?: SystemEvent | null;
  call?: CallInfo | null;
}

export interface Chat {
  id: string;
  type: ChatType;
  members: string[];
  admins: string[];
  ownerId: string | null;
  title: string | null;
  avatar: string | null;
  description: string;
  inviteCode: string | null;
  lastMessage: LastMessage | null;
  updatedAt: Timestamp | null;
  createdAt: Timestamp | null;
  pinnedMessageIds: string[];
  readBy: Record<string, Timestamp | null>;
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

export type SystemEvent =
  | { kind: 'created'; title: string }
  | { kind: 'joined' }
  | { kind: 'left' }
  | { kind: 'added'; uids: string[] }
  | { kind: 'removed'; uid: string }
  | { kind: 'renamed'; title: string };

export interface CallInfo {
  video: boolean;
  /** Длительность в секундах; 0 — пропущенный или отклонённый звонок. */
  duration: number;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  createdAt: Timestamp | null;
  editedAt: Timestamp | null;
  deleted: boolean;
  deletedFor: string[];
  replyTo: ReplyRef | null;
  forwardedFrom: ForwardRef | null;
  reactions: Record<string, string[]>;
  system: SystemEvent | null;
  call: CallInfo | null;
  /** Локальное поле: сообщение ещё не дошло до сервера. */
  pending: boolean;
}

export interface UserChatPrefs {
  pinned: boolean;
  mutedUntil: number | null;
}

export type CallStatus = 'ringing' | 'accepted' | 'declined' | 'ended' | 'missed';

export interface CallDoc {
  id: string;
  callerId: string;
  calleeId: string;
  chatId: string;
  video: boolean;
  status: CallStatus;
  offer: { type: string; sdp: string } | null;
  answer: { type: string; sdp: string } | null;
  createdAt: Timestamp | null;
  answeredAt: Timestamp | null;
  endedAt: Timestamp | null;
}

export const GROUP_MAX_MEMBERS = 50;
export const CHANNEL_MAX_MEMBERS = 1000;
export const MESSAGE_MAX_LENGTH = 4096;
