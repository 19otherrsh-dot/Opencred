import { Body, Controller, Get, HttpCode, Post, ForbiddenException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PLANS, SELF_SERVE_PLANS, planFor, planIdSchema } from '@opencred/schema';
import { zodPipe } from '../../common/zod.pipe';
import {
  CurrentPrincipal,
  OrgId,
  Public,
  RequirePermissions,
  type AuthPrincipal,
} from '../../common/request-context';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { loadConfig } from '../../config';
import { UsageService } from './usage.service';

const changePlanSchema = z.object({ plan: planIdSchema });

/**
 * FR-BIL-01 to FR-BIL-03 — self-serve billing.
 *
 * The plan catalogue is a *public* endpoint, including the Enterprise starting
 * price. That is the whole positioning in one route: the most common buyer
 * complaint in the market research was sales-gated pricing, and the answer to
 * it is not a nicer pricing page, it is a pricing API anyone can curl.
 */
@ApiTags('Billing')
@Controller('v1/billing')
export class BillingController {
  private readonly config = loadConfig();

  constructor(
    private readonly usage: UsageService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('plans')
  @Public()
  @ApiOperation({
    summary: 'The full plan catalogue, including Enterprise pricing',
    description: 'Public and unauthenticated. No plan carries a setup fee or requires an annual contract.',
  })
  plans() {
    return {
      currency: 'USD',
      setupFee: 0,
      annualContractRequired: false,
      selfServe: SELF_SERVE_PLANS,
      plans: Object.values(PLANS),
      note:
        'Community Edition is the complete core platform under AGPLv3 with unlimited issuance. ' +
        'Cloud plans exist because someone has to run the servers, not because features are withheld.',
    };
  }

  @Get('subscription')
  @RequirePermissions('org:read')
  async subscription(@OrgId() organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { subscription: true },
    });
    const plan = planFor(org.plan);
    return {
      plan: plan.id,
      planName: plan.name,
      priceCents: plan.priceCents,
      status: org.planStatus,
      features: plan.features,
      currentPeriodStart: org.subscription?.currentPeriodStart ?? null,
      currentPeriodEnd: org.subscription?.currentPeriodEnd ?? null,
      cancelAt: org.subscription?.cancelAt ?? null,
      selfHosted: this.config.isSelfHosted,
      metered: this.usage.meteringEnabled,
    };
  }

  @Get('usage')
  @RequirePermissions('org:read')
  @ApiOperation({ summary: 'Current-period usage against the plan allowance (FR-BIL-02)' })
  async usageNow(@OrgId() organizationId: string) {
    const usage = await this.usage.current(organizationId);
    return {
      plan: usage.plan.id,
      periodStart: usage.periodStart,
      periodEnd: usage.periodEnd,
      credentialsIssued: usage.credentialsIssued,
      included: usage.included,
      remaining: usage.remaining,
      overage: usage.overage,
      overageCostCents: usage.overageCostCents,
      metered: usage.metered,
      ...(usage.metered
        ? {}
        : { note: 'Self-hosted installations are never metered and never limited.' }),
    };
  }

  @Post('subscription')
  @HttpCode(200)
  @RequirePermissions('org:billing')
  @ApiOperation({
    summary: 'Change plan (FR-BIL-01)',
    description:
      'Upgrades and downgrades complete in-app with no sales call. Enterprise is the only plan that ' +
      'needs a conversation, because it involves an SLA and a contract — its starting price is still published.',
  })
  async changePlan(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(zodPipe(changePlanSchema)) dto: { plan: string },
  ) {
    if (this.config.isSelfHosted) {
      throw new ForbiddenException({
        error: 'not_applicable',
        message:
          'This is a self-hosted installation. There is no plan to change — the Community Edition ' +
          'includes the whole core platform.',
      });
    }

    const target = planFor(dto.plan);
    if (!SELF_SERVE_PLANS.includes(target.id)) {
      return {
        selfServe: false,
        plan: target.id,
        startingAtCents: target.startingAtCents ?? null,
        message:
          'Enterprise includes an SLA and a commercial licence, so it is agreed rather than clicked. ' +
          'The starting price is published above; nothing about the plan is hidden.',
        contact: 'sales@opencred.example',
      };
    }

    const previous = (
      await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })
    ).plan;

    const periodEnd = new Date();
    periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);

    await this.prisma.$transaction([
      this.prisma.organization.update({
        where: { id: organizationId },
        data: { plan: target.id, planStatus: 'active' },
      }),
      this.prisma.subscription.upsert({
        where: { organizationId },
        create: {
          organizationId,
          plan: target.id,
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
        },
        update: { plan: target.id, status: 'active', cancelAt: null },
      }),
    ]);

    await this.audit.record({
      organizationId,
      principal,
      action: 'billing.plan_changed',
      metadata: { from: previous, to: target.id },
    });

    return {
      selfServe: true,
      plan: target.id,
      planName: target.name,
      priceCents: target.priceCents,
      setupFeeCents: 0,
      features: target.features,
      // The internal driver is what a self-hosted or trial install uses; a
      // Cloud deployment configured with Stripe returns a checkout URL here.
      checkoutUrl:
        this.config.BILLING_DRIVER === 'stripe' && target.priceCents
          ? `${this.config.PUBLIC_URL}/billing/checkout?plan=${target.id}`
          : null,
    };
  }
}
