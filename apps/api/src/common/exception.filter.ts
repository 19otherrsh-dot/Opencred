import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './request-context';

/**
 * One error shape for the whole API.
 *
 * Integrators build retry logic against error codes, so every failure returns
 * `{ error, message, requestId }` with a stable machine-readable `error` slug.
 * Internal details — stack traces, SQL, constraint names — are logged but never
 * returned: a 500 that leaks a query is both a support problem and a
 * reconnaissance gift.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AuthenticatedRequest>();
    const requestId = request.requestId ?? '-';

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      const payload: Record<string, unknown> =
        typeof body === 'object' && body !== null
          ? { ...(body as Record<string, unknown>) }
          : { message: String(body) };

      // Nest's built-in exceptions carry `statusCode`/`error` in a shape that
      // differs from ours; normalise so integrators see one contract.
      if (!payload.error) payload.error = slugFor(status);
      delete payload.statusCode;

      if (status >= 500) {
        this.logger.error(
          `${request.method} ${request.url} -> ${status} [${requestId}]`,
          exception.stack,
        );
      }

      response.status(status).json({ ...payload, requestId });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = mapPrismaError(exception);
      if (mapped.status < 500) {
        response.status(mapped.status).json({ ...mapped.body, requestId });
        return;
      }
    }

    this.logger.error(
      `${request.method} ${request.url} -> 500 [${requestId}]: ${(exception as Error)?.message}`,
      (exception as Error)?.stack,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: 'internal_error',
      message: 'Something went wrong on our side. Quote the request id if you contact support.',
      requestId,
    });
  }
}

function slugFor(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'internal_error' : 'request_failed';
  }
}

function mapPrismaError(err: Prisma.PrismaClientKnownRequestError): {
  status: number;
  body: Record<string, unknown>;
} {
  switch (err.code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        body: {
          error: 'already_exists',
          message: 'A record with those unique values already exists.',
          fields: (err.meta?.target as string[]) ?? [],
        },
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        body: { error: 'not_found', message: 'The requested record does not exist.' },
      };
    case 'P2003':
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: 'invalid_reference',
          message: 'That request references a record that does not exist.',
        },
      };
    default:
      return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: {} };
  }
}
