import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { PrismaService } from './common/prisma.service';
import { CryptoService } from './common/crypto.service';
import { AuditService } from './common/audit.service';

import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { TokenService } from './modules/auth/token.service';
import { AuthGuard } from './modules/auth/auth.guard';
import { OAuthController } from './modules/auth/oauth.controller';
import { OAuthService } from './modules/auth/oauth.service';

import { IssuerService } from './modules/issuer/issuer.service';
import { MailService } from './modules/mail/mail.service';
import { DeliveryService } from './modules/mail/delivery.service';
import { StorageService } from './modules/storage/storage.service';
import { RenderService } from './modules/render/render.service';
import { QueueService } from './modules/queue/queue.service';

import { OrgController } from './modules/org/org.controller';
import { OrgService } from './modules/org/org.service';

import { TemplatesController } from './modules/templates/templates.controller';
import { TemplatesService } from './modules/templates/templates.service';

import { RecipientsController } from './modules/recipients/recipients.controller';
import { RecipientsService } from './modules/recipients/recipients.service';

import { CredentialsController, WalletController } from './modules/credentials/credentials.controller';
import { CredentialsService } from './modules/credentials/credentials.service';
import { IssuanceService } from './modules/credentials/issuance.service';

import { BatchesController } from './modules/batches/batches.controller';
import { BatchesService } from './modules/batches/batches.service';

import { PublicController } from './modules/verification/public.controller';
import { VerificationService } from './modules/verification/verification.service';
import { PassesService } from './modules/passes/passes.service';

import { WebhooksController } from './modules/webhooks/webhooks.controller';
import { WebhooksService } from './modules/webhooks/webhooks.service';

import { AnalyticsController } from './modules/analytics/analytics.controller';
import { AnalyticsService } from './modules/analytics/analytics.service';
import { EventsService } from './modules/analytics/events.service';

import { BillingController } from './modules/billing/billing.controller';
import { UsageService } from './modules/billing/usage.service';

import { GdprController } from './modules/gdpr/gdpr.controller';
import { GdprService } from './modules/gdpr/gdpr.service';

import { HealthController } from './modules/health/health.controller';
import { RateLimitGuard } from './common/rate-limit.guard';

/**
 * One module.
 *
 * Nest's feature-module convention buys isolation between teams working on
 * unrelated slices of a large application. This is one cohesive product where
 * nearly everything depends on issuance, and splitting it into fifteen modules
 * that all import each other would produce circular-dependency workarounds
 * rather than clarity. When a boundary genuinely earns its own module — the
 * Enterprise module, most obviously — it gets one.
 */
@Module({
  controllers: [
    HealthController,
    AuthController,
    OAuthController,
    OrgController,
    TemplatesController,
    RecipientsController,
    CredentialsController,
    WalletController,
    BatchesController,
    PublicController,
    WebhooksController,
    AnalyticsController,
    BillingController,
    GdprController,
  ],
  providers: [
    PrismaService,
    CryptoService,
    AuditService,
    TokenService,
    AuthService,
    OAuthService,
    IssuerService,
    MailService,
    DeliveryService,
    StorageService,
    RenderService,
    QueueService,
    OrgService,
    TemplatesService,
    RecipientsService,
    CredentialsService,
    IssuanceService,
    BatchesService,
    VerificationService,
    PassesService,
    WebhooksService,
    AnalyticsService,
    EventsService,
    UsageService,
    GdprService,
    // Order matters: authentication resolves the principal, and the rate
    // limiter buckets by that principal's plan.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [
    PrismaService,
    QueueService,
    IssuanceService,
    BatchesService,
    WebhooksService,
    MailService,
    DeliveryService,
    RenderService,
    StorageService,
    TokenService,
    EventsService,
  ],
})
export class AppModule {}
