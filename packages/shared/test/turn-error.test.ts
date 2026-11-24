import { describe, expect, test } from 'vitest';
import { turnErrorKind } from '../src/index.js';

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
    ['Coordinator turn has no answer entry', 'unknown'],
  ])('%s', (message, kind) => {
    expect(turnErrorKind(message)).toBe(kind);
  });
});
