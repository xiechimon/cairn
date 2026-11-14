import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { networkInterfaces } from 'node:os';
import { checkServerIdentity, connect } from 'node:tls';

const fixture = JSON.parse(process.env.PROTOTYPE_CASE);
const result = { case: fixture.name, interfaces: Object.keys(networkInterfaces()) };
const ca = fixture.trust === false ? undefined : readFileSync('/egress/ca.pem');
result.visibleFiles = readdirSync('/egress').sort();
result.otherGuestAndAdminAbsent = !existsSync('/b/egress.sock') && !existsSync('/admin.sock');
try {
  writeFileSync('/egress/write-probe', 'must fail');
  result.readOnlyListener = false;
} catch (error) {
  result.readOnlyListener = error.code === 'EROFS';
}
const header = `Bearer ${fixture.placeholder}`;
result.toolResult = { origin: 'https://allowed.test', header: `Authorization: ${header}` };
const proxy = request({
  socketPath: '/egress/egress.sock',
  method: 'CONNECT',
  path: fixture.authority ?? 'allowed.test:443',
  headers: { host: fixture.authority ?? 'allowed.test:443' },
});
proxy.on('error', () => {
  result.transportFailure = true;
  console.log(JSON.stringify(result));
});
proxy.on('connect', (response, socket, head) => {
  result.connectStatus = response.statusCode;
  if (response.statusCode !== 200) {
    socket.destroy();
    console.log(JSON.stringify(result));
    return;
  }
  if (head.length) socket.unshift(head);
  const secure = connect({
    socket,
    servername: fixture.sni ?? 'allowed.test',
    ca,
    checkServerIdentity: (_name, certificate) => checkServerIdentity('allowed.test', certificate),
  });
  let received = '';
  secure.setTimeout(3000, () => secure.destroy());
  secure.on('secureConnect', () => {
    const target = fixture.path ?? '/ok';
    const headers = [
      `Host: ${fixture.host ?? 'allowed.test'}`,
      `Authorization: ${header}`,
      ...(fixture.extraHeaders ?? []).map((value) =>
        value.replaceAll('{placeholder}', fixture.placeholder),
      ),
      'Connection: close',
    ];
    result.sentRequest = `${fixture.method ?? 'GET'} ${target.replaceAll('{placeholder}', fixture.placeholder)} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`;
    secure.write(result.sentRequest);
  });
  secure.on('data', (chunk) => {
    received += chunk;
  });
  secure.on('error', () => {
    result.tlsFailure = true;
  });
  secure.on('close', () => {
    result.status = Number(/^HTTP\/1.1 (\d+)/.exec(received)?.[1] ?? 0);
    result.response = received;
    console.log(JSON.stringify(result));
  });
});
proxy.setTimeout(3000, () => proxy.destroy());
proxy.end();
