import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { loadConfig } from '../../config';

/**
 * Object storage for rendered credentials and brand assets.
 *
 * Two drivers: the local filesystem and anything S3-compatible (MinIO on a
 * self-hosted box, S3 on Cloud). The local driver is the default and is a
 * first-class option, not a stub — a university evaluating self-hosting should
 * not have to stand up an object store to run a pilot.
 *
 * The S3 driver speaks SigV4 directly rather than pulling in the AWS SDK. That
 * is a deliberate trade: the SDK is ~15 MB of transitive dependencies for four
 * HTTP verbs, and on a project whose pitch is "audit our code" a hand-rolled
 * 80-line signer that a reviewer can actually read is worth more than the
 * convenience.
 */

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly config = loadConfig();
  private readonly root: string;

  constructor() {
    this.root = resolve(process.cwd(), this.config.STORAGE_LOCAL_PATH);
  }

  get driver(): 'local' | 's3' {
    return this.config.STORAGE_DRIVER;
  }

  async put(
    key: string,
    body: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<StoredObject> {
    if (this.driver === 's3') {
      await this.s3Request('PUT', key, body, contentType);
    } else {
      const path = this.localPath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    }
    return { key, size: body.length, contentType };
  }

  async get(key: string): Promise<Buffer> {
    if (this.driver === 's3') {
      const response = await this.s3Request('GET', key);
      if (response.status === 404) throw new NotFoundException(`object "${key}" not found`);
      return Buffer.from(await response.arrayBuffer());
    }
    try {
      return await readFile(this.localPath(key));
    } catch {
      throw new NotFoundException(`object "${key}" not found`);
    }
  }

  async delete(key: string): Promise<void> {
    if (this.driver === 's3') {
      await this.s3Request('DELETE', key);
      return;
    }
    await rm(this.localPath(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      if (this.driver === 's3') {
        const response = await this.s3Request('HEAD', key);
        return response.ok;
      }
      await readFile(this.localPath(key));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Keys are built from ids we generate, but they also flow in from asset
   * uploads. Normalising and re-checking containment keeps a crafted key from
   * writing outside the storage root.
   */
  private localPath(key: string): string {
    const safe = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const path = join(this.root, safe);
    if (!path.startsWith(this.root + sep) && path !== this.root) {
      throw new Error(`storage key "${key}" escapes the storage root`);
    }
    return path;
  }

  // --- S3-compatible driver (AWS Signature Version 4) -----------------------

  private async s3Request(
    method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
    key: string,
    body?: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const endpoint = new URL(this.config.S3_ENDPOINT);
    const bucket = this.config.S3_BUCKET;
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');

    // Path-style addressing by default: MinIO and most S3-compatible stores do
    // not have wildcard TLS certificates for virtual-host style.
    const path = this.config.S3_FORCE_PATH_STYLE
      ? `/${bucket}/${encodedKey}`
      : `/${encodedKey}`;
    const host = this.config.S3_FORCE_PATH_STYLE
      ? endpoint.host
      : `${bucket}.${endpoint.host}`;

    const payloadHash = createHash('sha256')
      .update(body ?? Buffer.alloc(0))
      .digest('hex');
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const region = this.config.S3_REGION;

    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType) headers['content-type'] = contentType;

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('');
    const signedHeaders = signedHeaderNames.join(';');

    const canonicalRequest = [
      method,
      path,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const hmac = (key: Buffer | string, data: string) =>
      createHmac('sha256', key).update(data, 'utf8').digest();

    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.config.S3_SECRET_ACCESS_KEY}`, dateStamp), region), 's3'),
      'aws4_request',
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    headers.authorization =
      `AWS4-HMAC-SHA256 Credential=${this.config.S3_ACCESS_KEY_ID}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(`${endpoint.protocol}//${host}${path}`, {
      method,
      headers,
      ...(body ? { body: new Uint8Array(body) } : {}),
    });

    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => '');
      throw new Error(`S3 ${method} ${key} failed with ${response.status}: ${detail.slice(0, 400)}`);
    }

    return response;
  }

  /** Ensures the configured bucket exists; called once at worker start-up. */
  async ensureBucket(): Promise<void> {
    if (this.driver !== 's3') {
      await mkdir(this.root, { recursive: true });
      return;
    }
    try {
      const endpoint = new URL(this.config.S3_ENDPOINT);
      const host = this.config.S3_FORCE_PATH_STYLE
        ? endpoint.host
        : `${this.config.S3_BUCKET}.${endpoint.host}`;
      const probe = await fetch(
        `${endpoint.protocol}//${host}/${this.config.S3_FORCE_PATH_STYLE ? this.config.S3_BUCKET : ''}`,
        { method: 'HEAD' },
      );
      if (probe.status === 404) {
        this.logger.warn(
          `bucket "${this.config.S3_BUCKET}" does not exist — create it before issuing credentials`,
        );
      }
    } catch (err) {
      this.logger.warn(`could not probe object storage: ${(err as Error).message}`);
    }
  }

  // --- Key naming -----------------------------------------------------------

  credentialKey(organizationId: string, credentialId: string, format: string): string {
    // Sharded by organisation, then by the first two characters of the id, so
    // a filesystem-backed install does not end up with a million entries in a
    // single directory.
    return `orgs/${organizationId}/credentials/${credentialId.slice(0, 2)}/${credentialId}.${format}`;
  }

  assetKey(organizationId: string, assetId: string, extension: string): string {
    return `orgs/${organizationId}/assets/${assetId}.${extension}`;
  }

  batchSourceKey(organizationId: string, batchId: string): string {
    return `orgs/${organizationId}/batches/${batchId}/source.csv`;
  }

  exportKey(organizationId: string, exportId: string, extension: string): string {
    return `orgs/${organizationId}/exports/${exportId}.${extension}`;
  }
}
