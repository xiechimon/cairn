import { BRAND, maskApiKey } from '@cairn/shared';
import { boardDefault } from './board.js';
import type { ApiKeyRecord, FixtureSet } from './records.js';

const API_KEY_PLAINTEXT = `${BRAND.apiKeyPrefix}afe07565b3c9d2e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0`;
const API_KEY_CREATED: ApiKeyRecord = {
  id: 'apikey-r7-1',
  name: null,
  masked: maskApiKey(API_KEY_PLAINTEXT),
  gitAccess: true,
  mcpAccess: true,
  machineAccess: true,
  plaintext: API_KEY_PLAINTEXT,
};

export const apiKeysCreated: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  apiKeys: { keys: [API_KEY_CREATED] },
};
