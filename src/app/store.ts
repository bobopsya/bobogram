import { create } from 'zustand';
import type { Chat, Message, UserProfile } from '../supabase/types';
import { DEFAULT_APPEARANCE, type Appearance } from './themes';

export type ThemeMode = 'system' | 'light' | 'dark';

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // переполнено или недоступно — не страшно
  }
}

interface AppState {
  authReady: boolean;
  userId: string | null;
  /** undefined — ещё грузится, null — профиля нет. */
  profile: UserProfile | null | undefined;
  blocked: string[];
  chats: Chat[];
  chatsLoaded: boolean;
  /** Неотправленные сообщения (офлайн-очередь), сохраняются между запусками. */
  outbox: Message[];
  online: boolean;
  theme: ThemeMode;
  appearance: Appearance;
  sound: boolean;
  toast: string | null;

  setTheme: (t: ThemeMode) => void;
  setAppearance: (patch: Partial<Appearance>) => void;
  setSound: (on: boolean) => void;
  showToast: (text: string) => void;
}

let toastTimer: number | undefined;

export const useApp = create<AppState>((set) => ({
  authReady: false,
  userId: null,
  profile: undefined,
  blocked: [],
  chats: read<Chat[]>('bobogram.chats', []),
  chatsLoaded: false,
  outbox: read<Message[]>('bobogram.outbox', []),
  online: navigator.onLine,
  theme: read<ThemeMode>('bobogram.theme', 'system'),
  appearance: { ...DEFAULT_APPEARANCE, ...read<Partial<Appearance>>('bobogram.appearance', {}) },
  sound: read<boolean>('bobogram.sound', true),
  toast: null,

  setTheme: (theme) => {
    write('bobogram.theme', theme);
    set({ theme });
  },
  setAppearance: (patch) =>
    set((s) => {
      const appearance = { ...s.appearance, ...patch };
      write('bobogram.appearance', appearance);
      return { appearance };
    }),
  setSound: (sound) => {
    write('bobogram.sound', sound);
    set({ sound });
  },
  showToast: (toast) => {
    window.clearTimeout(toastTimer);
    set({ toast });
    toastTimer = window.setTimeout(() => set({ toast: null }), 2500);
  },
}));

// Список чатов и очередь переживают перезапуск (для работы без сети).
useApp.subscribe((s, prev) => {
  if (s.chats !== prev.chats) write('bobogram.chats', s.chats);
  if (s.outbox !== prev.outbox) write('bobogram.outbox', s.outbox);
});

/** uid текущего пользователя; вызывать только внутри авторизованной части приложения. */
export function useMe(): string {
  return useApp((s) => s.userId ?? '');
}

export function useMyProfile(): UserProfile {
  return useApp((s) => s.profile!) as UserProfile;
}

export function useChatById(chatId: string | undefined): Chat | undefined {
  return useApp((s) => s.chats.find((c) => c.id === chatId));
}
