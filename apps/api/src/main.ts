import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/exception.filter';
import { loadConfig } from './config';
import { QueueService } from './modules/queue/queue.service';
import { StorageService } from './modules/storage/storage.service';
import type { AuthenticatedRequest } from './common/request-context';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger('bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: true,
    logger: config.isProduction
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // Trust the proxy's forwarded headers; without this every client IP looks
  // like the load balancer and per-IP rate limiting stops working.
  app.set('trust proxy', 1);
  app.use(cookieParser());

  // Request ids thread through logs and error bodies, so a customer can quote
  // one and an operator can find the exact request.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string) || randomUUID();
    (req as AuthenticatedRequest).requestId = id;
    res.setHeader('x-request-id', id);
    next();
  });

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    res.setHeader('x-frame-options', 'DENY');
    if (config.isProduction) {
      res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  /**
   * CORS.
   *
   * The dashboard origin is allowed with credentials. Public verification
   * endpoints are deliberately open to any origin — the entire point is that a
   * third party's tooling can call them — but they carry no cookies, so a
   * wildcard there grants nothing beyond what a plain fetch already has.
   */
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      const allowed = [config.PUBLIC_URL, config.API_URL];
      callback(null, allowed.includes(origin.replace(/\/+$/, '')) || !config.isProduction);
    },
    credentials: true,
    exposedHeaders: ['x-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'],
  });

  // No global ValidationPipe: every endpoint validates with an explicit Zod
  // schema (see `zodPipe`), which is the same schema published in the OpenAPI
  // document and reused by the n8n node. Adding class-validator alongside it
  // would mean two competing definitions of the same request shape.
  app.useGlobalFilters(new AllExceptionsFilter());

  // --- OpenAPI (FR-INT-01) --------------------------------------------------
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('OpenCred API')
      .setDescription(
        'The open-source, standards-native credentialing API.\n\n' +
          '**Authentication.** Send an API key as `Authorization: Bearer ock_…` or `X-API-Key`. ' +
          'Dashboard sessions use short-lived JWTs from `/v1/auth/login`.\n\n' +
          '**Public endpoints.** Everything under `/v1/public` is unauthenticated on purpose: ' +
          'verification must work for people who have no relationship with the issuer.\n\n' +
          '**Idempotency.** Pass `idempotencyKey` when issuing from an event handler that may retry.\n\n' +
          'This document is generated from the running server, so it cannot drift from the implementation.',
      )
      .setVersion('1.0.0')
      .setLicense('AGPL-3.0-or-later', 'https://www.gnu.org/licenses/agpl-3.0.html')
      .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'API key or session JWT' })
      .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
      .addServer(config.API_URL)
      .build(),
  );

  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'OpenCred API',
    swaggerOptions: { persistAuthorization: true, tryItOutEnabled: true },
    jsonDocumentUrl: 'docs/openapi.json',
  });

  // --- Start-up housekeeping ------------------------------------------------
  const queue = app.get(QueueService);
  const storage = app.get(StorageService);

  await storage.ensureBucket().catch((err) => {
    logger.warn(`object storage check failed: ${err.message}`);
  });
  await queue.registerRepeatables().catch((err) => {
    logger.warn(`could not register maintenance schedules: ${err.message}`);
  });

  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');

  logger.log(`OpenCred API (${config.edition} edition) listening on :${config.PORT}`);
  logger.log(`API docs:        ${config.API_URL}/docs`);
  logger.log(`OpenAPI JSON:    ${config.API_URL}/docs/openapi.json`);
  logger.log(`Public origin:   ${config.PUBLIC_URL}`);

  if (config.isSelfHosted) {
    logger.log(
      'Self-hosted: metering and billing are disabled, and this instance makes no outbound calls ' +
        'other than the SMTP host you configured.',
    );
  }
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('OpenCred failed to start:\n', err instanceof Error ? err.message : err);
  process.exit(1);
});
