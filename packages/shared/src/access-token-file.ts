import { ENV_VARS } from './brand.js';

export const ACCESS_TOKEN_FILE_NAME = 'token';

export function parseAccessTokenFile(content: string): string | null {
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== ENV_VARS.token) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2) {
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
        value = value.slice(1, -1);
      }
    }
    return value === '' ? null : value;
  }
  return null;
}

export function formatAccessTokenFile(token: string): string {
  return `${ENV_VARS.token}=${token}\n`;
}
