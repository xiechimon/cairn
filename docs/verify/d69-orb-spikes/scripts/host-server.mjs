import net from 'node:net';
import fs from 'node:fs';
const path = process.argv[2];
const server = net.createServer((c) => {
  c.on('data', (d) => { console.log('host got:', d.toString().trim()); c.end(`pong-from-host to ${d.toString().trim()}\n`); });
});
server.listen(path, () => { fs.chmodSync(path, 0o600); console.log('listening', path); });
setTimeout(() => process.exit(0), 8000);
