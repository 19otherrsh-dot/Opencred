import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

/**
 * OpenCred API credentials for n8n.
 *
 * The base URL is a first-class field rather than a hidden constant, because a
 * large share of OpenCred installations are self-hosted. A connector that only
 * works against one vendor-operated host would quietly contradict the whole
 * point of the platform.
 */
export class OpenCredApi implements ICredentialType {
  name = 'openCredApi';

  displayName = 'OpenCred API';

  documentationUrl = 'https://github.com/opencred/opencred';

  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://api.opencred.example',
      required: true,
      placeholder: 'https://credentials.your-institution.edu',
      description:
        'The root of your OpenCred API. For a self-hosted install this is your own host.',
    },
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      placeholder: 'ock_live_…',
      description:
        'Create one in Settings → API keys. An "issuer" key is enough for issuance and revocation.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  };

  /**
   * The credential test hits `/v1/auth/me`, which returns the key's own
   * organisation and role — so a successful test proves not only that the key
   * is valid but which workspace and privilege level it carries.
   */
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
      url: '/v1/auth/me',
      method: 'GET',
    },
  };
}
