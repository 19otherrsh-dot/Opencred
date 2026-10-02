import type {
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The OpenCred trigger node.
 *
 * Registers a webhook endpoint with OpenCred when the workflow activates and
 * removes it when the workflow is deactivated, so an n8n user never has to
 * visit the OpenCred dashboard to wire this up.
 *
 * The signature check is the part worth reading. Webhook payloads arrive over
 * the public internet at a URL that is guessable-ish and long-lived; without
 * verifying the HMAC, anyone who learns the URL can fabricate "credential
 * issued" events into somebody's workflow. The timestamp is inside the signed
 * material, so a captured payload cannot be replayed indefinitely either.
 */
export class OpenCredTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'OpenCred Trigger',
    name: 'openCredTrigger',
    icon: 'file:opencred.svg',
    group: ['trigger'],
    version: 1,
    description: 'Starts a workflow when a credential is issued, verified, revoked or expires',
    defaults: { name: 'OpenCred Trigger' },
    inputs: [],
    outputs: ['main'] as never,
    credentials: [{ name: 'openCredApi', required: true }],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        required: true,
        default: ['credential.issued'],
        description: 'Which events start this workflow. Select none to receive everything.',
        options: [
          { name: 'Credential Issued', value: 'credential.issued' },
          { name: 'Credential Updated', value: 'credential.updated' },
          { name: 'Credential Revoked', value: 'credential.revoked' },
          { name: 'Credential Expired', value: 'credential.expired' },
          { name: 'Credential Verified', value: 'credential.verified' },
          { name: 'Credential Viewed', value: 'credential.viewed' },
          { name: 'Credential Downloaded', value: 'credential.downloaded' },
          { name: 'Batch Completed', value: 'batch.completed' },
          { name: 'Batch Failed', value: 'batch.failed' },
          { name: 'Recipient Created', value: 'recipient.created' },
        ],
      },
      {
        displayName: 'Verify Signature',
        name: 'verifySignature',
        type: 'boolean',
        default: true,
        description:
          'Whether to reject payloads whose HMAC signature does not match. Leave this on unless you are debugging.',
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const stored = this.getWorkflowStaticData('node');
        return typeof stored.webhookId === 'string';
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const credentials = await this.getCredentials('openCredApi');
        const baseUrl = String(credentials.baseUrl).replace(/\/+$/, '');
        const webhookUrl = this.getNodeWebhookUrl('default');
        const events = this.getNodeParameter('events', []) as string[];

        const created = (await this.helpers.httpRequestWithAuthentication.call(
          this,
          'openCredApi',
          {
            method: 'POST',
            url: `${baseUrl}/v1/webhooks`,
            body: {
              url: webhookUrl,
              description: `n8n workflow: ${this.getWorkflow().name ?? 'untitled'}`,
              events,
            },
            json: true,
          },
        )) as { id: string; secret: string };

        const stored = this.getWorkflowStaticData('node');
        stored.webhookId = created.id;
        // Held in workflow static data so the signature can be checked on every
        // delivery without another round trip.
        stored.secret = created.secret;
        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const stored = this.getWorkflowStaticData('node');
        if (typeof stored.webhookId !== 'string') return true;

        const credentials = await this.getCredentials('openCredApi');
        const baseUrl = String(credentials.baseUrl).replace(/\/+$/, '');

        try {
          await this.helpers.httpRequestWithAuthentication.call(this, 'openCredApi', {
            method: 'DELETE',
            url: `${baseUrl}/v1/webhooks/${stored.webhookId}`,
            json: true,
          });
        } catch {
          // The endpoint may already be gone; deactivation should still succeed.
        }

        delete stored.webhookId;
        delete stored.secret;
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const request = this.getRequestObject();
    const body = this.getBodyData();
    const stored = this.getWorkflowStaticData('node');
    const verify = this.getNodeParameter('verifySignature', true) as boolean;

    if (verify && typeof stored.secret === 'string') {
      const header = request.headers['x-opencred-signature'];
      if (typeof header !== 'string' || !isSignatureValid(header, stored.secret, body)) {
        return { webhookResponse: { status: 401, body: { error: 'invalid_signature' } } };
      }
    }

    return { workflowData: [this.helpers.returnJsonArray(body as never)] };
  }
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">` */
function isSignatureValid(header: string, secret: string, body: unknown): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((chunk) => {
      const [key, ...rest] = chunk.trim().split('=');
      return [key, rest.join('=')];
    }),
  ) as { t?: string; v1?: string };

  if (!parts.t || !parts.v1) return false;

  // Reject anything older than five minutes, so a captured payload cannot be
  // replayed tomorrow.
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = createHmac('sha256', secret)
    .update(`${parts.t}.${JSON.stringify(body)}`, 'utf8')
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parts.v1, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
