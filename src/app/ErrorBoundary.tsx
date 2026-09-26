import { Component, type ReactNode } from 'react';

/** Чистит кэш приложения (не вход) и перезагружает страницу. */
function resetCache() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('bobogram.msgs.') || key === 'bobogram.chats' || key === 'bobogram.outbox') {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // недоступно — просто перезагрузим
  }
  location.reload();
}

const CHUNK_ERROR =
  /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload/i;
const RELOAD_KEY = 'bobogram.chunkReloadAt';

/**
 * После обновления сайта у долго открытой вкладки старые куски кода (например, админка) уже удалены.
 * Тихо перезагружаем страницу на новую версию — не чаще раза в 30 секунд, чтобы не зациклиться.
 */
export function reloadForNewVersion(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  if (!CHUNK_ERROR.test(msg)) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // без sessionStorage всё равно пробуем один раз
  }
  location.reload();
  return true;
}

/** Вместо пустого экрана при ошибке показывает её и кнопку сброса кэша. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (CHUNK_ERROR.test(String(this.state.error.message)) && reloadForNewVersion(this.state.error)) {
      return <div className="crash-screen" />;
    }
    return (
      <div className="crash-screen">
        <h2>Что-то пошло не так</h2>
        <p className="muted small">Something went wrong</p>
        <pre>{String(this.state.error.message || this.state.error)}</pre>
        <button type="button" className="btn btn-primary" onClick={resetCache}>
          Очистить кэш и перезагрузить
        </button>
        <button type="button" className="btn" onClick={() => location.reload()}>
          Перезагрузить
        </button>
      </div>
    );
  }
}
