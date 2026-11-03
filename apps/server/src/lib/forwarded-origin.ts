const FORWARDED_PROTOCOLS = new Set(['http', 'https']);
const HOST_PATTERN = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/;
const MAX_PORT = 65535;

function firstListValue(value: string | undefined): string | undefined {
  return value?.split(',')[0]?.trim();
}

function validHost(host: string): boolean {
  const match = HOST_PATTERN.exec(host);
  if (match === null) return false;
  const port = match[2];
  return port === undefined || Number(port.slice(1)) <= MAX_PORT;
}

export function forwardedOrigin(input: {
  url: string;
  loopbackPeer: boolean;
  proto?: string | undefined;
  host?: string | undefined;
}): string {
  const requestUrl = new URL(input.url);
  if (!input.loopbackPeer) return requestUrl.origin;
  const proto = firstListValue(input.proto);
  if (proto === undefined || !FORWARDED_PROTOCOLS.has(proto)) return requestUrl.origin;
  const host = firstListValue(input.host) ?? requestUrl.host;
  if (!validHost(host)) return requestUrl.origin;
  return new URL(`${proto}://${host}`).origin;
}
