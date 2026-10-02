import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WalletEnterClient } from './client';
import { PUBLIC_API_URL } from '@/lib/config';

export const metadata: Metadata = { title: 'Signing you in', robots: { index: false } };

export default function WalletEnterPage() {
  return (
    <main id="main" style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
      <Suspense fallback={<div className="skeleton" style={{ height: 60, width: 240 }} />}>
        <WalletEnterClient apiBase={PUBLIC_API_URL} />
      </Suspense>
    </main>
  );
}
