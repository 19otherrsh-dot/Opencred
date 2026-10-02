import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getTemplate, listTemplates } from '@opencred/templates';
import { defaultBranding } from '@opencred/schema';
import { AppModule } from './app.module';
import { PrismaService } from './common/prisma.service';
import { CryptoService } from './common/crypto.service';
import { IssuerService } from './modules/issuer/issuer.service';
import { IssuanceService } from './modules/credentials/issuance.service';
import { loadConfig } from './config';

/**
 * Development seed.
 *
 * Creates a demo workspace with real templates, real recipients and real signed
 * credentials, so that a contributor's first `npm run dev` shows a populated
 * product rather than an empty state. Idempotent: running it twice does not
 * duplicate anything.
 */
async function seed(): Promise<void> {
  const logger = new Logger('seed');
  const config = loadConfig();

  if (config.isProduction) {
    throw new Error('refusing to seed a production database');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const prisma = app.get(PrismaService);
  const crypto = app.get(CryptoService);
  const issuer = app.get(IssuerService);
  const issuance = app.get(IssuanceService);

  const email = 'demo@opencred.local';
  const password = 'opencred-demo-password';

  let org = await prisma.organization.findUnique({ where: { slug: 'demo-institute' } });

  if (!org) {
    const branding = defaultBranding();
    branding.brandKit.palette.primary = '#1d4ed8';
    branding.email.subjectTemplate = 'Your credential from {{issuer.name}}';

    org = await prisma.organization.create({
      data: {
        slug: 'demo-institute',
        name: 'Demo Institute of Technology',
        description: 'A sample issuing organisation created by the OpenCred seed script.',
        website: 'https://demo.opencred.local',
        contactEmail: email,
        plan: config.isSelfHosted ? 'community' : 'growth',
        branding: branding as never,
      },
    });
    logger.log(`created organisation ${org.slug}`);
  }

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: 'Demo Owner',
        passwordHash: await crypto.hashPassword(password),
        emailVerifiedAt: new Date(),
      },
    });
  }

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    create: { userId: user.id, organizationId: org.id, role: 'owner', acceptedAt: new Date() },
    update: {},
  });

  const periodEnd = new Date();
  periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    create: { organizationId: org.id, plan: org.plan, currentPeriodEnd: periodEnd },
    update: {},
  });

  await issuer.ensureKey(org.id);

  // A spread of layouts and orientations, so the template list is worth looking
  // at rather than three variations on one design.
  const seedTemplates = [
    'modern-minimal-cobalt',
    'classic-ornate-oxford',
    'tech-grid-midnight',
    'portrait-formal-crimson',
    'badge-hexagon-violet',
  ];

  const templateIds: string[] = [];
  for (const slug of seedTemplates) {
    const existing = await prisma.template.findFirst({
      where: { organizationId: org.id, librarySlug: slug },
    });
    if (existing) {
      templateIds.push(existing.id);
      continue;
    }
    const entry = getTemplate(slug);
    const created = await prisma.template.create({
      data: {
        organizationId: org.id,
        name: entry.name,
        description: `Seeded from the starter library (${entry.license}).`,
        kind: entry.kind,
        document: entry.document as never,
        librarySlug: entry.slug,
        createdById: user.id,
      },
    });
    templateIds.push(created.id);
  }

  const existingCredentials = await prisma.credential.count({ where: { organizationId: org.id } });
  if (existingCredentials === 0) {
    const cohort = [
      { name: 'Priya Raman', email: 'priya.raman@example.com', course: 'Advanced Data Engineering', grade: 'Distinction' },
      { name: 'Tomás Herrera', email: 'tomas.herrera@example.com', course: 'Advanced Data Engineering', grade: 'Merit' },
      { name: 'Aisha Bello', email: 'aisha.bello@example.com', course: 'Cloud Security Fundamentals', grade: 'Distinction' },
      { name: 'Wei Chen', email: 'wei.chen@example.com', course: 'Cloud Security Fundamentals', grade: 'Pass' },
      { name: 'Fatima Al-Rashid', email: 'fatima.alrashid@example.com', course: 'Machine Learning Operations', grade: 'Distinction' },
      { name: 'Jonas Lindqvist', email: 'jonas.lindqvist@example.com', course: 'Machine Learning Operations', grade: 'Merit' },
    ];

    for (const [index, person] of cohort.entries()) {
      await issuance.issueOne(
        org.id,
        {
          templateId: templateIds[index % 3],
          recipient: { name: person.name, email: person.email, externalId: `STU-${1000 + index}` },
          title: person.course,
          data: {
            course: person.course,
            grade: person.grade,
            hours: '120',
            signatory_name: 'Dr. Amara Okafor',
            signatory_title: 'Programme Director',
          },
          // The seed must not try to send six emails to example.com.
          suppressEmail: true,
          idempotencyKey: `seed-${person.email}`,
        } as never,
        undefined,
      );
    }
    logger.log(`queued ${cohort.length} demo credentials`);
    logger.log(
      'Run the worker (`npm run dev:worker`) to sign, render and complete them.',
    );
  }

  logger.log('');
  logger.log('  Seed complete.');
  logger.log(`  Workspace:  ${org.name} (${org.slug})`);
  logger.log(`  Sign in:    ${email} / ${password}`);
  logger.log(`  Templates:  ${templateIds.length} seeded, ${listTemplates().length} in the library`);
  logger.log(`  Issuer DID: ${issuer.didFor(org)}`);
  logger.log('');

  await app.close();
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed failed:', err);
    process.exit(1);
  });
