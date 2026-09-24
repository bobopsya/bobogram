import { createClient } from '@supabase/supabase-js';

const env = import.meta.env;

/** true, если сайт собран с адресом и ключом проекта Supabase. */
export const isConfigured = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);

export const supabase = createClient(
  env.VITE_SUPABASE_URL || 'http://localhost:54321',
  env.VITE_SUPABASE_ANON_KEY || 'not-configured',
  {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bobogram.auth' },
    realtime: { params: { eventsPerSecond: 20 } },
  },
);

/** Служебная почта аккаунта: пользователи входят по @юзернейму, почта им не нужна. */
export function accountEmail(): string {
  return `${crypto.randomUUID()}@users.bobogram.app`;
}
