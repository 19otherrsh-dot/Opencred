import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { ResetForm } from '../reset-password/form';

export const metadata: Metadata = { title: 'Accept your invitation', robots: { index: false } };

/**
 * Accepting an invitation is the same operation as setting a password from a
 * single-use token, so it reuses that form rather than duplicating it. Only the
 * framing copy differs, because the user's situation does.
 */
export default function AcceptInvitePage() {
  return (
    <AuthShell
      title="Set your password"
      subtitle="You have been invited to a workspace. Choose a password to finish joining."
    >
      <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
