import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Spinner } from '../ui/misc';
import { ChatList } from '../features/chats/ChatList';

/**
 * ПК: список чатов слева, выбранный экран справа.
 * Телефон: на главной только список, на остальных маршрутах — экран целиком.
 */
export function Layout() {
  const { pathname } = useLocation();
  const hasMain = pathname !== '/';
  return (
    <div className={hasMain ? 'layout has-main' : 'layout'}>
      <aside className="sidebar">
        <ChatList />
      </aside>
      <main className="main">
        <Suspense
          fallback={
            <div className="screen center-pad">
              <Spinner />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
