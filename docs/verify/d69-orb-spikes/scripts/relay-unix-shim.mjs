import net from 'node:net';
import { createRelay } from '../../../../scripts/ops/orb/egress-relay.mjs';
const relay = createRelay({});
const front = net.createServer((socket) => {
  Object.defineProperty(socket, 'remoteAddress', { value: '10.203.0.2' });
  relay.emit('connection', socket);
});
front.listen(process.argv[2], () => console.log('shim listening on unix socket', process.argv[2]));
