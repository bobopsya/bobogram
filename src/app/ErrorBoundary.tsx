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

/** Вместо пустого экрана при ошибке показывает её и кнопку сброса кэша. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
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
