import net from 'node:net';
const c = net.connect(process.argv[2]);
c.on('connect', () => c.write('hello-from-host-as-ian\n'));
c.on('data', (d) => { console.log('host client received:', d.toString().trim()); c.end(); });
c.on('error', (e) => { console.log('host client error:', e.code); process.exit(1); });
