import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { RegisterForm } from './form';

export const metadata: Metadata = {
  title: 'Create a workspace',
  description: 'Start issuing verifiable credentials. Free tier, no card, no setup fee.',
};

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Free to start. No card, no setup fee, no contract."
      footer={
        <p className="subtle">
          Already have one? <Link href="/login">Sign in</Link>
        </p>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
