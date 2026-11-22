// Probe: the authorize URL the server mints for `cairn start` must serve the
// web app — a newcomer who opens it has to see the authorize page, not a 404.
// Red when the stack runs server+web on split origins without CAIRN_WEB_ORIGIN.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RUN_DIR =
  process.env.VERIFY_RUN_DIR ??
  join(process.env.VERIFY_REPO_ROOT ?? process.cwd(), '.claude', 'verify-run');
const ports = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const apiPort = ports.serverPort ?? Number(process.env.VERIFY_PORT ?? 8791);
const API = `http://127.0.0.1:${apiPort}`;

const start = await fetch(`${API}/api/machine/enroll/start`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'enroll-origin-probe' }),
});
if (!start.ok) {
  console.error(`FAIL enroll/start -> ${start.status}`);
  process.exit(1);
}
const body = await start.json();
console.log(`minted url: ${body.url}`);

const res = await fetch(body.url, { redirect: 'follow' });
const type = res.headers.get('content-type') ?? '';
const evidenceDir = process.env.VERIFY_EVIDENCE_DIR;
if (evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    join(evidenceDir, 'enroll-origin.json'),
    JSON.stringify({ url: body.url, status: res.status, contentType: type }, null, 2) + '\n',
  );
}
if (res.status !== 200 || !type.includes('text/html')) {
  console.error(`FAIL authorize url -> ${res.status} ${type} (expected 200 text/html)`);
  process.exit(1);
}
const html = await res.text();
if (!html.includes('<div id="root"') && !html.includes('cairn')) {
  console.error('FAIL authorize url served html but not the app shell');
  process.exit(1);
}
console.log('PASS authorize url serves the web app');
