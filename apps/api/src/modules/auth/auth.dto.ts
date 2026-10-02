import { z } from 'zod';

/**
 * Password policy.
 *
 * Length floor and a breach-style deny-list of the obvious candidates, and
 * nothing else. Composition rules ("one uppercase, one symbol") measurably
 * push people toward `Password1!` — NIST dropped them for that reason, and a
 * 12-character minimum with no character classes is both stronger in practice
 * and less hostile.
 */
const COMMON_PASSWORDS = new Set([
  'password1234',
  'passwordpassword',
  '123456789012',
  'qwertyuiop12',
  'letmein12345',
  'administrator',
  'opencred1234',
]);

export const passwordSchema = z
  .string()
  .min(12, 'passwords must be at least 12 characters')
  .max(256)
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), {
    message: 'that password appears on well-known breach lists; choose another',
  });

export const registerSchema = z.object({
  organizationName: z.string().min(2).max(120),
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  password: passwordSchema,
  /** Only meaningful on Cloud; self-hosted installs always start on community. */
  plan: z.enum(['free', 'growth', 'scale']).default('free'),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
  /** Optional when the user belongs to exactly one organisation. */
  organizationId: z.string().uuid().optional(),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).max(500).optional(),
  organizationId: z.string().uuid().optional(),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().email().max(320),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(500),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(10).max(500),
});

export const magicLinkRequestSchema = z.object({
  email: z.string().email().max(320),
});

export const magicLinkConsumeSchema = z.object({
  token: z.string().min(10).max(500),
});

export const switchOrgSchema = z.object({
  organizationId: z.string().uuid(),
});
