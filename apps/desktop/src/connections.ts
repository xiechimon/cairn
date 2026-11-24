import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const LOCAL_CONNECTION_ID = 'local';
export const CONNECTIONS_FILE_NAME = 'connections.json';

export interface RemoteConnectionEntry {
  id: string;
  name: string;
  url: string;
}

export interface ConnectionCatalog {
  activeId: string;
  items: RemoteConnectionEntry[];
}

export type ActiveConnection =
  | { kind: 'local'; id: typeof LOCAL_CONNECTION_ID }
  | { kind: 'remote'; id: string; name: string; url: string };

export function normalizeRemoteUrl(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid server URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Server URL must use http or https');
  }
  return parsed.origin;
}

function catalogPath(userData: string): string {
  return join(userData, CONNECTIONS_FILE_NAME);
}

export function readConnectionCatalog(userData: string): ConnectionCatalog {
  const path = catalogPath(userData);
  if (!existsSync(path)) return { activeId: LOCAL_CONNECTION_ID, items: [] };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ConnectionCatalog>;
    const items = Array.isArray(raw.items)
      ? raw.items.flatMap((item): RemoteConnectionEntry[] => {
          if (
            typeof item?.id !== 'string' ||
            item.id === '' ||
            item.id === LOCAL_CONNECTION_ID ||
            typeof item?.name !== 'string' ||
            item.name.trim() === '' ||
            typeof item?.url !== 'string'
          ) {
            return [];
          }
          try {
            return [{ id: item.id, name: item.name.trim(), url: normalizeRemoteUrl(item.url) }];
          } catch {
            return [];
          }
        })
      : [];
    const activeId =
      typeof raw.activeId === 'string' &&
      (raw.activeId === LOCAL_CONNECTION_ID || items.some((i) => i.id === raw.activeId))
        ? raw.activeId
        : LOCAL_CONNECTION_ID;
    return { activeId, items };
  } catch {
    return { activeId: LOCAL_CONNECTION_ID, items: [] };
  }
}

export function writeConnectionCatalog(userData: string, catalog: ConnectionCatalog): void {
  const path = catalogPath(userData);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 });
}

export function addRemoteConnection(
  userData: string,
  input: { name: string; url: string },
): { catalog: ConnectionCatalog; added: RemoteConnectionEntry } {
  const name = input.name.trim();
  if (name === '') throw new Error('Connection name is required');
  const url = normalizeRemoteUrl(input.url);
  const catalog = readConnectionCatalog(userData);
  const existing = catalog.items.find((item) => item.url === url);
  if (existing !== undefined) {
    const updated: RemoteConnectionEntry = { ...existing, name };
    const next: ConnectionCatalog = {
      ...catalog,
      items: catalog.items.map((item) => (item.id === existing.id ? updated : item)),
    };
    writeConnectionCatalog(userData, next);
    return { catalog: next, added: updated };
  }
  const added: RemoteConnectionEntry = {
    id: `remote-${randomUUID().slice(0, 8)}`,
    name,
    url,
  };
  const next: ConnectionCatalog = {
    ...catalog,
    items: [...catalog.items, added],
  };
  writeConnectionCatalog(userData, next);
  return { catalog: next, added };
}

export function removeRemoteConnection(userData: string, id: string): ConnectionCatalog {
  const catalog = readConnectionCatalog(userData);
  const items = catalog.items.filter((item) => item.id !== id);
  const activeId = catalog.activeId === id ? LOCAL_CONNECTION_ID : catalog.activeId;
  const next: ConnectionCatalog = { activeId, items };
  writeConnectionCatalog(userData, next);
  return next;
}

export function setActiveConnection(userData: string, id: string): ConnectionCatalog {
  const catalog = readConnectionCatalog(userData);
  if (id !== LOCAL_CONNECTION_ID && !catalog.items.some((item) => item.id === id)) {
    throw new Error(`Unknown connection ${id}`);
  }
  const next: ConnectionCatalog = { ...catalog, activeId: id };
  writeConnectionCatalog(userData, next);
  return next;
}

export function activeConnectionOf(catalog: ConnectionCatalog): ActiveConnection {
  if (catalog.activeId === LOCAL_CONNECTION_ID) {
    return { kind: 'local', id: LOCAL_CONNECTION_ID };
  }
  const found = catalog.items.find((item) => item.id === catalog.activeId);
  if (found === undefined) {
    return { kind: 'local', id: LOCAL_CONNECTION_ID };
  }
  return { kind: 'remote', id: found.id, name: found.name, url: found.url };
}

export function runnerHomeForConnection(
  baseRunnerHome: string,
  userData: string,
  connectionId: string,
): string {
  if (connectionId === LOCAL_CONNECTION_ID) return baseRunnerHome;
  const safeId = connectionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return resolve(join(userData, 'runner-homes', safeId));
}
