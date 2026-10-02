import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { planFor, type Plan } from '@opencred/schema';
import { PrismaService } from '../../common/prisma.service';
import { loadConfig } from '../../config';

/**
 * FR-BIL-02 — usage metering, visible to the customer in real time.
 *
 * Two properties matter more than the arithmetic:
 *
 *  1. Self-hosted installs are never metered. Community Edition counts nothing
 *     and blocks nothing. Metering software somebody runs on their own hardware
 *     would contradict the entire premise of the project.
 *
 *  2. On Cloud, exceeding an allowance on a *paid* plan meters an overage
 *     rather than blocking issuance. Refusing to issue the last hundred
 *     certificates of a graduating cohort because a counter rolled over is the
 *     kind of behaviour that makes people distrust SaaS. Only the free tier
 *     hard-stops, and it says so on the pricing page.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);
  private readonly config = loadConfig();

  constructor(private readonly prisma: PrismaService) {}

  get meteringEnabled(): boolean {
    return !this.config.isSelfHosted;
  }

  private periodFor(subscriptionStart?: Date): { start: Date; end: Date } {
    // The allowance is annual (Section 12 quotes credentials/year), anchored to
    // the subscription start so a customer who signs up in March gets a year
    // from March rather than a stub period ending in December.
    const anchor = subscriptionStart ?? new Date();
    const now = new Date();
    const start = new Date(anchor);
    while (start.getTime() > now.getTime()) start.setUTCFullYear(start.getUTCFullYear() - 1);
    const end = new Date(start);
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    while (end.getTime() <= now.getTime()) {
      start.setUTCFullYear(start.getUTCFullYear() + 1);
      end.setUTCFullYear(end.getUTCFullYear() + 1);
    }
    return { start, end };
  }

  async current(organizationId: string): Promise<{
    plan: Plan;
    periodStart: Date;
    periodEnd: Date;
    credentialsIssued: number;
    included: number | null;
    remaining: number | null;
    overage: number;
    overageCostCents: number;
    metered: boolean;
  }> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { subscription: true },
    });
    const plan = planFor(org.plan);
    const { start, end } = this.periodFor(org.subscription?.currentPeriodStart);

    const counter = await this.prisma.usageCounter.findUnique({
      where: { organizationId_periodStart: { organizationId, periodStart: start } },
    });

    const used = counter?.credentialsIssued ?? 0;
    const included = plan.includedCredentialsPerYear;
    const overage = included === null ? 0 : Math.max(0, used - included);

    return {
      plan,
      periodStart: start,
      periodEnd: end,
      credentialsIssued: used,
      included,
      remaining: included === null ? null : Math.max(0, included - used),
      overage,
      overageCostCents: overage * (plan.overageCentsPerCredential ?? 0),
      metered: this.meteringEnabled,
    };
  }

  /**
   * Called before a batch is accepted, with the number of credentials it will
   * produce. Throws only where the plan genuinely hard-stops.
   */
  async assertCanIssue(organizationId: string, count: number): Promise<void> {
    if (!this.meteringEnabled) return;

    const usage = await this.current(organizationId);
    if (usage.included === null) return;

    const wouldBe = usage.credentialsIssued + count;
    if (wouldBe <= usage.included) return;

    // Paid plans meter the excess; only the free tier stops.
    if (usage.plan.overageCentsPerCredential !== null) return;

    throw new ForbiddenException({
      error: 'plan_limit_reached',
      message:
        `This would issue ${wouldBe} credentials this period, above the ` +
        `${usage.included} included in ${usage.plan.name}. Upgrade in Settings → Billing, ` +
        `or self-host the Community Edition for unlimited issuance.`,
      used: usage.credentialsIssued,
      included: usage.included,
      requested: count,
      upgradeTo: 'growth',
    });
  }

  async recordIssuance(organizationId: string, count = 1): Promise<void> {
    if (!this.meteringEnabled) return;
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        include: { subscription: true },
      });
      const { start, end } = this.periodFor(org?.subscription?.currentPeriodStart);

      await this.prisma.usageCounter.upsert({
        where: { organizationId_periodStart: { organizationId, periodStart: start } },
        create: {
          organizationId,
          periodStart: start,
          periodEnd: end,
          credentialsIssued: count,
        },
        update: { credentialsIssued: { increment: count } },
      });
    } catch (err) {
      this.logger.error(`usage not recorded for ${organizationId}: ${(err as Error).message}`);
    }
  }

  async recordVerification(organizationId: string): Promise<void> {
    if (!this.meteringEnabled) return;
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        include: { subscription: true },
      });
      const { start, end } = this.periodFor(org?.subscription?.currentPeriodStart);
      await this.prisma.usageCounter.upsert({
        where: { organizationId_periodStart: { organizationId, periodStart: start } },
        create: { organizationId, periodStart: start, periodEnd: end, verifications: 1 },
        update: { verifications: { increment: 1 } },
      });
    } catch {
      // Verification counting is informational; never block a public page on it.
    }
  }
}
