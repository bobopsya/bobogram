import { useEffect, useState } from 'react';
import { getServiceStatus, type ServiceStatus } from '../supabase/api';
import { isConfigured } from '../supabase/client';

const OPEN: ServiceStatus = { maintenance: { on: false, message: null, until: null }, signups: 'open' };

/** Техобслуживание и режим регистрации: спрашиваем при запуске, раз в 30 секунд и при возврате на вкладку. */
export function useServiceStatus(): ServiceStatus {
  const [status, setStatus] = useState<ServiceStatus>(OPEN);
  useEffect(() => {
    if (!isConfigured) return;
    const load = () => void getServiceStatus().then(setStatus, () => undefined);
    load();
    const timer = window.setInterval(load, 30_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return status;
}
