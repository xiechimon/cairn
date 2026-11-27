import { describe, expect, test } from 'vitest';
import {
  classifyAgentFailure,
  classifyRetryFailure,
  classifyStepFailure,
  turnErrorKind,
} from '../src/index.js';

describe('turnErrorKind names the failure from the stored raw text', () => {
  test.each([
    ['Coordinator turn ended: model_error "Request timed out."', 'timeout'],
    [
      'Coordinator turn ended: model_error "503: {\\"message\\":\\"No available accounts: no available accounts\\",\\"type\\":\\"api_error\\"}"',
      'busy',
    ],
    [
      '404: {"message":"Model \\"glm-5.3\\" is not supported by any configured account in this group","type":"model_not_found"}',
      'model',
    ],
    [
      '400: {"message":"This model\'s maximum context length is 320000 tokens. However, you requested 128 output tokens"}',
      'context',
    ],
    ['Coordinator turn ended: no_model', 'no-model'],
    ['Coordinator route resolves to no keyed provider', 'no-model'],
    ['Coordinator turn ended: interrupted "generation, 3 times"', 'interrupted'],
    ['daemon journal lost across restart', 'interrupted'],
    ['executor lost', 'interrupted'],
    ['Coordinator turn ended: turn_limit "40 turns"', 'turn-limit'],
    ['Coordinator turn ended: model_error "Connection error."', 'connect'],
    ['Failed to fetch team settings', 'connect'],
    ['Coordinator turn ended: model_error "401: {\\"message\\":\\"Invalid API key\\"}"', 'key'],
    ['Coordinator turn ended: model_error "403: model not available in your region"', 'model'],
    [
      'Coordinator turn ended: model_error "429: {\\"error\\":{\\"type\\":\\"insufficient_quota\\"}}"',
      'quota',
    ],
    ['Coordinator turn ended: model_error "529: overloaded"', 'busy'],
    ['Coordinator turn ended: model_error "502: Bad Gateway"', 'provider'],
    [
      'API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required',
      'runtime-update',
    ],
    [
      "Runner error: ENOSPC: no space left on device, open '/Users/runner/.cairn/outbox/step-example.json'",
      'disk',
    ],
    [
      "Runner error: ENOSPC: no space left on device, open '/Users/runner/.cairn/outbox/.step-example.json.404.500.tmp'",
      'disk',
    ],
    ['Coordinator turn ended: model_error "ENOSPC: no space left on device"', 'disk'],
    ['Coordinator turn has no answer entry', 'unknown'],
  ])('%s', (message, kind) => {
    expect(turnErrorKind(message)).toBe(kind);
  });

  test.each(['400', '401', '403', '404', '429', '500', '503', '529'])(
    'a status-looking process id in an atomic temp path still means disk full: %s',
    (pid) => {
      expect(
        turnErrorKind(
          `Runner error: ENOSPC: no space left on device, open '/Users/runner/.cairn/outbox/.step-example.json.${pid}.0.tmp'`,
        ),
      ).toBe('disk');
    },
  );
});

describe('every failure classifier reads the same connection wording as a network failure', () => {
  test.each([
    'Failed to fetch team settings',
    'Coordinator turn ended: model_error "Failed to fetch team settings"',
    'Failed to fetch team settings: error sending request for url (https://api.example.com:443/v1)',
    'error sending request for url (https://api.example.com/v1)',
    'unable to connect to the server',
    'socket hang up',
    'read tcp: connection reset by peer',
    'connect: connection refused',
    'getaddrinfo ENOTFOUND api.example.com',
    'getaddrinfo EAI_AGAIN api.example.com',
    'connect EHOSTUNREACH 192.0.2.1:443',
    'connect ENETUNREACH 192.0.2.1:443',
  ])('%s', (message) => {
    expect(turnErrorKind(message)).toBe('connect');
    expect(classifyStepFailure(message)).toBe('network');
    expect(classifyAgentFailure(message)).toBe('provider_network');
    expect(classifyRetryFailure(message)).toMatchObject({
      failureClass: 'transient',
      reasonCode: 'network',
    });
  });

  test.each([
    ['Failed to fetch team settings: 401 Unauthorized', 'key', 'auth'],
    ['Failed to fetch team settings: Unauthorized', 'key', 'unknown'],
    ['Failed to fetch team settings: status:403 Forbidden', 'model', 'auth'],
    ['Failed to fetch team settings: 429 Too Many Requests', 'busy', 'rate_limit'],
    ['Failed to fetch team settings: 502 Bad Gateway', 'provider', 'server_error'],
    ['Failed to fetch team settings: 400 Bad Request', 'provider', 'unknown'],
  ])('a server that answered is not unreachable: %s', (message, kind, reasonCode) => {
    expect(turnErrorKind(message)).toBe(kind);
    expect(classifyStepFailure(message)).not.toBe('network');
    expect(classifyAgentFailure(message)).not.toBe('provider_network');
    expect(classifyRetryFailure(message).reasonCode).toBe(reasonCode);
  });
});
