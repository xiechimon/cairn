import type { SecretBox } from '@cairn/shared';
import { CODEX_PROVIDER_ID } from '../coordinator/codex-login.js';
import type { Db } from '../db/client.js';
import type { FetchLike } from '../lib/github.js';
import { materializeCodexAccessToken } from './codex-device-login.js';
import { materializeXaiAccessToken } from './xai-device-login.js';

export function providerAccessToken(
  deps: { db: Db; box: SecretBox; fetch: FetchLike },
  teamId: string,
  providerId: string,
): Promise<string> {
  const loginDeps = { ...deps, states: new Map() };
  return providerId === CODEX_PROVIDER_ID
    ? materializeCodexAccessToken(loginDeps, teamId)
    : materializeXaiAccessToken(loginDeps, teamId, providerId);
}
