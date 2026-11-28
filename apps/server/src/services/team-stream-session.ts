import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context.js';
import { StreamSessionRegistry, type TeamStreamConnection } from './events.js';
import { deviceStreamsOf, pairedDeviceExists } from './paired-devices.js';

export const TEAM_STREAM_PING = JSON.stringify({ type: 'ping' });

const registries = new WeakMap<AppContext, StreamSessionRegistry>();

export function streamSessionsOf(ctx: AppContext): StreamSessionRegistry {
  let registry = registries.get(ctx);
  if (registry === undefined) {
    registry = new StreamSessionRegistry();
    registries.set(ctx, registry);
  }
  return registry;
}

export interface TeamStreamTarget {
  readonly teamId: string;
  readonly deviceId: string | null;
  readonly conn: TeamStreamConnection<string>;
  readonly abort: () => void;
}

export function startTeamStreamSession(ctx: AppContext, target: TeamStreamTarget): () => void {
  const { teamId, deviceId, conn, abort } = target;
  const unsubscribe = ctx.hub.subscribe(
    teamId,
    { send: (_payload, encoded) => conn.send(encoded) },
    ctx.user.id,
  );
  const connectionId = randomUUID();
  const closeSession = streamSessionsOf(ctx).open(connectionId, { conn, teamId, deviceId });
  const timer = setInterval(() => {
    if (deviceId !== null && !pairedDeviceExists(ctx.db, deviceId)) {
      abort();
      return;
    }
    void conn.send(TEAM_STREAM_PING);
  }, ctx.pingIntervalMs);
  const unbindDevice = deviceStreamsOf(ctx.db).bind(deviceId, abort);
  void conn.send(JSON.stringify({ type: 'hello', connectionId, followRevision: true }));
  void conn.send(TEAM_STREAM_PING);
  return () => {
    clearInterval(timer);
    unsubscribe();
    closeSession();
    unbindDevice();
  };
}
