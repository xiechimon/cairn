import { BRAND } from '@cairn/shared';

export function startupMessage(): string {
  return `cairn-server online — machine registration: create an API key with POST /api/teams/{id}/api-keys, then run ${BRAND.cliCommandName} start --api-key <key> --team <teamId>`;
}
