'use client';

import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { Banner, Button, Card, ErrorNotice } from '@/components/ui';

interface Plan {
  id: string;
  name: string;
  priceCents: number | null;
  startingAtCents?: number;
  setupFeeCents: number;
  includedCredentialsPerYear: number | null;
  overageCentsPerCredential: number | null;
  selfHosted: boolean;
  blurb: string;
}

interface Usage {
  plan: string;
  periodStart: string;
  periodEnd: string;
  credentialsIssued: number;
  included: number | null;
  remaining: number | null;
  overage: number;
  overageCostCents: number;
  metered: boolean;
  note?: string;
}

interface Subscription {
  plan: string;
  planName: string;
  priceCents: number | null;
  status: string;
  currentPeriodEnd: string | null;
  selfHosted: boolean;
  metered: boolean;
}

export default function BillingSettingsPage() {
  const { can, session, refresh } = useAuth();
  const plans = useApi<{ plans: Plan[]; selfServe: string[]; note: string }>('/v1/billing/plans');
  const usage = useApi<Usage>('/v1/billing/usage');
  const subscription = useApi<Subscription>('/v1/billing/subscription');

  const change = useMutation(async (planId: string) => {
    await api.post('/v1/billing/subscription', { plan: planId });
    subscription.reload();
    usage.reload();
    await refresh();
  });

  const selfHosted = session?.edition !== 'cloud';

  return (
    <div className="stack">
      {selfHosted && (
        <Banner tone="info" title="Self-hosted installation">
          There is nothing to bill here. The Community Edition is the complete core platform,
          unlimited and unmetered. This page shows your usage because it is useful, not because it
          is counted against anything.
        </Banner>
      )}

      <Card title="Current plan">
        {subscription.loading ? (
          <div className="skeleton" style={{ height: 90 }} />
        ) : (
          <dl className="kv">
            <dt>Plan</dt>
            <dd>{subscription.data?.planName}</dd>
            <dt>Price</dt>
            <dd>{formatMoney(subscription.data?.priceCents ?? null)}</dd>
            <dt>Setup fee</dt>
            <dd>
              <strong>$0</strong> <span className="subtle">— on every plan, always</span>
            </dd>
            <dt>Status</dt>
            <dd style={{ textTransform: 'capitalize' }}>{subscription.data?.status}</dd>
            {subscription.data?.currentPeriodEnd && (
              <>
                <dt>Renews</dt>
                <dd>{formatDate(subscription.data.currentPeriodEnd)}</dd>
              </>
            )}
          </dl>
        )}
      </Card>

      <Card title="Usage this period">
        {usage.loading ? (
          <div className="skeleton" style={{ height: 110 }} />
        ) : (
          <div className="stack">
            <div className="stat">
              <span className="stat-value">
                {formatNumber(usage.data?.credentialsIssued)}
                {usage.data?.included != null && (
                  <span className="subtle" style={{ fontSize: '1.1rem', fontWeight: 400 }}>
                    {' '}
                    of {formatNumber(usage.data.included)}
                  </span>
                )}
              </span>
              <span className="stat-label">
                credentials issued
                {usage.data?.periodEnd ? ` · period ends ${formatDate(usage.data.periodEnd)}` : ''}
              </span>
            </div>

            {usage.data?.included != null && (
              <div
                style={{
                  height: 10,
                  borderRadius: 999,
                  background: 'var(--surface-3)',
                  overflow: 'hidden',
                }}
                role="progressbar"
                aria-valuenow={usage.data.credentialsIssued}
                aria-valuemin={0}
                aria-valuemax={usage.data.included}
                aria-label="Credentials used against the plan allowance"
              >
                <div
                  style={{
                    width: `${Math.min(100, (usage.data.credentialsIssued / usage.data.included) * 100)}%`,
                    height: '100%',
                    background:
                      usage.data.overage > 0 ? 'var(--warn)' : 'var(--brand)',
                  }}
                />
              </div>
            )}

            {usage.data && usage.data.overage > 0 && (
              <Banner tone="info">
                {formatNumber(usage.data.overage)} credentials above the included allowance, metered
                at {formatMoney(usage.data.overageCostCents)}. Issuance is never blocked on a paid
                plan — a graduating cohort does not stop because a counter rolled over.
              </Banner>
            )}

            {usage.data?.note && <p className="subtle">{usage.data.note}</p>}
          </div>
        )}
      </Card>

      {!selfHosted && (
        <Card title="Change plan" description="Upgrades and downgrades apply immediately. No call required.">
          {change.error && <ErrorNotice error={change.error} />}

          <div className="price-grid">
            {(plans.data?.plans ?? [])
              .filter((plan) => !plan.selfHosted || plan.id === 'enterprise')
              .map((plan) => {
                const current = plan.id === subscription.data?.plan;
                const selfServe = plans.data?.selfServe.includes(plan.id);
                return (
                  <article
                    key={plan.id}
                    className={`price-card${current ? ' featured' : ''}`}
                  >
                    <div>
                      <h3 style={{ fontSize: '1rem' }}>{plan.name}</h3>
                      <p className="subtle">{plan.blurb}</p>
                    </div>
                    <div className="price-amount">
                      {plan.priceCents === null
                        ? `From ${formatMoney(plan.startingAtCents ?? null)}`
                        : formatMoney(plan.priceCents)}
                    </div>
                    <p className="subtle">
                      {plan.includedCredentialsPerYear === null
                        ? 'Unlimited credentials'
                        : `${formatNumber(plan.includedCredentialsPerYear)} credentials/year`}
                    </p>
                    <div className="spacer" />
                    {current ? (
                      <span className="badge badge-ok">Current plan</span>
                    ) : can('org:billing') && selfServe ? (
                      <Button
                        variant="primary"
                        loading={change.busy}
                        onClick={() => void change.run(plan.id)}
                      >
                        Switch to {plan.name.replace('Cloud ', '')}
                      </Button>
                    ) : (
                      <a className="btn btn-secondary" href="mailto:sales@opencred.example">
                        Talk to us
                      </a>
                    )}
                  </article>
                );
              })}
          </div>

          {plans.data?.note && (
            <p className="subtle" style={{ marginTop: 'var(--sp-4)' }}>
              {plans.data.note}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
