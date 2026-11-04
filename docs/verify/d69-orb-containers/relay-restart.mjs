import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PodmanOrbRuntime } from '../../../apps/daemon/src/orb/podman.ts';
import { createRelay, listenOnUnixSocket } from '../../../scripts/ops/orb/egress-relay.mjs';
const directory = mkdtempSync(join(process.env.XDG_RUNTIME_DIR, 'd69-relay-restart-'));
const path = join(directory, 'egress.sock');
const id = `cairn-orb-check-${randomUUID().slice(0, 8)}`;
const runtime = new PodmanOrbRuntime({ command: ['sleep', '120'] });
let server = createRelay();
try {
  await listenOnUnixSocket(server, path);
  await runtime.spawn({orbId:id,image:'cairn-orb-base:eb01c9191591ca17',mounts:[],env:{},limits:{cpus:1,memoryBytes:536870912,pids:128},egress:{socketPath:path}});
  const query = () => runtime.exec(id,['sh','-c', 'printf "CONNECT 10.0.0.1:443 HTTP/1.1\\r\\nHost: 10.0.0.1:443\\r\\n\\r\\n" | socat -T3 - "UNIX-CONNECT:$CAIRN_ORB_EGRESS_SOCKET" | head -n1'],{signal:AbortSignal.timeout(10000)});
  const before = await query();
  assert.match(before.stdout, /^HTTP\/1.1 403/);
  const unlink = await runtime.exec(id,['sudo','-n','rm','/run/cairn-egress/egress.sock']);
  assert.notEqual(unlink.code, 0);
  assert.match(unlink.stderr, /Read-only file system/);
  await new Promise((done) => server.close(done));
  server = createRelay();
  await listenOnUnixSocket(server, path);
  const after = await query();
  assert.match(after.stdout, /^HTTP\/1.1 403/);
  console.log(JSON.stringify({ok:true,before:before.stdout.trim(),after:after.stdout.trim(),replacementVisible:true,sudoUnlinkDenied:true,containerRestarted:false}));
} finally {
  await runtime.remove(id);
  await new Promise((done) => server.close(done));
  rmSync(directory, { recursive: true, force: true });
}
