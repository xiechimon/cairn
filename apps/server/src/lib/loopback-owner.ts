import { readFileSync } from 'node:fs';
import { endianness } from 'node:os';
import type { HttpBindings } from '@hono/node-server';
import type { Context } from 'hono';

const SOCKET_TABLES = ['/proc/net/tcp', '/proc/net/tcp6'];
const IPV4_LOOPBACK = '127.0.0.1';
const IPV6_LOOPBACK = '::1';
const LOOPBACK_HOST_NAMES = [IPV4_LOOPBACK, 'localhost', `[${IPV6_LOOPBACK}]`];
const HTTP_DEFAULT_PORT = 80;
const STATE_FIELD = 3;
const UID_FIELD = 7;
const INODE_FIELD = 9;
const TCP_ESTABLISHED = '01';
const RELAY_HEADERS = [
  'forwarded',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
  'x-client-ip',
  'cf-connecting-ip',
  'true-client-ip',
];
export interface LoopbackConnection {
  remoteAddress: string;
  remotePort: number;
  localAddress: string;
  localPort: number;
}

export interface LoopbackOwner {
  uid: number;
  peerUid: (connection: LoopbackConnection) => number | null;
}

type Loopback = typeof IPV4_LOOPBACK | typeof IPV6_LOOPBACK;

function loopbackOfNodeAddress(address: string): Loopback | null {
  if (address === IPV4_LOOPBACK || address === `::ffff:${IPV4_LOOPBACK}`) return IPV4_LOOPBACK;
  if (address === IPV6_LOOPBACK) return IPV6_LOOPBACK;
  return null;
}

function tableBytes(hex: string): Buffer | null {
  if (!/^[0-9A-F]+$/i.test(hex) || (hex.length !== 8 && hex.length !== 32)) return null;
  const bytes = Buffer.from(hex, 'hex');
  if (endianness() === 'LE') {
    for (let word = 0; word < bytes.length; word += 4) bytes.subarray(word, word + 4).reverse();
  }
  return bytes;
}

function loopbackOfTableAddress(hex: string): Loopback | null {
  const bytes = tableBytes(hex);
  if (bytes === null) return null;
  const v4 = bytes.length === 4 ? bytes : null;
  const mapped =
    bytes.length === 16 &&
    bytes.subarray(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
      ? bytes.subarray(12)
      : null;
  const ipv4 = v4 ?? mapped;
  if (ipv4 !== null) return ipv4.join('.') === IPV4_LOOPBACK ? IPV4_LOOPBACK : null;
  return bytes.length === 16 && bytes.subarray(0, 15).every((byte) => byte === 0) && bytes[15] === 1
    ? IPV6_LOOPBACK
    : null;
}

function endpointMatches(field: string | undefined, address: Loopback, port: number): boolean {
  const [hex, portHex] = (field ?? '').split(':');
  return (
    hex !== undefined &&
    portHex !== undefined &&
    /^[0-9A-F]{4}$/i.test(portHex) &&
    Number.parseInt(portHex, 16) === port &&
    loopbackOfTableAddress(hex) === address
  );
}

export function peerUidFromTables(
  tables: readonly string[],
  connection: LoopbackConnection,
): number | null {
  const peer = loopbackOfNodeAddress(connection.remoteAddress);
  const local = loopbackOfNodeAddress(connection.localAddress);
  if (peer === null || local === null) return null;
  const owners = new Set<number>();
  for (const table of tables) {
    for (const line of table.split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (
        !endpointMatches(fields[1], peer, connection.remotePort) ||
        !endpointMatches(fields[2], local, connection.localPort) ||
        fields[STATE_FIELD] !== TCP_ESTABLISHED ||
        !/^[1-9][0-9]*$/.test(fields[INODE_FIELD] ?? '')
      )
        continue;
      const uid = Number(fields[UID_FIELD]);
      if (Number.isInteger(uid) && uid >= 0) owners.add(uid);
    }
  }
  const [uid] = owners;
  return owners.size === 1 && uid !== undefined ? uid : null;
}

export function procNetPeerUid(connection: LoopbackConnection): number | null {
  const tables: string[] = [];
  for (const path of SOCKET_TABLES) {
    try {
      tables.push(readFileSync(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }
  }
  return peerUidFromTables(tables, connection);
}

export function loopbackOwnerFor(
  config: { requireToken: boolean },
  platform: NodeJS.Platform = process.platform,
): LoopbackOwner | null {
  const uid = process.getuid?.();
  if (config.requireToken || platform !== 'linux' || uid === undefined) return null;
  return { uid, peerUid: procNetPeerUid };
}

function connectionOf(c: Context): LoopbackConnection | null {
  const socket = (c.env as Partial<HttpBindings> | undefined)?.incoming?.socket;
  if (
    socket?.remoteAddress === undefined ||
    socket.remotePort === undefined ||
    socket.localAddress === undefined ||
    socket.localPort === undefined
  )
    return null;
  return {
    remoteAddress: socket.remoteAddress,
    remotePort: socket.remotePort,
    localAddress: socket.localAddress,
    localPort: socket.localPort,
  };
}

function loopbackHostsFor(port: number): Set<string> {
  const hosts = LOOPBACK_HOST_NAMES.map((name) => `${name}:${port}`);
  if (port === HTTP_DEFAULT_PORT) hosts.push(...LOOPBACK_HOST_NAMES);
  return new Set(hosts);
}

function relayed(c: Context): boolean {
  const headers = c.req.header();
  return Object.keys(headers).some((name) => RELAY_HEADERS.includes(name));
}

const peerUidBySocket = new WeakMap<object, number | null>();

export function loopbackOwnerOriginOf(c: Context, owner: LoopbackOwner): string | null {
  const connection = connectionOf(c);
  if (connection === null) return null;
  const host = c.req.header('host')?.toLowerCase();
  if (host === undefined || !loopbackHostsFor(connection.localPort).has(host)) return null;
  if (relayed(c)) return null;
  const socket = (c.env as HttpBindings).incoming.socket;
  let peerUid = peerUidBySocket.get(socket);
  if (peerUid === undefined) {
    peerUid = owner.peerUid(connection);
    peerUidBySocket.set(socket, peerUid);
  }
  return peerUid === owner.uid ? `http://${host}` : null;
}
