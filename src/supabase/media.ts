import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from './client';

const BUCKET = 'media';
/** Ссылки на закрытые файлы живут 6 часов; обновляем заранее. */
const URL_TTL = 6 * 3600;

export async function uploadMedia(path: string, file: Blob, contentType: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;
}

// ---------- временные ссылки: общий кэш, запрашиваются пачками ----------
const urls = new Map<string, { url: string; until: number }>();
const listeners = new Map<string, Set<() => void>>();
let queue = new Set<string>();
let timer: number | undefined;

function notify(path: string) {
  listeners.get(path)?.forEach((l) => l());
}

/** Пока файл только что отправлен — показываем его локальную копию, без запроса. */
export function primeMediaUrl(path: string, url: string) {
  urls.set(path, { url, until: Date.now() + URL_TTL * 1000 });
  notify(path);
}

function request(path: string) {
  const cached = urls.get(path);
  if ((cached && cached.until - Date.now() > 10 * 60_000) || queue.has(path)) return;
  queue.add(path);
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const paths = [...queue];
    queue = new Set();
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, URL_TTL);
    for (const item of data ?? []) {
      if (!item.path || !item.signedUrl) continue;
      urls.set(item.path, { url: item.signedUrl, until: Date.now() + URL_TTL * 1000 });
      notify(item.path);
    }
  }, 30);
}

/** Адрес файла для <img>/<audio>; undefined — ещё загружается. */
export function useMediaUrl(path: string | null | undefined): string | undefined {
  const key = path ?? '';
  useEffect(() => {
    if (key) request(key);
  }, [key]);
  return useSyncExternalStore(
    (l) => {
      if (!key) return () => undefined;
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(l);
      return () => set.delete(l);
    },
    () => (key ? urls.get(key)?.url : undefined),
  );
}
