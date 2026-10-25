import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router';

const SW_URL = '/sw.js';
const NAV_CACHE = 'nav';
const NAV_SLOT = '/__pending-nav';

async function consumePendingNav(route: (href: string) => void): Promise<void> {
  try {
    const cache = await caches.open(NAV_CACHE);
    const response = await cache.match(NAV_SLOT);
    if (response == null) return;
    await cache.delete(NAV_SLOT);
    const payload: unknown = await response.json();
    const href = (payload as { href?: unknown }).href;
    if (typeof href === 'string' && href !== '') route(href);
  } catch {}
}

export function PwaBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(SW_URL).catch(() => {});
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; href?: unknown } | null;
      if (data?.type === 'notificationclick' && typeof data.href === 'string') {
        navigate(data.href);
        void caches
          .open(NAV_CACHE)
          .then((cache) => cache.delete(NAV_SLOT))
          .catch(() => {});
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    void consumePendingNav((href) => navigate(href));
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);
  return <Outlet />;
}
