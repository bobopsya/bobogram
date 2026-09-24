export const USERNAME_MIN = 4;
export const USERNAME_MAX = 32;

export type UsernameError = 'short' | 'long' | 'start' | 'chars' | null;

/** Убирает @ в начале и пробелы. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '');
}

/** Правила как в Telegram: латиница, цифры и _, начинается с буквы, 4–32 символа. */
export function validateUsername(raw: string): UsernameError {
  const name = normalizeUsername(raw);
  if (name.length < USERNAME_MIN) return 'short';
  if (name.length > USERNAME_MAX) return 'long';
  if (!/^[a-zA-Z]/.test(name)) return 'start';
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return 'chars';
  return null;
}
