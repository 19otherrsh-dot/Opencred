import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { ResetForm } from './form';

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      footer={
        <p className="subtle">
          Remembered it? <Link href="/login">Sign in</Link>
        </p>
      }
    >
      <Suspense fallback={<div className="skeleton" style={{ height: 160 }} />}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
