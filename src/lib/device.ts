import { useEffect } from 'react';
import { supabase } from '../supabase/client';
import { isIos, isStandalone } from '../app/effects';
import { useApp } from '../app/store';

const DEVICE_KEY = 'bobogram.deviceId';

/** Постоянный номер этого браузера/приложения (не связан с железом). */
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) localStorage.setItem(DEVICE_KEY, (id = crypto.randomUUID()));
    return id;
  } catch {
    return 'no-storage-' + navigator.userAgent.length.toString().padStart(4, '0');
  }
}

/** «iPhone · iOS 18.2», «Windows · Chrome 141» — из user agent. */
export function describeUserAgent(ua: string): { os: string; browser: string; device: string } {
  const v = (re: RegExp) => ua.match(re)?.[1]?.replace(/_/g, '.') ?? '';
  let os = 'Другая';
  let device = 'Компьютер';
  if (/iPhone/.test(ua)) [os, device] = [`iOS ${v(/OS (\d+[_\d]*)/)}`.trim(), 'iPhone'];
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) [os, device] = ['iPadOS', 'iPad'];
  else if (/Android/.test(ua))
    [os, device] = [`Android ${v(/Android (\d+(\.\d+)?)/)}`.trim(), v(/; ([^;)]+) Build/) || 'Android'];
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  let browser = 'Браузер';
  if (/YaBrowser\//.test(ua)) browser = `Яндекс ${v(/YaBrowser\/(\d+)/)}`;
  else if (/Edg\//.test(ua)) browser = `Edge ${v(/Edg\/(\d+)/)}`;
  else if (/SamsungBrowser\//.test(ua)) browser = `Samsung ${v(/SamsungBrowser\/(\d+)/)}`;
  else if (/OPR\//.test(ua)) browser = `Opera ${v(/OPR\/(\d+)/)}`;
  else if (/Firefox\//.test(ua)) browser = `Firefox ${v(/Firefox\/(\d+)/)}`;
  else if (/CriOS\//.test(ua)) browser = `Chrome ${v(/CriOS\/(\d+)/)}`;
  else if (/Chrome\//.test(ua)) browser = `Chrome ${v(/Chrome\/(\d+)/)}`;
  else if (/Safari\//.test(ua)) browser = `Safari ${v(/Version\/(\d+(\.\d+)?)/)}`.trim();
  return { os, browser, device };
}

function collect(): Record<string, unknown> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string };
  };
  return {
    app: __APP_VERSION__,
    pwa: isStandalone(),
    ios: isIos(),
    push: 'Notification' in window ? Notification.permission : 'unsupported',
    lang: navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${screen.width}×${screen.height} @${window.devicePixelRatio}x`,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    cores: nav.hardwareConcurrency ?? null,
    memory: nav.deviceMemory ?? null,
    net: nav.connection?.effectiveType ?? null,
    touch: navigator.maxTouchPoints > 0,
  };
}

/** Сообщает серверу об этом устройстве при входе и раз в 6 часов (для отладки админами). */
export function useDeviceReport() {
  const uid = useApp((s) => s.userId);
  useEffect(() => {
    if (!uid) return;
    const report = () =>
      void supabase.rpc('report_device', { p_device: deviceId(), p_info: collect() }).then(
        () => undefined,
        () => undefined,
      );
    report();
    const timer = window.setInterval(report, 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [uid]);
}
