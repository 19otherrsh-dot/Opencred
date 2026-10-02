'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, which is what makes the recipient wallet
 * installable as a PWA (FR-DEL-04).
 *
 * Registration is deliberately deferred until after load: it is a
 * nice-to-have, and competing with the first paint for bandwidth on a phone
 * would trade a real metric for a speculative one.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // A failed registration costs the install prompt and nothing else.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
