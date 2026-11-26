import { isIP } from 'node:net';

function ipv4Private(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0)
  );
}

function expandIpv6(address: string): number[] | null {
  let text = address.split('%')[0] ?? address;
  const tail = text.match(/(?<!\d)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail !== null) {
    const [, a, b, c, d] = tail.map(Number);
    text = `${text.slice(0, text.length - (tail[0]?.length ?? 0))}${(((a ?? 0) << 8) | (b ?? 0)).toString(16)}:${(((c ?? 0) << 8) | (d ?? 0)).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' || halves[0] === undefined ? [] : halves[0].split(':');
  const rest = halves[1] === '' || halves[1] === undefined ? [] : halves[1].split(':');
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest].map((g) =>
    Number.parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => Number.isFinite(g)) ? groups : null;
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return ipv4Private(a, b);
  }
  if (family === 6) {
    const g = expandIpv6(address);
    if (g === null) return true;
    const embedded = (hi: number): boolean => ipv4Private(hi >> 8, hi & 0xff);
    const leadingZero = g.slice(0, 5).every((x) => x === 0);
    if (leadingZero && g[5] === 0xffff) return embedded(g[6] ?? 0);
    if (g.slice(0, 6).every((x) => x === 0))
      return embedded(g[6] ?? 0) || (g[6] === 0 && g[7] === 0);
    if (g[0] === 0x64 && g[1] === 0xff9b) return embedded(g[6] ?? 0);
    const first = g[0] ?? 0;
    return (
      (first & 0xffc0) === 0xfe80 || (first & 0xfe00) === 0xfc00 || (first & 0xff00) === 0xff00
    );
  }
  return true;
}
