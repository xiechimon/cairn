const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const LOOPBACK_IPV6_MAPPED = /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/i;
const LOOPBACK_NAMES = new Set(['localhost', 'localhost.', '::1']);

export function isLoopbackHost(host: string): boolean {
  const bare = (
    host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  ).toLowerCase();
  if (LOOPBACK_NAMES.has(bare) || bare.endsWith('.localhost') || bare.endsWith('.localhost.'))
    return true;
  const mapped = bare.startsWith('::ffff:') ? bare.slice(7) : bare;
  return LOOPBACK_IPV4.test(mapped) || LOOPBACK_IPV6_MAPPED.test(bare);
}
