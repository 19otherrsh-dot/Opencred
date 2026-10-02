import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

/**
 * Validate a request body/query against a Zod schema.
 *
 * Zod rather than class-validator decorators, so the *same* schemas that
 * define the public API shape are the ones published in the OpenAPI document
 * and reused by the n8n node and the SDK. One definition, three consumers.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({
          error: 'validation_failed',
          message: 'The request body failed validation.',
          // Field-level detail: an integrator debugging a 400 against our API
          // should not have to guess which of twenty fields was wrong.
          details: err.issues.map((issue) => ({
            path: issue.path.join('.'),
            code: issue.code,
            message: issue.message,
          })),
        });
      }
      throw err;
    }
  }
}

export const zodPipe = <T>(schema: ZodSchema<T>) => new ZodValidationPipe(schema);
