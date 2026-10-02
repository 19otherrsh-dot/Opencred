import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import * as argon2 from 'argon2';
import { loadConfig } from '../config';

/**
 * Symmetric crypto for data at rest, plus password hashing.
 *
 * Three distinct jobs, deliberately kept apart:
 *
 *  - `encrypt`/`decrypt` protect secrets we must be able to read back: issuer
 *    private keys and per-org SMTP passwords. AES-256-GCM, random IV per
 *    message, authentication tag verified on read.
 *  - `hashToken` is a fast one-way digest for high-entropy secrets (API keys,
 *    refresh tokens). A slow KDF buys nothing against a 256-bit random token
 *    and would put Argon2 on every authenticated request.
 *  - `hashPassword` is Argon2id, because user-chosen passwords are the only
 *    thing here with guessable entropy.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    const config = loadConfig();
    // A fixed salt is acceptable here: the input is a single high-entropy
    // deployment secret, not a per-user password, and a rotating salt would
    // make every previously encrypted value unreadable.
    this.key = scryptSync(config.ENCRYPTION_KEY, 'opencred.encryption.v1', 32);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // v1 prefix so a future algorithm change can be detected on read rather
    // than producing garbage.
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  decrypt(payload: string): string {
    const [version, ivPart, tagPart, dataPart] = payload.split('.');
    if (version !== 'v1' || !ivPart || !tagPart || !dataPart) {
      throw new Error('malformed ciphertext');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      // OWASP's current second-choice profile: 19 MiB, 2 passes, 1 lane.
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** HMAC-SHA256 signature for outbound webhooks (FR-INT-02). */
  webhookSignature(secret: string, timestamp: string, body: string): string {
    return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  }

  /** Constant-time comparison for anything an attacker can submit repeatedly. */
  safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  sha256(input: string | Buffer): string {
    return createHash('sha256').update(input).digest('hex');
  }
}
