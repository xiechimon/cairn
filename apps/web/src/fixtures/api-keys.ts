import { BRAND, maskApiKey } from '@cairn/shared';
import { boardDefault } from './board.js';
import type { ApiKeyRecord, FixtureSet } from './records.js';

/** One created API key exercising both r3 §6 display rules: the list row
 *  mask and the one-time plaintext (02 §8 canon copy rides along in the
 *  page). Mask rule = 品牌前缀 + 前 8 hex + 省略号（r3 §6 observed sample
 *  `tds_afe07565…`；前缀随 BRAND.apiKeyPrefix 槽，#109）。 */
const API_KEY_PLAINTEXT = `${BRAND.apiKeyPrefix}afe07565b3c9d2e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0`;
const API_KEY_CREATED: ApiKeyRecord = {
  id: 'apikey-r7-1',
  name: null,
  masked: maskApiKey(API_KEY_PLAINTEXT),
  gitAccess: true,
  mcpAccess: true,
  plaintext: API_KEY_PLAINTEXT,
};

/** API-keys route fixture with the created key; the empty state (r2 19)
 *  is the fixture-less fallback. */
export const apiKeysCreated: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  apiKeys: { keys: [API_KEY_CREATED] },
};
