import { homedir } from 'node:os';
import { PodmanOrbRuntime } from '../src/orb/podman.js';
import { probeContainer } from '../src/orb/probe.js';

const [image, orbId, egressSocketPath] = process.argv.slice(2);
if (!image || !orbId) throw new Error('Usage: orb-probe.ts IMAGE ORB_ID [EGRESS_SOCKET]');

const runtime = new PodmanOrbRuntime({ command: ['sleep', '300'] });
try {
  const probe = await probeContainer(runtime, {
    image,
    orbId,
    hostHome: homedir(),
    egressSocketPath: egressSocketPath || undefined,
  });
  process.stdout.write(`${JSON.stringify(probe)}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 1;
}
