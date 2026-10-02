'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { Banner, Button, Card, CopyButton, Dialog, ErrorNotice } from '@/components/ui';

interface IssuerKey {
  did: string;
  didDocumentUrl: string;
  keyId: string;
  algorithm: string;
  publicKeyMultibase: string;
}

/**
 * Issuer cryptographic identity (FR-STD-03).
 *
 * Exposed to customers rather than hidden in an admin console, because it is
 * the thing that makes their credentials theirs. An institution's security
 * team will ask what key signs their diplomas and where its public half is
 * published; this page is that answer.
 */
export default function IssuerSettingsPage() {
  const { can } = useAuth();
  const key = useApi<IssuerKey>('/v1/org/issuer-key');
  const [rotateOpen, setRotateOpen] = useState(false);

  const rotate = useMutation(async () => {
    await api.post('/v1/org/issuer-key/rotate');
    setRotateOpen(false);
    key.reload();
  });

  if (key.loading) return <div className="skeleton" style={{ height: 260 }} />;
  if (key.error) return <ErrorNotice error={key.error} />;
  if (!key.data) return null;

  return (
    <div className="stack">
      <Card
        title="Signing key"
        description="Every credential you issue carries a detached signature made with this key."
      >
        <dl className="kv">
          <dt>Issuer DID</dt>
          <dd className="row" style={{ gap: 4, minWidth: 0 }}>
            <code className="mono truncate">{key.data.did}</code>
            <CopyButton value={key.data.did} label="" />
          </dd>

          <dt>DID document</dt>
          <dd className="truncate">
            <a href={key.data.didDocumentUrl} rel="noopener">
              {key.data.didDocumentUrl}
            </a>
          </dd>

          <dt>Algorithm</dt>
          <dd>{key.data.algorithm}</dd>

          <dt>Key ID</dt>
          <dd>
            <code className="mono">{key.data.keyId}</code>
          </dd>

          <dt>Public key</dt>
          <dd className="row" style={{ gap: 4, minWidth: 0 }}>
            <code className="mono truncate" style={{ fontSize: '0.75rem' }}>
              {key.data.publicKeyMultibase}
            </code>
            <CopyButton value={key.data.publicKeyMultibase} label="" />
          </dd>
        </dl>
      </Card>

      <Card title="How verification works">
        <div className="stack-sm stack">
          <p className="muted">
            A verifier resolves your DID to the document above over ordinary HTTPS, reads the
            public key, and checks the credential&rsquo;s{' '}
            <code className="mono">eddsa-jcs-2022</code> Data Integrity proof against it. Nothing
            in that chain requires our cooperation or our continued existence — your domain and
            your TLS certificate are the root of trust.
          </p>
          <p className="muted">
            The private half never leaves the API process. It is encrypted at rest with AES-256-GCM
            and is not returned by any endpoint.
          </p>
        </div>
      </Card>

      {can('org:update') && (
        <Card
          title="Rotate the key"
          description="Issue future credentials under a new key, without invalidating anything already issued."
        >
          <div className="stack">
            <p className="muted">
              The current key stays published in your DID document after rotation, so every
              credential ever signed with it keeps verifying. Rotate if you believe the key may
              have been exposed, or on whatever schedule your security policy sets.
            </p>
            <div className="row">
              <Button onClick={() => setRotateOpen(true)}>Rotate signing key</Button>
            </div>
          </div>
        </Card>
      )}

      <Dialog
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        title="Rotate the signing key"
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setRotateOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={rotate.busy} onClick={() => void rotate.run()}>
              Rotate
            </Button>
          </div>
        }
      >
        <div className="stack">
          {rotate.error && <ErrorNotice error={rotate.error} />}
          <Banner tone="info">
            A new key is generated and becomes the signing key immediately. The old key remains in
            your DID document as a verification method, so historic credentials continue to verify.
            Nothing already issued is affected.
          </Banner>
        </div>
      </Dialog>
    </div>
  );
}
