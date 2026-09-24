'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Offline links use full navigation: RSC payloads are deliberately not cached. */
export function OfflineStatus() {
  const pathname = usePathname();
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const cachePage = () => navigator.serviceWorker.controller?.postMessage({ type: 'CACHE_PAGE', url: location.href });
    cachePage();
    navigator.serviceWorker.addEventListener('controllerchange', cachePage);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', cachePage);
  }, [pathname]);

  const [offline, setOffline] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let disposed = false;
    let connectivityCheck = 0;
    let reachable = navigator.onLine;
    const update = () => {
      const check = ++connectivityCheck;
      reachable = navigator.onLine;
      setOffline(!reachable);
      // onLine only reports the network adapter, not whether this origin is
      // reachable. HEAD bypasses our GET-only worker and the HTTP cache.
      if (navigator.onLine) fetch('/offline.html', { method: 'HEAD', cache: 'no-store' })
        .then(() => { if (!disposed && check === connectivityCheck) { reachable = true; setOffline(false); } })
        .catch(() => { if (!disposed && check === connectivityCheck) { reachable = false; setOffline(true); } });
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const navigate = (event: MouseEvent) => {
      if ((reachable && navigator.onLine) || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest('a') : null;
      if (!(target instanceof HTMLAnchorElement) || target.download || (target.target && target.target !== '_self')) return;
      const url = new URL(target.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
      event.preventDefault();
      event.stopPropagation();
      location.assign(url.href);
    };
    document.addEventListener('click', navigate, true);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => {
        if (disposed) return;
        const report = () => {
          if (disposed) return;
          if (registration.waiting) setStatus('Update ready: save your work, then close all lab tabs and reopen.');
          else if (registration.active?.state === 'activated') setStatus('Offline cache prepared. Previously visited pages may be available.');
          else setStatus('Offline cache is still preparing.');
        };
        if (registration.waiting) report();
        navigator.serviceWorker.ready.then(report);
        const observeInstall = () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (disposed) return;
            if (worker.state === 'redundant' && !registration.active) setStatus('Offline cache unavailable. Export projects before leaving.');
            else report();
          });
        };
        observeInstall();
        registration.addEventListener('updatefound', observeInstall);
      }).catch(() => { if (!disposed) setStatus('Offline cache unavailable. Export projects before leaving.'); });
    }
    return () => {
      disposed = true;
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      document.removeEventListener('click', navigate, true);
    };
  }, []);
  if (!offline && !status.startsWith('Update') && !status.includes('unavailable')) return null;
  return <div role="status" className="fixed bottom-2 left-2 z-50 max-w-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs shadow-lg">
    {offline ? `Offline — ${status || 'only already cached pages may be available.'}` : status}
  </div>;
}
