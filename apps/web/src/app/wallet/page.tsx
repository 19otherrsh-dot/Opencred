import type { Metadata } from 'next';
import { WalletClient } from './client';
import { PUBLIC_API_URL } from '@/lib/config';
import { getPageTranslator } from '@/lib/locale';

export const metadata: Metadata = {
  title: 'Your credentials',
  description: 'Every credential ever issued to your email address, in one place.',
  robots: { index: false },
};

/**
 * The recipient wallet (FR-DEL-02).
 *
 * Cross-issuer by design: a recipient signs in with their email address and
 * sees every credential issued to it by every organisation on this
 * installation. That is the recipient-ownership claim made real — their
 * credentials are not scattered across the dashboards of institutions they no
 * longer have accounts with.
 *
 * Strings are resolved on the server and handed to the client island already
 * translated, so the wallet does not ship six message catalogues to a phone.
 */
export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const t = await getPageTranslator(await searchParams);

  return (
    <WalletClient
      apiBase={PUBLIC_API_URL}
      locale={t.locale}
      dir={t.dir}
      labels={{
        title: t.t('wallet.title'),
        intro: t.t('wallet.intro'),
        emailLabel: t.t('wallet.emailLabel'),
        emailHint: t.t('wallet.emailHint'),
        requestLink: t.t('wallet.requestLink'),
        checkInbox: t.t('wallet.checkInbox'),
        checkInboxBody: t.t('wallet.checkInboxBody', { email: '{email}' }),
        privacyNote: t.t('wallet.privacyNote'),
        empty: t.t('wallet.empty'),
        count: t.t('wallet.count', { count: '{count}', email: '{email}' }),
        issuedOn: t.t('wallet.issuedOn', { date: '{date}' }),
        expiresOn: t.t('wallet.expiresOn', { date: '{date}' }),
        download: t.t('verify.action.download'),
        verificationPage: t.t('wallet.action.verificationPage'),
        theseAreYours: t.t('wallet.theseAreYours'),
        theseAreYoursBody: t.t('wallet.theseAreYoursBody'),
        signOut: t.t('wallet.signOut'),
        statusValid: t.t('status.valid'),
        statusExpired: t.t('status.expired'),
        statusRevoked: t.t('status.revoked'),
      }}
    />
  );
}
