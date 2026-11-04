import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['/relay-bridge.mjs', '/run/cairn-api.sock']);
const ready = await new Promise((resolve, reject) => {
  child.stdout.once('data', (d) => resolve(JSON.parse(d)));
  child.once('error', reject);
});
const result = { nodeVersion: process.version };
try {
  result.taskCanWriteWorkspace = (fs.writeFileSync('/app/changed.txt', 'task write'), true);
  result.hostRulerReadable = fs.existsSync(process.env.PROBE_RULER);
  result.hostCostReadable = fs.existsSync(process.env.PROBE_COST);
  try {
    fs.mkdirSync(process.env.PROBE_RULER.slice(0, process.env.PROBE_RULER.lastIndexOf('/')), {
      recursive: true,
    });
    fs.writeFileSync(process.env.PROBE_RULER, 'forged');
    result.hostRulerWriteAttempt = 'succeeded';
  } catch (e) {
    result.hostRulerWriteAttempt = e.code;
  }
  result.hostCredentialPresent = Object.hasOwn(process.env, 'C2_PARENT_ONLY_CREDENTIAL');
  result.dockerSocketVisible = fs.existsSync('/var/run/docker.sock');
  result.interfaces = Object.keys(os.networkInterfaces());
  try {
    await fetch('http://1.1.1.1', { signal: AbortSignal.timeout(1000) });
    result.externalNetwork = true;
  } catch {
    result.externalNetwork = false;
  }
  const response = await fetch(ready.baseUrl + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'placeholder' },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5',
      max_tokens: 1000,
      stream: true,
      messages: [{ role: 'user', content: 'fake model proof' }],
    }),
  });
  result.relayStatus = response.status;
  result.relayCompleted = (await response.text()).includes('message_stop');
  result.extraRouteStatus = (await fetch(ready.baseUrl + '/v1/models')).status;
  console.log(JSON.stringify(result));
} finally {
  child.kill('SIGTERM');
}
