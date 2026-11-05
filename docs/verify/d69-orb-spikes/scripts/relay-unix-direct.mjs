import { createRelay } from '../../../../scripts/ops/orb/egress-relay.mjs';
const server = createRelay({});
server.listen(process.argv[2], () => console.log('listening on unix socket', process.argv[2]));
process.on('uncaughtException', (e) => { console.log('relay process crashed:', e.code, e.message.split('\n')[0]); process.exit(3); });
