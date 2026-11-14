import { lookup } from 'node:dns/promises';
import { createConnection, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';

const port = Number(process.env.GATEWAY_PORT ?? 8080);
const [targetHost, targetPort] = (process.env.GATEWAY_TARGET ?? 'code-eval-runner:8080').split(':');
const idleMs = Number(process.env.GATEWAY_IDLE_MS ?? 30000);
const maxConnections = Number(process.env.GATEWAY_MAX_CONNECTIONS ?? 4);

const toInt = (address) => address.split('.').reduce((sum, octet) => sum * 256 + Number(octet), 0);

const { address: targetAddress } = await lookup(targetHost, { family: 4 });
const listenAddresses = Object.values(networkInterfaces())
  .flat()
  .filter(
    (nic) =>
      nic.family === 'IPv4' &&
      !nic.internal &&
      (toInt(nic.address) & toInt(nic.netmask)) !== (toInt(targetAddress) & toInt(nic.netmask)),
  )
  .map((nic) => nic.address);

let active = 0;

function forward(client) {
  if (active >= maxConnections) {
    client.destroy();
    return;
  }
  active += 1;
  const upstream = createConnection(Number(targetPort), targetHost);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    active -= 1;
    client.destroy();
    upstream.destroy();
  };
  client.setTimeout(idleMs, close);
  upstream.setTimeout(idleMs, close);
  client.on('error', close);
  upstream.on('error', close);
  client.on('close', close);
  upstream.on('close', close);
  client.pipe(upstream);
  upstream.pipe(client);
}

if (listenAddresses.length === 0) {
  console.error('code eval gateway: no address outside the runner network');
  process.exit(1);
}

for (const address of listenAddresses) {
  createServer(forward).listen(port, address, () =>
    console.log(`code eval gateway: ${address}:${port} -> ${targetHost}:${targetPort}`),
  );
}
