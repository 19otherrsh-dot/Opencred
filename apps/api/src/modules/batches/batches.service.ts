import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import {
  optionalDataFields,
  requiredDataFields,
  SYSTEM_MERGE_FIELDS,
  type TemplateDocument,
} from '@opencred/schema';
import { PrismaService } from '../../common/prisma.service';
import { publicId } from '../../common/ids';
import { RenderService } from '../render/render.service';
import { QueueService } from '../queue/queue.service';
import { UsageService } from '../billing/usage.service';
import { StorageService } from '../storage/storage.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { IssuanceService } from '../credentials/issuance.service';
import type { AuthPrincipal } from '../../common/request-context';

/**
 * FR-REC-01 / FR-ISS-01 — bulk issuance.
 *
 * The flow is upload → map → validate → confirm, and the validation step is
 * the point of the whole design. Every competitor lets you upload a CSV; the
 * failure mode that generates support tickets is discovering after issuance
 * that 40 rows had a malformed email or a missing course name. Nothing is
 * issued here until the whole file has been checked and the issuer has seen
 * exactly what will happen.
 */

export interface ParsedRow {
  index: number;
  values: Record<string, string>;
}

export interface RowIssue {
  row: number;
  field: string;
  code: 'missing' | 'invalid_email' | 'duplicate_in_file' | 'invalid_date' | 'too_long';
  message: string;
}

export interface ValidationReport {
  totalRows: number;
  validRows: number;
  issues: RowIssue[];
  duplicatesInFile: number;
  existingRecipients: number;
  sample: Array<Record<string, string>>;
}

const MAX_ROWS = 100_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

@Injectable()
export class BatchesService {
  private readonly logger = new Logger(BatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly render: RenderService,
    private readonly queue: QueueService,
    private readonly usage: UsageService,
    private readonly storage: StorageService,
    private readonly webhooks: WebhooksService,
    private readonly issuance: IssuanceService,
  ) {}

  /**
   * Parse an uploaded CSV and propose a column mapping.
   *
   * The suggestion matters more than it sounds: a registrar's export has
   * columns called "Student Name" and "E-mail Address", and making them map
   * themselves is most of the difference between a two-minute task and a
   * ten-minute one.
   */
  async upload(params: {
    organizationId: string;
    templateId: string;
    name: string;
    file: Buffer;
    filename: string;
    principal: AuthPrincipal;
  }): Promise<{
    batchId: string;
    headers: string[];
    suggestedMapping: Record<string, string>;
    requiredFields: string[];
    optionalFields: string[];
    sample: Array<Record<string, string>>;
    totalRows: number;
  }> {
    const template = await this.prisma.template.findFirst({
      where: { id: params.templateId, organizationId: params.organizationId, archivedAt: null },
    });
    if (!template) throw new NotFoundException('template not found');

    const rows = this.parseCsv(params.file);
    if (rows.length === 0) throw new BadRequestException('the file contains no data rows');
    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(`files are limited to ${MAX_ROWS.toLocaleString()} rows`);
    }

    const headers = Object.keys(rows[0]);
    const document = this.render.parseDocument(template.document);
    const required = this.targetFields(document);
    const optional = this.optionalFields(document);

    const batch = await this.prisma.batch.create({
      data: {
        organizationId: params.organizationId,
        name: params.name || `Import ${new Date().toISOString().slice(0, 10)}`,
        templateId: template.id,
        status: 'draft',
        totalCount: rows.length,
        rows: rows as never,
        columnMapping: this.suggestMapping(headers, [...required, ...optional]) as never,
        createdById: params.principal.type === 'user' ? params.principal.id : null,
      },
    });

    // Keep the original upload: when an issuer disputes what was issued, the
    // source file is the only thing that settles it.
    await this.storage
      .put(
        this.storage.batchSourceKey(params.organizationId, batch.id),
        params.file,
        'text/csv',
      )
      .catch((err) => this.logger.warn(`source CSV not archived: ${err.message}`));

