import type {
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * The OpenCred n8n node (FR-INT-03).
 *
 * This is the least-crowded wedge in the category made concrete: an issuer
 * connects credential issuance to any of n8n's several hundred integrations
 * without writing code. A form submission, a Stripe payment, a row appearing in
 * a Google Sheet, a Slack command — any of them can issue a signed, verifiable
 * credential.
 *
 * Two details matter more than the surface area:
 *
 *  - **Templates are loaded dynamically.** The user picks from their real
 *    templates in a dropdown rather than pasting a UUID.
 *  - **Idempotency is opt-in but prominent.** n8n retries. Without a key, a
 *    retried workflow issues a second certificate to the same person, and the
 *    issuer finds out from the recipient.
 */
export class OpenCred implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'OpenCred',
    name: 'openCred',
    icon: 'file:opencred.svg',
    group: ['output'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Issue, verify and manage verifiable credentials',
    defaults: { name: 'OpenCred' },
    inputs: ['main'] as never,
    outputs: ['main'] as never,
    credentials: [{ name: 'openCredApi', required: true }],
    requestDefaults: {
      baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
      headers: { 'Content-Type': 'application/json' },
    },
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        default: 'credential',
        options: [
          { name: 'Credential', value: 'credential' },
          { name: 'Verification', value: 'verification' },
          { name: 'Recipient', value: 'recipient' },
        ],
      },

      // --- Credential operations --------------------------------------------
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['credential'] } },
        default: 'issue',
        options: [
          {
            name: 'Issue',
            value: 'issue',
            action: 'Issue a credential',
            description: 'Create, sign, render and deliver a credential',
          },
          {
            name: 'Revoke',
            value: 'revoke',
            action: 'Revoke a credential',
            description: 'Mark a credential as no longer valid, publicly and immediately',
          },
          {
            name: 'Get',
            value: 'get',
            action: 'Get a credential',
          },
          {
            name: 'List',
            value: 'list',
            action: 'List credentials',
          },
        ],
      },

      {
        displayName: 'Template Name or ID',
        name: 'templateId',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getTemplates' },
        required: true,
        default: '',
        displayOptions: { show: { resource: ['credential'], operation: ['issue'] } },
        description:
          'The design to render. Choose from the list, or specify an ID using an expression.',
      },
      {
        displayName: 'Recipient Name',
        name: 'recipientName',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'Ada Lovelace',
        displayOptions: { show: { resource: ['credential'], operation: ['issue'] } },
        description: 'Rendered on the credential exactly as given',
      },
      {
        displayName: 'Recipient Email',
        name: 'recipientEmail',
        type: 'string',
        placeholder: 'ada@example.com',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['credential'], operation: ['issue'] } },
      },
      {
        displayName: 'Credential Fields',
        name: 'dataFields',
        type: 'fixedCollection',
        typeOptions: { multipleValues: true },
        default: {},
        placeholder: 'Add field',
        displayOptions: { show: { resource: ['credential'], operation: ['issue'] } },
        description:
          'Values for the merge fields the template declares, such as course or grade',
        options: [
          {
            name: 'field',
            displayName: 'Field',
            values: [
              { displayName: 'Key', name: 'key', type: 'string', default: '' },
              { displayName: 'Value', name: 'value', type: 'string', default: '' },
            ],
          },
        ],
      },
      {
        displayName: 'Additional Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add option',
        default: {},
        displayOptions: { show: { resource: ['credential'], operation: ['issue'] } },
        options: [
          {
            displayName: 'External ID',
            name: 'externalId',
            type: 'string',
            default: '',
            description: 'Your own identifier for this person, used to de-duplicate recipients',
          },
          {
            displayName: 'Credential Title',
            name: 'title',
            type: 'string',
            default: '',
            description: 'Defaults to the template name',
          },
          {
            displayName: 'Description',
            name: 'description',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Expires At',
            name: 'expiresAt',
            type: 'dateTime',
            default: '',
          },
          {
            displayName: 'Idempotency Key',
            name: 'idempotencyKey',
            type: 'string',
            default: '',
            description:
              'Strongly recommended. n8n retries on failure; without a stable key a retry issues a duplicate credential. Something like "course-{{$json.courseId}}-user-{{$json.userId}}" works well.',
          },
          {
            displayName: 'Suppress Email',
            name: 'suppressEmail',
            type: 'boolean',
            default: false,
            description: 'Whether to skip the delivery email and hand the credential over yourself',
          },
          {
            displayName: 'Skills',
            name: 'skills',
            type: 'string',
            default: '',
            description: 'Comma-separated skills recorded in the Open Badges achievement',
          },
        ],
      },

      {
        displayName: 'Credential ID',
        name: 'credentialId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['credential'], operation: ['revoke', 'get'] } },
        description: 'The credential UUID, or its public identifier',
      },
      {
        displayName: 'Reason',
        name: 'reason',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['credential'], operation: ['revoke'] } },
        description: 'Shown publicly on the verification page',
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 200 },
        default: 50,
        displayOptions: { show: { resource: ['credential'], operation: ['list'] } },
        description: 'Max number of results to return',
      },

      // --- Verification -----------------------------------------------------
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['verification'] } },
        default: 'verify',
        options: [
          {
            name: 'Verify',
            value: 'verify',
            action: 'Verify a credential',
            description: 'Check one credential by its public identifier',
          },
          {
            name: 'Verify Many',
            value: 'verifyMany',
            action: 'Verify many credentials',
            description: 'Check a list of identifiers in a single call',
          },
        ],
      },
      {
        displayName: 'Credential ID',
        name: 'publicId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['verification'], operation: ['verify'] } },
      },
      {
        displayName: 'Credential IDs',
        name: 'publicIds',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'k7m2q9xb4t, j4h8p2mq7v',
        displayOptions: { show: { resource: ['verification'], operation: ['verifyMany'] } },
        description: 'Comma-separated identifiers, up to 1,000',
      },

      // --- Recipients -------------------------------------------------------
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['recipient'] } },
        default: 'list',
        options: [
          { name: 'List', value: 'list', action: 'List recipients' },
          { name: 'Get', value: 'get', action: 'Get a recipient' },
        ],
      },
      {
        displayName: 'Recipient ID',
        name: 'recipientId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['recipient'], operation: ['get'] } },
      },
      {
        displayName: 'Search',
        name: 'search',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['recipient'], operation: ['list'] } },
        description: 'Filter by name, email or external ID',
      },
    ],
  };

  methods = {
    loadOptions: {
      async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const credentials = await this.getCredentials('openCredApi');
        const baseUrl = String(credentials.baseUrl).replace(/\/+$/, '');

        const templates = (await this.helpers.httpRequestWithAuthentication.call(
          this,
          'openCredApi',
          { method: 'GET', url: `${baseUrl}/v1/templates`, json: true },
        )) as Array<{ id: string; name: string; kind: string }>;

        return templates.map((template) => ({
          name: `${template.name} (${template.kind})`,
          value: template.id,
        }));
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];

    const credentials = await this.getCredentials('openCredApi');
    const baseUrl = String(credentials.baseUrl).replace(/\/+$/, '');

    const request = async (method: string, path: string, body?: unknown) =>
      this.helpers.httpRequestWithAuthentication.call(this, 'openCredApi', {
        method: method as never,
        url: `${baseUrl}${path}`,
        body: body as never,
        json: true,
      });

    for (let i = 0; i < items.length; i += 1) {
      const resource = this.getNodeParameter('resource', i) as string;
      const operation = this.getNodeParameter('operation', i) as string;

      try {
        let result: unknown;

        if (resource === 'credential' && operation === 'issue') {
          const options = this.getNodeParameter('options', i, {}) as Record<string, unknown>;
          const fields = this.getNodeParameter('dataFields.field', i, []) as Array<{
            key: string;
            value: string;
          }>;

          const data: Record<string, string> = {};
          for (const field of fields) {
            if (field.key) data[field.key] = field.value ?? '';
          }

          const skills =
            typeof options.skills === 'string' && options.skills.trim()
              ? options.skills.split(',').map((s) => s.trim()).filter(Boolean)
              : undefined;

          result = await request('POST', '/v1/credentials', {
            templateId: this.getNodeParameter('templateId', i) as string,
            recipient: {
              name: this.getNodeParameter('recipientName', i) as string,
              email: this.getNodeParameter('recipientEmail', i) as string,
              ...(options.externalId ? { externalId: options.externalId } : {}),
            },
            ...(options.title ? { title: options.title } : {}),
            ...(options.description ? { description: options.description } : {}),
            ...(options.expiresAt
              ? { expiresAt: new Date(options.expiresAt as string).toISOString() }
              : {}),
            ...(skills ? { achievement: { skills } } : {}),
            data,
            suppressEmail: Boolean(options.suppressEmail),
            ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
          });
        } else if (resource === 'credential' && operation === 'revoke') {
          const id = this.getNodeParameter('credentialId', i) as string;
          const reason = this.getNodeParameter('reason', i, '') as string;
          result = await request('POST', `/v1/credentials/${encodeURIComponent(id)}/revoke`, {
            ...(reason ? { reason } : {}),
          });
        } else if (resource === 'credential' && operation === 'get') {
          const id = this.getNodeParameter('credentialId', i) as string;
          result = await request('GET', `/v1/credentials/${encodeURIComponent(id)}`);
        } else if (resource === 'credential' && operation === 'list') {
          const limit = this.getNodeParameter('limit', i, 50) as number;
          result = await request('GET', `/v1/credentials?limit=${limit}`);
        } else if (resource === 'verification' && operation === 'verify') {
          const publicId = this.getNodeParameter('publicId', i) as string;
          result = await request(
            'GET',
            `/v1/public/credentials/${encodeURIComponent(publicId)}`,
          );
        } else if (resource === 'verification' && operation === 'verifyMany') {
          const raw = this.getNodeParameter('publicIds', i) as string;
          const credentialIds = raw
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          result = await request('POST', '/v1/public/verify/bulk', { credentialIds });
        } else if (resource === 'recipient' && operation === 'list') {
          const search = this.getNodeParameter('search', i, '') as string;
          result = await request(
            'GET',
            `/v1/recipients${search ? `?q=${encodeURIComponent(search)}` : ''}`,
          );
        } else if (resource === 'recipient' && operation === 'get') {
          const id = this.getNodeParameter('recipientId', i) as string;
          result = await request('GET', `/v1/recipients/${encodeURIComponent(id)}`);
        } else {
          throw new NodeOperationError(
            this.getNode(),
            `Unsupported operation "${operation}" on "${resource}"`,
            { itemIndex: i },
          );
        }

        // Array responses are split into one item per row, which is what makes
        // the node composable with n8n's per-item downstream nodes.
        if (Array.isArray(result)) {
          for (const entry of result) {
            output.push({ json: entry as never, pairedItem: { item: i } });
          }
        } else {
          output.push({ json: result as never, pairedItem: { item: i } });
        }
      } catch (error) {
        if (this.continueOnFail()) {
          output.push({
            json: { error: (error as Error).message },
            pairedItem: { item: i },
          });
          continue;
        }
        throw error;
      }
    }

    return [output];
  }
}
