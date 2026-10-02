import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from './form';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Access your workspace."
      footer={
        <p className="subtle">
          No workspace yet? <Link href="/register">Create one free</Link>
        </p>
      }
    >
      {/*
        The form reads `?next=` and `?error=` from the URL, which makes it a
        client component that suspends. The shell around it stays static.
      */}
      <Suspense fallback={<div className="skeleton" style={{ height: 220 }} />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
