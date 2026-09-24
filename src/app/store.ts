import { create } from 'zustand';
import type { User } from 'firebase/auth';
import type { Chat, UserChatPrefs, UserProfile } from '../firebase/types';

export type ThemeMode = 'system' | 'light' | 'dark';

function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem('bobogram.theme');
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // ignore
  }
  return 'system';
}

function readSound(): boolean {
  try {
    return localStorage.getItem('bobogram.sound') !== 'off';
  } catch {
    return true;
  }
}

interface AppState {
  authReady: boolean;
  user: User | null;
  emailVerified: boolean;
  /** undefined — ещё грузится, null — профиля нет (нужно выбрать юзернейм). */
  profile: UserProfile | null | undefined;
  blocked: string[];
  chats: Chat[];
  chatsLoaded: boolean;
  prefs: Record<string, UserChatPrefs>;
  online: boolean;
  theme: ThemeMode;
  sound: boolean;
  toast: string | null;

  setTheme: (t: ThemeMode) => void;
  setSound: (on: boolean) => void;
  showToast: (text: string) => void;
}

let toastTimer: number | undefined;

export const useApp = create<AppState>((set) => ({
  authReady: false,
  user: null,
  emailVerified: false,
  profile: undefined,
  blocked: [],
  chats: [],
  chatsLoaded: false,
  prefs: {},
  online: navigator.onLine,
  theme: readTheme(),
  sound: readSound(),
  toast: null,

  setTheme: (theme) => {
    try {
      localStorage.setItem('bobogram.theme', theme);
    } catch {
      // ignore
    }
    set({ theme });
  },
  setSound: (sound) => {
    try {
      localStorage.setItem('bobogram.sound', sound ? 'on' : 'off');
    } catch {
      // ignore
    }
    set({ sound });
  },
  showToast: (toast) => {
    window.clearTimeout(toastTimer);
    set({ toast });
    toastTimer = window.setTimeout(() => set({ toast: null }), 2500);
  },
}));

/** uid текущего пользователя; вызывать только внутри авторизованной части приложения. */
export function useMe(): string {
  return useApp((s) => s.user?.uid ?? '');
}

export function useMyProfile(): UserProfile {
  return useApp((s) => s.profile!) as UserProfile;
}
