export const OWNER_SIGN_IN_PATH = '/app/sign-in';
export const OWNER_LINK_LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

export function ownerLinkLoopbackOrigin(host: string, port: number): string | null {
  const normalized = host.toLowerCase();
  const local =
    normalized === '0.0.0.0'
      ? '127.0.0.1'
      : normalized === '::' || normalized === '::1'
        ? '[::1]'
        : normalized;
  return OWNER_LINK_LOOPBACK_HOSTS.includes(local) ? `http://${local}:${port}` : null;
}

export function ownerLinkMessage(origin: string, code: string): string {
  return `Open Cairn: ${origin}${OWNER_SIGN_IN_PATH}#code=${code}\n`;
}