    return {
      batchId: batch.id,
      headers,
      suggestedMapping: this.suggestMapping(headers, [...required, ...optional]),
      requiredFields: required,
      optionalFields: optional,
      sample: rows.slice(0, 5),
      totalRows: rows.length,
    };
  }

  private parseCsv(file: Buffer): Array<Record<string, string>> {
    try {
      return parse(file, {
        columns: (header: string[]) => header.map((h) => h.trim()),
        skip_empty_lines: true,
        trim: true,
        // Spreadsheet exports routinely carry a UTF-8 BOM, which otherwise ends
        // up glued to the first column name and breaks every mapping.
        bom: true,
        relax_column_count: true,
      }) as Array<Record<string, string>>;
    } catch (err) {
      throw new BadRequestException(`could not parse the CSV: ${(err as Error).message}`);
    }
  }

  /** Fields a row must supply: recipient identity plus the template's own. */
  private targetFields(document: TemplateDocument): string[] {
    const system = new Set<string>(SYSTEM_MERGE_FIELDS);
    return [
      'recipient.name',
      'recipient.email',
      ...requiredDataFields(document).filter((f) => !system.has(f)),
    ];
  }

  /**
   * Fields a row *may* supply.
   *
   * Offered in the mapping UI alongside the required ones. A template that
   * shows a grade only when there is one still needs the grade column to be
   * mappable, or the feature is unreachable.
   */
  private optionalFields(document: TemplateDocument): string[] {
    return ['recipient.external_id', ...optionalDataFields(document)];
  }

  private suggestMapping(headers: string[], targets: string[]): Record<string, string> {
    const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const byNormalised = new Map(headers.map((h) => [normalise(h), h]));

    const aliases: Record<string, string[]> = {
      'recipient.name': ['name', 'fullname', 'recipientname', 'studentname', 'learnername', 'attendee'],
      'recipient.email': ['email', 'emailaddress', 'recipientemail', 'mail', 'studentemail'],
      'recipient.external_id': ['id', 'studentid', 'externalid', 'employeeid', 'rollnumber', 'sourcedid'],
      course: ['course', 'coursename', 'programme', 'program', 'training', 'workshop', 'subject'],
      grade: ['grade', 'result', 'score', 'marks', 'classification'],
      hours: ['hours', 'credithours', 'duration', 'ceus', 'credits'],
    };

    const mapping: Record<string, string> = {};
    for (const target of targets) {
      const direct = byNormalised.get(normalise(target));
      if (direct) {
        mapping[target] = direct;
        continue;
      }
      for (const alias of aliases[target] ?? [normalise(target)]) {
        const match = byNormalised.get(alias);
        if (match) {
          mapping[target] = match;
          break;
        }
      }
    }
    return mapping;
  }

  /**
   * Validate every row against the mapping before anything is issued.
   *
   * Reports issues rather than throwing on the first one: an issuer needs the
   * whole list to fix their spreadsheet in one pass, not one error at a time.
   */
  async validate(
    organizationId: string,
    batchId: string,
    mapping: Record<string, string>,
    defaults: Record<string, string> = {},
  ): Promise<ValidationReport> {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, organizationId },
      include: { template: true },
    });
    if (!batch) throw new NotFoundException('batch not found');

    const rows = batch.rows as Array<Record<string, string>>;
    const document = this.render.parseDocument(batch.template.document);
    const required = this.targetFields(document);

    const issues: RowIssue[] = [];
    const seenEmails = new Map<string, number>();
    let duplicatesInFile = 0;

    rows.forEach((row, i) => {
      const rowNumber = i + 2; // +1 for zero-index, +1 for the header line

      for (const field of required) {
        const column = mapping[field];
        const raw = (column ? row[column] : undefined) ?? defaults[field] ?? '';
        const value = String(raw).trim();

        if (!value) {
          issues.push({
            row: rowNumber,
            field,
            code: 'missing',
            message: `"${field}" is empty${column ? ` (column "${column}")` : ' and no default is set'}`,
          });
          continue;
        }

        if (field === 'recipient.email') {
          const email = value.toLowerCase();
          if (!EMAIL_RE.test(email)) {
            issues.push({
              row: rowNumber,
              field,
              code: 'invalid_email',
              message: `"${value}" is not a valid email address`,
            });
          } else {
            const firstSeen = seenEmails.get(email);
            if (firstSeen !== undefined) {
              duplicatesInFile += 1;
              issues.push({
                row: rowNumber,
                field,
                code: 'duplicate_in_file',
                message: `"${email}" also appears on row ${firstSeen}`,
              });
            } else {
              seenEmails.set(email, rowNumber);
            }
          }
        }

        if (value.length > 500) {
          issues.push({
            row: rowNumber,
            field,
            code: 'too_long',
            message: `"${field}" exceeds 500 characters and would not fit the template`,
          });
        }
      }
    });

    const emails = [...seenEmails.keys()];
    const existingRecipients =
      emails.length === 0
        ? 0
        : await this.prisma.recipient.count({
            where: { organizationId, email: { in: emails } },
          });

    const blockingRows = new Set(
      issues.filter((i) => i.code !== 'duplicate_in_file').map((i) => i.row),
    );

    const report: ValidationReport = {
      totalRows: rows.length,
      validRows: rows.length - blockingRows.size,
      issues: issues.slice(0, 500),
      duplicatesInFile,
      existingRecipients,
      sample: rows.slice(0, 5),
    };

    await this.prisma.batch.update({
      where: { id: batch.id },
      data: {
        columnMapping: mapping as never,
        defaults: defaults as never,
        validation: report as never,
        status: report.validRows > 0 ? 'ready' : 'draft',
      },
    });

    return report;
  }

  /**
   * Confirm and issue.
   *
   * Credentials are created in chunked transactions and then enqueued in bulk.
   * The API call returns as soon as the rows exist; rendering and delivery
   * happen in workers, which is what keeps a 10,000-row confirmation under a
   * few seconds of wall clock.
   */
  async issue(params: {
    organizationId: string;
    batchId: string;
    principal: AuthPrincipal;
    skipInvalidRows?: boolean;
    suppressEmail?: boolean;
    scheduledAt?: Date | null;
    expiresAt?: Date | null;
  }): Promise<{ batchId: string; queued: number; skipped: number; scheduledAt: string | null }> {
    const batch = await this.prisma.batch.findFirst({
      where: { id: params.batchId, organizationId: params.organizationId },
      include: { template: true },
    });
    if (!batch) throw new NotFoundException('batch not found');
    if (['processing', 'completed'].includes(batch.status)) {
      throw new BadRequestException(`batch is already ${batch.status}`);
    }

    const rows = batch.rows as Array<Record<string, string>>;
    const mapping = batch.columnMapping as Record<string, string>;
    const defaults = batch.defaults as Record<string, string>;
    const document = this.render.parseDocument(batch.template.document);
    const required = this.targetFields(document);
    const requiredData = required.filter((f) => !f.startsWith('recipient.'));
    // Optional columns are carried through when mapped and simply come out
    // empty when they are not; the template's `showIf` guards handle the rest.
    const dataFields = [
      ...requiredData,
      ...this.optionalFields(document).filter((f) => !f.startsWith('recipient.')),
    ];

    const prepared: Array<{
      name: string;
      email: string;
      externalId?: string;
      data: Record<string, string>;
    }> = [];
    let skipped = 0;
    const seen = new Set<string>();

    for (const row of rows) {
      const read = (field: string) =>
        String((mapping[field] ? row[mapping[field]] : undefined) ?? defaults[field] ?? '').trim();

      const name = read('recipient.name');
      const email = read('recipient.email').toLowerCase();

      const invalid = !name || !EMAIL_RE.test(email) || requiredData.some((f) => !read(f));
      if (invalid || seen.has(email)) {
        if (!params.skipInvalidRows && invalid) {
          throw new BadRequestException({
            error: 'invalid_rows',
            message:
              'The batch still contains invalid rows. Fix them, or re-submit with skipInvalidRows.',
          });
        }
        skipped += 1;
        continue;
      }
      seen.add(email);

      prepared.push({
        name,
        email,
        externalId: read('recipient.external_id') || undefined,
        data: Object.fromEntries(dataFields.map((f) => [f, read(f)])),
      });
    }

    if (prepared.length === 0) throw new BadRequestException('no issuable rows remain');

    await this.usage.assertCanIssue(params.organizationId, prepared.length);

    await this.prisma.batch.update({
      where: { id: batch.id },
      data: {
        status: params.scheduledAt ? 'queued' : 'processing',
        totalCount: prepared.length,
        processedCount: 0,
        failedCount: 0,
        scheduledAt: params.scheduledAt ?? null,
        startedAt: params.scheduledAt ? null : new Date(),
        options: {
          suppressEmail: Boolean(params.suppressEmail),
          expiresAt: params.expiresAt?.toISOString() ?? null,
        } as never,
      },
    });

    // FR-ISS-03 — a scheduled batch is materialised now (so the issuer can see
    // exactly what will go out) but not enqueued until its moment arrives.
    const createdIds = await this.materialise({
      organizationId: params.organizationId,
      batch,
      prepared,
      expiresAt: params.expiresAt ?? null,
    });

    if (params.scheduledAt) {
      await this.queue.enqueueBatch(
        { batchId: batch.id, organizationId: params.organizationId },
        params.scheduledAt,
      );
    } else {
      await this.queue.enqueueIssuanceBulk(
        createdIds.map((credentialId) => ({
          credentialId,
          organizationId: params.organizationId,
          suppressEmail: params.suppressEmail,
        })),
      );
    }

    this.logger.log(
      `batch ${batch.id}: ${createdIds.length} credentials materialised, ${skipped} rows skipped`,
    );

    return {
      batchId: batch.id,
      queued: createdIds.length,
      skipped,
      scheduledAt: params.scheduledAt?.toISOString() ?? null,
    };
  }

  /**
   * Create recipient and credential rows.
   *
   * Chunked at 250 so that a large import neither holds one enormous
   * transaction open nor issues 10,000 individual round trips.
   */
  private async materialise(params: {
    organizationId: string;
    batch: { id: string; templateId: string; template: { version: number; kind: string; name: string } };
    prepared: Array<{ name: string; email: string; externalId?: string; data: Record<string, string> }>;
    expiresAt: Date | null;
  }): Promise<string[]> {
    const ids: string[] = [];
    const CHUNK = 250;

    for (let offset = 0; offset < params.prepared.length; offset += CHUNK) {
      const slice = params.prepared.slice(offset, offset + CHUNK);
      const created = await this.prisma.$transaction(async (tx) => {
        const out: string[] = [];
        for (const entry of slice) {
          const recipient = await this.issuance.upsertRecipient(
            params.organizationId,
            { name: entry.name, email: entry.email, externalId: entry.externalId },
            tx,
          );
          const credential = await tx.credential.create({
            data: {
              organizationId: params.organizationId,
              publicId: publicId(),
              batchId: params.batch.id,
              templateId: params.batch.templateId,
              templateVersion: params.batch.template.version,
              recipientId: recipient.id,
              kind: params.batch.template.kind,
              title: params.batch.template.name,
              data: entry.data as never,
              status: 'draft',
              expiresAt: params.expiresAt,
            },
            select: { id: true },
          });
          out.push(credential.id);
        }
        return out;
      });
      ids.push(...created);
    }

    return ids;
  }

  /** Called by the worker when a scheduled batch's moment arrives. */
  async dispatchScheduled(batchId: string): Promise<number> {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch || batch.status !== 'queued') return 0;

    const credentials = await this.prisma.credential.findMany({
      where: { batchId, status: 'draft' },
      select: { id: true },
    });

    const options = batch.options as { suppressEmail?: boolean };
    await this.queue.enqueueIssuanceBulk(
      credentials.map((c) => ({
        credentialId: c.id,
        organizationId: batch.organizationId,
        suppressEmail: options.suppressEmail,
      })),
    );

    await this.prisma.batch.update({
      where: { id: batchId },
      data: { status: 'processing', startedAt: new Date() },
    });

    return credentials.length;
  }

  /** Sweep for scheduled batches whose time has come. Runs every minute. */
  async dispatchDueScheduled(): Promise<number> {
    const due = await this.prisma.batch.findMany({
      where: { status: 'queued', scheduledAt: { not: null, lte: new Date() } },
      select: { id: true },
      take: 100,
    });
    let total = 0;
    for (const batch of due) total += await this.dispatchScheduled(batch.id);
    return total;
  }

  /** Recompute a batch's progress; called after each credential completes. */
  async refreshProgress(batchId: string): Promise<void> {
    const [total, issued, failed] = await Promise.all([
      this.prisma.credential.count({ where: { batchId } }),
      this.prisma.credential.count({ where: { batchId, status: { in: ['issued', 'expired'] } } }),
      this.prisma.credential.count({ where: { batchId, status: 'draft', updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
    ]);

    const complete = issued + failed >= total && total > 0;
    const batch = await this.prisma.batch.update({
      where: { id: batchId },
      data: {
        processedCount: issued,
        failedCount: failed,
        ...(complete ? { status: failed > 0 ? 'completed' : 'completed', completedAt: new Date() } : {}),
      },
    });

    if (complete) {
      await this.webhooks.dispatch(batch.organizationId, 'batch.completed', {
        batchId,
        name: batch.name,
        total,
        issued,
        failed,
      });
    }
  }

  async list(organizationId: string, options: { limit?: number; cursor?: string } = {}) {
    const limit = Math.min(options.limit ?? 25, 100);
    const rows = await this.prisma.batch.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: { template: { select: { id: true, name: true } } },
    });
    const hasMore = rows.length > limit;
    return {
      data: rows.slice(0, limit).map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        template: b.template,
        totalCount: b.totalCount,
        processedCount: b.processedCount,
        failedCount: b.failedCount,
        scheduledAt: b.scheduledAt,
        startedAt: b.startedAt,
        completedAt: b.completedAt,
        createdAt: b.createdAt,
      })),
      nextCursor: hasMore ? rows[limit - 1].id : null,
    };
  }

  async get(organizationId: string, batchId: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, organizationId },
      include: { template: { select: { id: true, name: true, kind: true } } },
    });
    if (!batch) throw new NotFoundException('batch not found');
    return {
      ...batch,
      // The full row payload can be megabytes; the detail view shows a sample.
      rows: (batch.rows as Array<Record<string, string>>).slice(0, 20),
    };
  }
}
