import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { VerifyEmailClient } from './client';

export const metadata: Metadata = { title: 'Confirm your email', robots: { index: false } };

export default function VerifyEmailPage() {
  return (
    <AuthShell title="Confirming your email">
      <Suspense fallback={<div className="skeleton" style={{ height: 80 }} />}>
        <VerifyEmailClient />
      </Suspense>
    </AuthShell>
  );
}
