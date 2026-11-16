import { BRAND, ownerSignInLink, PUBLISHED_PACKAGES } from '@cairn/shared';
import { loopbackOwnerFor } from './lib/loopback-owner.js';

export function startupMessage(): string {
  return `cairn-server online — machine registration: create an API key with POST /api/teams/{id}/api-keys, then run ${BRAND.cliCommandName} start --api-key <key> --team <teamId>`;
}

const LINK_HOST_BY_BIND: Record<string, string> = {
  '127.0.0.1': '127.0.0.1',
  '0.0.0.0': '127.0.0.1',
  '::': '127.0.0.1',
  '::ffff:127.0.0.1': '127.0.0.1',
  localhost: 'localhost',
  '::1': '[::1]',
};

export function ownerLinkOrigin(
  config: { authToken: string | null; requireToken: boolean; host: string },
  port: number,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (config.authToken === null || loopbackOwnerFor(config, platform) !== null) return null;
  if (config.requireToken) return null;
  const host = LINK_HOST_BY_BIND[config.host];
  return host === undefined ? null : `http://${host}:${port}`;
}

export function ownerLinkMessage(origin: string, code: string): string {
  return `\nOpen Cairn in a browser on this computer to sign in as the owner (works once, for 10 minutes):\n  ${ownerSignInLink(origin, code)}\nFor a new link later, run \`npx ${PUBLISHED_PACKAGES.server.name} token --link\`.\n\n`;
}
