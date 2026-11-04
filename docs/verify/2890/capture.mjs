import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const checkout = realpathSync(process.env.VERIFY_REPO_ROOT ?? process.cwd());
const { runCanary } = await import(pathToFileURL(join(checkout, 'scripts/ops/orb/canary.mjs')));
const { startStack } = await import(pathToFileURL(join(checkout, 'scripts/ops/orb/canary-stack.mjs')));
const { chromium } = createRequire(join(checkout, 'apps/web/package.json'))('@playwright/test');
const assets = process.env.SWAGGER_UI_ASSETS_DIR ?? '/tmp/d69-swagger-ui-assets';
const output = resolve(process.env.VERIFY_EVIDENCE_DIR ?? '/tmp/d69-paired-evidence');
assert.ok(!output.startsWith(join(checkout, 'docs/verify') + '/'));
mkdirSync(output, { recursive: true, mode: 0o700 });
const sourceUrl = 'https://raw.githubusercontent.com/xiechimon/cairn/3e1bde9971ce50552be344dd49396e82dbbd0a6c/docs/research/orb-container-runtime.md';
const source = readFileSync(join(checkout, 'docs/research/orb-container-runtime.md'), 'utf8');
let screenshotMade = false;

async function captureApi(serverRecord, root, buildId) {
  assert.equal(realpathSync(`/proc/${serverRecord.pid}/cwd`), join(checkout, 'apps/server'));
  const env = Object.fromEntries(readFileSync(`/proc/${serverRecord.pid}/environ`).toString().split('\0').filter(Boolean).map((row) => {
    const index = row.indexOf('=');
    return [row.slice(0, index), row.slice(index + 1)];
  }));
  assert.ok(env.CAIRN_HOME.startsWith(root + '/'));
  assert.ok(env.CAIRN_TOKEN);
  const apiBase = `http://127.0.0.1:${env.PORT}`;
  const apiPath = `/api/builds/${buildId}/steps`;
  const direct = await fetch(apiBase + apiPath, { headers: { authorization: `Bearer ${env.CAIRN_TOKEN}` } });
  assert.equal(direct.status, 200);
  const payload = await direct.json();
  assert.ok(payload.some((step) => step.kind === 'build' && step.status === 'done'));
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes(env.CAIRN_TOKEN));
  assert.ok(!serialized.includes(process.env.HOME));
  const spec = {
    openapi: '3.0.3',
    info: { title: 'Cairn D69 live scratch API', version: 'PR2890', description: 'Real server and Podman Thread; only the model response is scripted. Production rollout and phone verification are not covered.' },
    servers: [{ url: apiBase }],
    paths: { '/api/builds/{buildId}/steps': { get: {
      summary: 'Read the completed real Podman Thread', operationId: 'readCompletedOrbStep',
      parameters: [{ name: 'buildId', in: 'path', required: true, schema: { type: 'string', default: buildId } }],
      responses: { 200: { description: 'Actual Cairn build-step rows', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
    } } },
  };
  const initialization = `window.onload=function(){window.ui=SwaggerUIBundle({spec:${JSON.stringify(spec)},dom_id:'#swagger-ui',deepLinking:false,validatorUrl:null,showMutatedRequest:false,presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],layout:'StandaloneLayout',requestInterceptor:function(request){if(request.url.startsWith(${JSON.stringify(apiBase + '/api/')})){request.headers.Authorization=${JSON.stringify('Bearer ' + env.CAIRN_TOKEN)};}return request;}});};`;
  const allowed = new Set(['index.html', 'swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js']);
  const server = createServer((request, response) => {
    const file = new URL(request.url, 'http://127.0.0.1').pathname.slice(1) || 'index.html';
    if (file === 'swagger-initializer.js') {
      response.writeHead(200, { 'content-type': 'application/javascript' });
      response.end(initialization);
    } else if (allowed.has(file)) {
      response.writeHead(200, { 'content-type': file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
      response.end(readFileSync(join(assets, file)));
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, args: ['--disable-web-security'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1250 }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
    await page.locator('.opblock-summary').click();
    await page.getByRole('button', { name: 'Try it out', exact: true }).click();
    const [network] = await Promise.all([
      page.waitForResponse((response) => response.url() === apiBase + apiPath && response.request().method() === 'GET' && response.status() === 200),
      page.getByRole('button', { name: 'Execute', exact: true }).click(),
    ]);
    assert.ok((await network.json()).some((step) => step.kind === 'build' && step.status === 'done'));
    await page.locator('.live-responses-table').waitFor();
    assert.ok(!(await page.locator('body').innerText()).includes(env.CAIRN_TOKEN));
    await page.screenshot({ path: join(output, 'swagger-live-response.png'), fullPage: true });
    await page.close();
    const doc = await browser.newPage({ viewport: { width: 1500, height: 1250 }, deviceScaleFactor: 1 });
    await doc.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    assert.equal((await doc.locator('body').innerText()).trim(), source.trim());
    await doc.evaluate(() => {
      const node = document.querySelector('pre').firstChild;
      const index = node.textContent.indexOf('Canaries (');
      const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 20);
      window.scrollTo(0, window.scrollY + range.getBoundingClientRect().top - 70);
    });
    await doc.screenshot({ path: join(output, 'original-canary-requirements.png') });
    writeFileSync(join(output, 'capture.json'), JSON.stringify({
      sourceUrl, sourceSha256: createHash('sha256').update(source).digest('hex'), apiMethod: 'GET', apiPath,
      apiStatus: network.status(), doneStepObserved: true, swaggerUi: JSON.parse(readFileSync(join(assets, 'provenance.json'))),
      scope: { server: 'real isolated Cairn process', runtime: 'real rootless Podman', model: 'scripted response', production: 'not deployed', cors: 'API-tool browser disabled cross-origin enforcement; product CORS not evaluated', authorization: 'ephemeral scratch token injected privately, absent from screenshots' },
    }, null, 2) + '\n');
    screenshotMade = true;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const result = await runCanary({
  stackFactory: async (options) => {
    let serverRecord;
    const stack = await startStack({ ...options, record: (resource) => {
      options.record(resource);
      if (resource.kind === 'child' && resource.entry === 'src/index.ts' && resource.cwd === join(checkout, 'apps/server')) serverRecord = resource;
    } });
    return { ...stack, run: async (executor) => {
      const run = await stack.run(executor);
      if (executor === 'orb') await captureApi(serverRecord, options.root, run.orbName.slice('cairn-orb-'.length));
      return run;
    } };
  },
});
assert.equal(result.ok, true);
assert.equal(screenshotMade, true);
writeFileSync(join(output, 'canary.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, screenshotMade, apiStatus: 200, sentinelsRemaining: result.sentinelsRemaining, output }));
