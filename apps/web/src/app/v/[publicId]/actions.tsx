'use client';

import { useEffect, useState } from 'react';

/**
 * The interactive island on the verification page.
 *
 * Kept small and client-only so the page itself stays a server-rendered
 * document. The event tracking here is fire-and-forget: a blocked request must
 * never stop someone downloading their certificate.
 */
/**
 * Labels are passed in already translated rather than looked up here.
 *
 * The locale is negotiated on the server from `Accept-Language`, and shipping
 * six message catalogues to the browser so this island could redo that work
 * would add weight to the one page that must stay light.
 */
export interface ActionLabels {
  download: string;
  share: string;
  shareCopied: string;
  addToLinkedIn: string;
  addToAppleWallet: string;
  addToGoogleWallet: string;
  viewJson: string;
}

export function VerificationActions({
  publicId,
  downloadUrl,
  badgeUrl,
  apiBase,
  title,
  issuerName,
  issuedAt,
  expiresAt,
  valid,
  wallets,
  labels,
}: {
  publicId: string;
  downloadUrl: string;
  badgeUrl: string;
  apiBase: string;
  title: string;
  issuerName: string;
  issuedAt: string | null;
  expiresAt: string | null;
  valid: boolean;
  wallets: { apple: boolean; google: boolean };
  labels: ActionLabels;
}) {
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');

  const track = (event: string) => {
    void fetch(`${apiBase}/v1/public/t/${encodeURIComponent(publicId)}/${event}`, {
      method: 'POST',
      keepalive: true,
    }).catch(() => undefined);
  };

  // A page view is recorded once per mount rather than on the server, so that
  // a CDN cache hit does not silently stop counting views.
  useEffect(() => {
    track('viewed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicId]);

  const linkedInUrl = (() => {
    const url = new URL('https://www.linkedin.com/profile/add');
    url.searchParams.set('startTask', 'CERTIFICATION_NAME');
    url.searchParams.set('name', title);
    url.searchParams.set('organizationName', issuerName);
    if (issuedAt) {
      const date = new Date(issuedAt);
      url.searchParams.set('issueYear', String(date.getUTCFullYear()));
      url.searchParams.set('issueMonth', String(date.getUTCMonth() + 1));
    }
    if (expiresAt) {
      const date = new Date(expiresAt);
      url.searchParams.set('expirationYear', String(date.getUTCFullYear()));
      url.searchParams.set('expirationMonth', String(date.getUTCMonth() + 1));
    }
    url.searchParams.set('certUrl', typeof window === 'undefined' ? '' : window.location.href);
    url.searchParams.set('certId', publicId);
    return url.toString();
  })();

  const share = async () => {
    const shareData = {
      title,
      text: `${title} — issued by ${issuerName}`,
      url: typeof window === 'undefined' ? '' : window.location.href,
    };

    // The Web Share API is the right thing on a phone, which is where most
    // recipients open this. Desktop falls back to the clipboard.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData);
        track('shared');
        return;
      } catch {
        // The user dismissed the sheet; that is not an error.
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareData.url);
      setShareState('copied');
      track('shared');
      setTimeout(() => setShareState('idle'), 2000);
    } catch {
      /* clipboard permission denied */
    }
  };

  return (
    <section className="card card-pad stack-sm stack">
      <a
        className="btn btn-primary btn-block"
        href={downloadUrl}
        onClick={() => track('viewed')}
        download
      >
        {labels.download}
      </a>

      <button type="button" className="btn btn-secondary btn-block" onClick={share}>
        {shareState === 'copied' ? labels.shareCopied : labels.share}
      </button>

      {valid && (
        <a
          className="btn btn-secondary btn-block"
          href={linkedInUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track('linkedin_added')}
        >
          {labels.addToLinkedIn}
        </a>
      )}

      {/*
        Wallet buttons appear only where the deployment is actually enrolled
        with Apple or Google. A button that leads to "not configured" is worse
        than no button, and most self-hosted installs will have neither.

        These are plain links rather than tracked clicks: the API records the
        `wallet_added` event server-side when the pass is generated, so the
        count reflects passes issued rather than buttons pressed.
      */}
      {valid && wallets.apple && (
        <a
          className="btn btn-secondary btn-block"
          href={`${apiBase}/v1/public/credentials/${encodeURIComponent(publicId)}/wallet/apple`}
        >
          {labels.addToAppleWallet}
        </a>
      )}

      {valid && wallets.google && (
        <a
          className="btn btn-secondary btn-block"
          href={`${apiBase}/v1/public/credentials/${encodeURIComponent(publicId)}/wallet/google`}
          rel="noopener"
        >
          {labels.addToGoogleWallet}
        </a>
      )}

      <a
        className="btn btn-ghost btn-block"
        href={badgeUrl}
        rel="noopener"
        style={{ fontSize: '0.82rem' }}
      >
        {labels.viewJson}
      </a>
    </section>
  );
}
