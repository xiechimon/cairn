import type { Db } from '../db/client.js';
import { HttpError } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';

export interface DeviceJsonResponse {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export function createRefreshInflightMap<T = string>(): (db: Db) => Map<string, Promise<T>> {
  const inflights = new WeakMap<Db, Map<string, Promise<T>>>();
  return (db: Db) => {
    let map = inflights.get(db);
    if (map === undefined) {
      map = new Map<string, Promise<T>>();
      inflights.set(db, map);
    }
    return map;
  };
}

export function sweepExpiredStates<T extends { expiresAt: number }>(
  states: Map<string, T>,
  now = Date.now(),
): void {
  for (const [state, entry] of states) {
    if (entry.expiresAt <= now) states.delete(state);
  }
}

export function requiredDeviceString(
  body: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(502, `${label} returned an invalid ${field}`);
  }
  return value;
}

export function ownDeviceState<T extends { teamId: string }>(
  states: Map<string, T>,
  teamId: string,
  state: string,
  label: string,
): T {
  const entry = states.get(state);
  if (!entry || entry.teamId !== teamId) throw new HttpError(404, `${label} not found`);
  return entry;
}

export async function postDeviceRequest(
  fetchImpl: FetchLike,
  url: string,
  contentType: string,
  body: string,
  options: { label: string; requireJsonOnError?: boolean },
): Promise<DeviceJsonResponse> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': contentType },
      body,
    });
  } catch {
    throw new HttpError(502, `${options.label} request failed`);
  }
  let parsed: unknown = {};
  try {
    parsed = await response.json();
  } catch {
    if (response.ok || options.requireJsonOnError === true) {
      throw new HttpError(502, `${options.label} returned invalid JSON (HTTP ${response.status})`);
    }
  }
  const record =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { ok: response.ok, status: response.status, body: record };
}

export function postDeviceJson(
  fetchImpl: FetchLike,
  url: string,
  payload: Record<string, string>,
  options: { label: string; requireJsonOnError?: boolean },
): Promise<DeviceJsonResponse> {
  return postDeviceRequest(fetchImpl, url, 'application/json', JSON.stringify(payload), options);
}

export function postDeviceForm(
  fetchImpl: FetchLike,
  url: string,
  fields: Record<string, string>,
  options: { label: string; requireJsonOnError?: boolean },
): Promise<DeviceJsonResponse> {
  return postDeviceRequest(
    fetchImpl,
    url,
    'application/x-www-form-urlencoded',
    new URLSearchParams(fields).toString(),
    options,
  );
}
