import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  accessFindings,
  allowanceDiff,
  allowlistPath,
  enforceAllowlist,
  forwardedSources,
  inventoryFindings,
  inventoryPath,
  isProtectedSource,
  migrationFindings,
  migrationWriterFindings,
  schemaTables,
  sourceReader,
  sourceTreeFindings,
  sqlTriggers,
  validateInventoryShape,
  violationKeys,
} from './lib/team-scope-inventory.mjs';
import { databaseMethodSurfaces, sqliteWrites } from './lib/team-scope-sql.mjs';

const root = resolve(import.meta.dirname, '..');
const read = sourceReader(root);
const inventory = JSON.parse(read(inventoryPath));
const allowanceGroups = JSON.parse(read(allowlistPath));
const dependencyGroups = [
  'storage-kernel',
  'screen-delivery',
  'repository-and-claim-credentials',
  'skills-and-files',
  'replay-and-publication',
  'worker-and-external-effects',
  'runner-device-computer',
  'admission',
  'conversations-chief-memory',
  'schedules-documents-design',
  'projects-tasks-builds',
  'shared-adapters',
];
const noDrift = { duplicates: [], unexpected: [], stale: [] };
const allowlist = Object.values(allowanceGroups).flat();
let baseline;
function baselineFindings() {
  baseline ??= inventoryFindings(root);
  return baseline;
}

function assertRejected(allowances, findings, key) {
  assert.throws(
    () => enforceAllowlist(allowances, findings),
    (error) => {
      assert.ok(error.message.startsWith('Team-scope source access changed\nunexpected'));
      assert.ok(error.message.split('\n').includes(key), `Missing gate diagnostic for ${key}`);
      return true;
    },
  );
}

test('the source gate allows only the classified server and daemon baseline', (t) => {
  assert.deepEqual(Object.keys(allowanceGroups).sort(), [...dependencyGroups].sort());
  for (const group of dependencyGroups) {
    const rows = allowanceGroups[group];
    assert.ok(Array.isArray(rows) && rows.every((row) => typeof row === 'string'), group);
    assert.ok(
      rows.every((row) => isProtectedSource(row.split(' | ')[0])),
      group,
    );
    t.diagnostic(`${group}: ${rows.length}`);
  }
  t.diagnostic(`total: ${allowlist.length}`);
  enforceAllowlist(allowlist, baselineFindings());
});

test('the historical trigger inventory rejects any new, missing or changed definition', () => {
  const expected = inventory.triggerDefinitions.map(
    ({ path, id, hash }) => `${path} | historical-trigger | ${id} | ${hash} | 1`,
  );
  enforceAllowlist(expected, migrationFindings(root));
});

for (const { id, path, rule, operation = id } of inventory.negativeControls) {
  test(`legacy source control: ${id} is rejected without its allowance`, () => {
    const protectedSource = isProtectedSource(path);
    const source = read(path);
    const findings = protectedSource ? baselineFindings() : accessFindings(path, source);
    const allowances = protectedSource ? allowlist : violationKeys(findings);
    const matchOperation = (finding) =>
      finding.rule === rule &&
      (finding.location === operation || finding.location.endsWith(`:${operation}`));
    const keys = violationKeys(
      findings.filter((finding) => finding.path === path && matchOperation(finding)),
    );
    assert.ok(keys.length, `No operation classified for ${id}`);
    enforceAllowlist(allowances, findings);
    for (const key of keys) {
      assert.ok(allowances.includes(key), `Missing baseline entry for ${id}`);
      assertRejected(
        allowances.filter((row) => row !== key),
        findings,
        key,
      );
    }
  });
}

test('moving one unchanged call into an already admitted consumer invalidates its allowance', () => {
  const from = 'apps/server/src/lib/git.ts';
  const into = 'apps/server/src/services/git.ts';
  const original = read(from);
  const consumer = read(into);
  const baseline = baselineFindings();
  enforceAllowlist(allowlist, baseline);
  assert.ok(
    baseline.some(({ path, location }) => path === into && location === 'remoteDefaultRef:runGit'),
  );

  const call = original.match(/runGit\(\['symbolic-ref', '--short', 'HEAD'\], \{[^}]+\}\)/)?.[0];
  assert.ok(call);
  const anchor =
    "  const head = await runGit(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']";
  assert.ok(consumer.includes(anchor));
  const processFindings = (sources) =>
    sourceTreeFindings(new Map(sources)).filter(({ rule }) => rule === 'process-invocation');
  const known = violationKeys(
    processFindings([
      [from, original],
      [into, consumer],
    ]),
  );
  const findings = processFindings([
    [from, original.replace(call, 'Promise.resolve({ code: 1, stdout: Buffer.alloc(0) })')],
    [
      into,
      consumer.replace(anchor, `  const META_TIMEOUT_MS = 15_000;\n  await ${call};\n${anchor}`),
    ],
  ]);
  const drift = allowanceDiff(known, violationKeys(findings));
  assert.equal(drift.stale.length, 1);
  const [oldKey] = drift.stale;
  assert.ok(
    oldKey.startsWith(`${from} | process-invocation | systemGitOps.listBranches:runGit | `),
  );
  const movedKey = oldKey
    .replace(from, into)
    .replace('systemGitOps.listBranches:runGit', 'remoteDefaultRef:runGit');
  assert.deepEqual(drift, { duplicates: [], unexpected: [movedKey], stale: [oldKey] });
  assert.ok(allowlist.includes(oldKey));
  assertRejected(known, findings, movedKey);
});

test('moving one unchanged Git call between multiline functions invalidates its allowance', () => {
  const path = 'apps/daemon/src/git.ts';
  const source = read(path);
  const call = source.match(
    /runGit\(\['show', '-s', '--format=%cn%x00%ce', [^\n]+\n(?: {6}[^\n]+\n)+ {4}\}\);/,
  )?.[0];
  assert.ok(call);
  const anchor = "  const current = await runGit(['branch', '--show-current'], {";
  assert.ok(source.includes(anchor));
  enforceAllowlist(allowlist, baselineFindings());

  const edited = source
    .replace(call, 'Promise.resolve({ code: 1, stdout: Buffer.alloc(0) });')
    .replace(anchor, `  await ${call}\n${anchor}`);
  const known = violationKeys(accessFindings(path, source));
  const findings = accessFindings(path, edited);
  const drift = allowanceDiff(known, violationKeys(findings));
  assert.equal(drift.stale.length, 2);
  const [wrapperKey, oldKey] = drift.stale;
  assert.ok(
    wrapperKey.startsWith(`${path} | process-invocation | gitPrim.push:rebaseCommitterEnv | `),
  );
  assert.ok(oldKey.startsWith(`${path} | process-invocation | rebaseCommitterEnv:runGit | `));
  assert.deepEqual(drift.duplicates, []);
  assert.equal(drift.unexpected.length, 1);
  const [movedKey] = drift.unexpected;
  assert.match(movedKey, /\| process-invocation \| rebaseBranchOntoPublishedTip:runGit \|/);
  assert.notEqual(movedKey.split(' | ')[3], oldKey.split(' | ')[3]);
  assert.ok(allowlist.includes(oldKey));
  assert.ok(allowlist.includes(wrapperKey));
  assertRejected(known, findings, movedKey);
});

test('moving one unchanged Git call between multiline methods invalidates its allowance', () => {
  const path = 'apps/daemon/src/git.ts';
  const source = read(path);
  const call = source.match(
    /runGit\(\['diff', '--cached', '--quiet', '--exit-code'\], \{\n(?: {6}[^\n]+\n)+ {4}\}\);/,
  )?.[0];
  assert.ok(call);
  const anchor = '    const env = cred ? gitCredentialEnv(cred) : machineGitEnv();';
  assert.ok(source.includes(anchor));
  enforceAllowlist(allowlist, baselineFindings());

  const edited = source
    .replace(call, 'Promise.resolve({ code: 1 });')
    .replace(anchor, `    await ${call}\n${anchor}`);
  const known = violationKeys(accessFindings(path, source));
  const findings = accessFindings(path, edited);
  const drift = allowanceDiff(known, violationKeys(findings));
  assert.equal(drift.stale.length, 1);
  const [oldKey] = drift.stale;
  assert.ok(oldKey.startsWith(`${path} | process-invocation | gitPrim.commit:runGit | `));
  const movedKey = oldKey.replace('gitPrim.commit:runGit', 'gitPrim.push:runGit');
  assert.deepEqual(drift, { duplicates: [], unexpected: [movedKey], stale: [oldKey] });
  assert.ok(allowlist.includes(oldKey));
  assertRejected(known, findings, movedKey);
});

test('moving a call across multiline signatures preserves its hash but changes its locator', () => {
  const path = 'apps/daemon/src/example.ts';
  const call = "  runGit(['status']);";
  const signatures = [
    'function NAME({\n  dir,\n}: { dir: string }): void {',
    'function NAME(input: {\n  dir: string;\n}): void {',
    'function NAME([\n  dir,\n]: [string]): void {',
    'function NAME(\n  dir: string): Map<\n  string,\n  Array<{ value: string }>\n> {',
    'function NAME<T extends Record<string, string>>(\n  input: T,\n):\n  Promise<Array<T>>\n{',
    'function NAME(\n  dir: string,\n): {\n  value: string;\n} {',
    'NAME({\n  dir,\n}: { dir: string }): Map<\n  string,\n  string\n> {',
  ];
  for (const signature of signatures) {
    const fixture = (destination) => {
      const declarations = ['first', 'second'].map(
        (name) => `${signature.replace('NAME', name)}\n${name === destination ? call : ''}\n}`,
      );
      const body = signature.startsWith('function ')
        ? declarations.join('\n')
        : `const commands = {\n${declarations.join(',\n')}\n};`;
      return `${body}\n${call}`;
    };
    const original = accessFindings(path, fixture('first'));
    const moved = accessFindings(path, fixture('second'));
    const known = violationKeys(original);
    const owner = signature.startsWith('function ') ? '' : 'commands.';
    const [oldKey] = violationKeys(
      original.filter(({ location }) => location === `${owner}first:runGit`),
    );
    assert.ok(oldKey, signature);
    const movedKey = oldKey.replace(`${owner}first:runGit`, `${owner}second:runGit`);
    assert.deepEqual(allowanceDiff(known, violationKeys(moved)), {
      duplicates: [],
      unexpected: [movedKey],
      stale: [oldKey],
    });
    assertRejected(known, moved, movedKey);
  }
  const landed = baselineFindings().filter(
    ({ path, location }) => path === 'apps/daemon/src/git.ts' && location === 'landGitSquash:spawn',
  );
  assert.equal(landed.length, 1);
  assert.ok(allowlist.includes(violationKeys(landed)[0]));
});

test('editing the arguments of a runGitOk caller invalidates its allowance', () => {
  const path = 'apps/daemon/src/git.ts';
  const source = read(path);
  const call = "runGitOk(['remote', 'set-url', 'origin', '--', url]";
  const edited = source.replace(call, call.replace('url]', 'otherUrl]'));
  assert.notEqual(edited, source);
  const known = violationKeys(accessFindings(path, source));
  const findings = accessFindings(path, edited);
  const drift = allowanceDiff(known, violationKeys(findings));
  assert.equal(drift.stale.length, 1);
  assert.equal(drift.unexpected.length, 1);
  for (const key of [...drift.stale, ...drift.unexpected]) {
    assert.ok(key.includes('setRemoteUrl:runGitOk'), key);
  }
  assertRejected(known, findings, drift.unexpected[0]);
});

test('editing the screen viewer decryption input invalidates its allowance', () => {
  const path = 'apps/server/src/services/computer-screen.ts';
  const context = 'apps/server/src/context.ts';
  const source = read(path);
  const callee = 'this.deps.secretBox.open';
  const edited = source.replace(`${callee}(envelope)`, `${callee}(envelope.trim())`);
  assert.notEqual(edited, source);
  const prefix = `${path} | credential-invocation | ComputerScreenGateway.viewerToken:${callee} | `;
  const known = allowlist.filter((key) => key.startsWith(prefix));
  const findings = sourceTreeFindings(
    new Map([
      [path, edited],
      [context, read(context)],
    ]),
  ).filter(({ path: owner, rule, location }) => `${owner} | ${rule} | ${location} | ` === prefix);
  const [changed] = violationKeys(findings);
  assert.ok(changed, 'Changed viewer decryption call was not recorded');
  assert.equal(known.length, 1);
  assert.deepEqual(allowanceDiff(known, [changed]), {
    duplicates: [],
    unexpected: [changed],
    stale: known,
  });
  assertRejected(known, findings, changed);
});

test('credential invocations follow checker-resolved types and callable aliases', () => {
  const path = 'apps/server/src/credential-probe.ts';
  const findings = accessFindings(
    path,
    `
    import type { KeySecretBox as Box } from './lib/secret-box.js';
    import { newMachineToken as makeToken } from './lib/keys.js';
    import * as auth from './lib/token-auth.js';
    type Deps = { box: Pick<Box, 'open' | 'seal'>; auth: auth.TokenAuthOptions };
    type Verify = typeof auth.matchesAuthToken;
    function probe(deps: Deps, value: string, method: 'open' | 'seal', injected: Verify, local: { open(value: string): string }) {
      const box = deps.box;
      const { open: decode } = box;
      const verify: typeof auth.matchesAuthToken = auth.matchesAuthToken;
      box.open(value);
      box[method](value);
      decode(value);
      deps.auth.resolveDeviceId?.(value);
      verify(value, value);
      injected(value, value);
      makeToken();
      auth.matchesAuthToken(value, value);
      local.open(value);
    }
  `,
  );
  assert.deepEqual(
    findings.filter(({ rule }) => rule === 'credential-invocation').map(({ location }) => location),
    [
      'box.open',
      'box[method]',
      'decode',
      'deps.auth.resolveDeviceId',
      'verify',
      'injected',
      'makeToken',
      'auth.matchesAuthToken',
    ].map((callee) => `probe:${callee}`),
  );
});

for (const [kind, path, operation, before, after, fixture] of [
  [
    'APNs handoff',
    'apps/server/src/services/push.ts',
    'sendApns',
    'sendApns(apns, device, msg)',
    'sendApns(apns, device, otherMessage)',
  ],
  [
    'HTTP/2 headers',
    'apps/server/src/services/apns.ts',
    'request',
    `/3/device/\${device.token}`,
    `/3/device/\${otherDevice.token}`,
  ],
  [
    'HTTP/2 body',
    'apps/server/src/services/apns.ts',
    'request.end',
    'request.end(buildApnsPayload(msg))',
    'request.end(buildApnsPayload(otherMessage))',
  ],
  [
    'web push',
    'apps/server/src/services/push.ts',
    'webpush.sendNotification',
    'endpoint: row.endpoint',
    'endpoint: otherEndpoint',
  ],
  [
    'HTTP fetch',
    'apps/server/src/services/info-repo-snapshot.ts',
    'fetch',
    'api.github.com/repos/',
    'other.example/repos/',
  ],
  [
    'HTTP request',
    'apps/server/src/services/github-app-token.ts',
    'request',
    "path: '/token'",
    "path: '/other-token'",
  ],
  [
    'email handoff',
    'apps/server/src/services/connector-broker.ts',
    'deps.sendMail ?? sendSmtpMail',
    '(deps.sendMail ?? sendSmtpMail)(',
    '(deps.sendMail ?? sendSmtpMail)(otherConfig, ',
  ],
  [
    'SMTP',
    'apps/server/src/services/mail-smtp.ts',
    'transport.sendMail',
    'to: mail.to',
    'to: otherRecipient',
  ],
  [
    'SMTP fallback',
    'apps/server/src/services/push-alerts.ts',
    'channel.send',
    'channel.send(message, id)',
    'channel.send(otherMessage, id)',
  ],
  [
    'SMTP curl arguments',
    'apps/server/src/services/push-alerts.ts',
    'spawn',
    "'--upload-file',\n              mailPath,",
    "'--upload-file',\n              otherPath,",
  ],
  [
    'SMTP curl configuration',
    'apps/server/src/services/push-alerts.ts',
    'child.stdin.end',
    'child.stdin.end(config)',
    'child.stdin.end(otherConfig)',
  ],
  [
    'IM',
    'apps/server/src/services/im/core.ts',
    'session.send',
    'session.send(msg)',
    'session.send(otherMessage)',
  ],
  [
    'IM RPC',
    'apps/daemon/src/imsg-bridge.ts',
    'rpc.call',
    "rpc.call('send', { chat_guid: message.chatKey",
    "rpc.call('send', { chat_guid: otherChat",
  ],
  [
    'WebSocket',
    'apps/server/src/services/im/env.ts',
    'ws.send',
    'ws.send(text)',
    'ws.send(otherText)',
  ],
  [
    'undici WebSocket',
    'apps/daemon/src/computer/screen-channel.ts',
    'websocket.send',
    'websocket.send(frame)',
    'websocket.send(otherFrame)',
  ],
  [
    'webhook POST',
    'apps/server/src/fixture-webhook.ts',
    'post',
    'body: payload',
    'body: otherPayload',
    `
    function deliverWebhook(post: typeof globalThis.fetch, payload: string) {
      return post('https://hooks.example/delivery', { method: 'POST', body: payload });
    }
  `,
  ],
]) {
  test(`outbound ${kind} argument drift is rejected with unchanged imports`, () => {
    const source = fixture ?? read(path);
    const edited = source.replace(before, after);
    assert.notEqual(edited, source);
    const sink = ({ rule, location, line }) =>
      rule === 'outbound-delivery' &&
      (location.endsWith(`:${operation}`) || location.endsWith(`.${operation}`)) &&
      (kind !== 'IM RPC' || source.split('\n')[line - 1].includes("rpc.call('send'"));
    const scan = (text) =>
      kind === 'HTTP fetch'
        ? inventoryFindings(root, new Map([[path, text]])).filter((row) => row.path === path)
        : accessFindings(path, text);
    const known = violationKeys(scan(source).filter(sink));
    const findings = scan(edited).filter(sink);
    const changed = violationKeys(findings);
    assert.equal(known.length, 1, `Missing or ambiguous delivery call: ${operation}`);
    assert.equal(changed.length, 1);
    assert.deepEqual(allowanceDiff(known, changed), {
      duplicates: [],
      unexpected: changed,
      stale: known,
    });
    if (!fixture) assert.ok(allowlist.includes(known[0]), known[0]);
    assertRejected(known, findings, changed[0]);
  });
}

for (const [kind, title] of [
  ['computer', '需要你登录'],
  ['phone', '需要你接管手机'],
]) {
  test(`outbound ${kind} takeover destination drift is rejected`, () => {
    const path = 'apps/server/src/services/machine-computer.ts';
    const wrapper = 'apps/server/src/services/push-alerts.ts';
    const source = read(path);
    const call = `thread.userId, thread.teamId, {\n      title: '${title}'`;
    const changed = source.replace(call, call.replace('thread.teamId', 'otherTeamId'));
    assert.notEqual(changed, source);
    const deliveries = (text) =>
      sourceTreeFindings(
        new Map([
          [path, text],
          [wrapper, read(wrapper)],
        ]),
      ).filter(
        ({ path: owner, rule, location }) =>
          owner === path &&
          rule === 'outbound-delivery' &&
          location.endsWith(':sendMustReachAlert'),
      );
    const known = violationKeys(deliveries(source));
    const findings = deliveries(changed);
    const drift = allowanceDiff(known, violationKeys(findings));
    assert.equal(known.length, 2);
    for (const key of known) assert.ok(allowlist.includes(key), key);
    assert.equal(drift.unexpected.length, 1);
    assertRejected(known, findings, drift.unexpected[0]);
  });
}

test('delivery wrappers follow resolved callers transitively without matching shadowed names', () => {
  const path = 'apps/server/src/services/delivery-wrapper-probe.ts';
  const source = `
    function deliver(url: string, body: string) { return fetch(url, { method: 'POST', body }); }
    function forward(url: string, body: string) { return deliver(url, body); }
    const alias = forward;
    function entry(team: string) { return alias('/' + team, 'payload'); }
    function unrelated(alias: (value: string) => void) { alias('fixture'); }
  `;
  const deliveries = (input) =>
    accessFindings(path, input).filter(({ rule }) => rule === 'outbound-delivery');
  const known = violationKeys(deliveries(source));
  assert.deepEqual(
    deliveries(source).map(({ location }) => location),
    ['deliver:fetch', 'forward:deliver', 'entry:alias'],
  );
  const changed = deliveries(
    source.replace("alias('/' + team, 'payload')", "alias('/' + otherTeam, 'payload')"),
  );
  const { unexpected } = allowanceDiff(known, violationKeys(changed));
  assert.equal(unexpected.length, 1);
  assertRejected(known, changed, unexpected[0]);
});

for (const [label, source, before, after] of [
  [
    'reassigned alias',
    `function deliverA(body) { return fetch('/team-a', { body }); }
     function deliverB(body) { return fetch('/team-b', { body }); }
     const deliver = deliverA;
     function entry() { return deliver('private'); }`,
    'const deliver = deliverA',
    'const deliver = deliverB',
  ],
  [
    'bound destination',
    `function deliver(url, body) { return fetch(url, { body }); }
     const forward = deliver.bind(null, '/team-a');
     function entry() { return forward('private'); }`,
    "bind(null, '/team-a')",
    "bind(null, '/team-b')",
  ],
  ...['call', 'apply'].map((method) => [
    method,
    `function deliver(url, body) { return fetch(url, { body }); }
     function entry() { return deliver.${method}(null, ${method === 'apply' ? "['/team-a', 'private']" : "'/team-a', 'private'"}); }`,
    '/team-a',
    '/team-b',
  ]),
  [
    'object property',
    `function deliver(url) { return fetch(url); }
     const senders = { forward: deliver };
     function entry(team) { return senders.forward('/' + team); }`,
    "senders.forward('/' + team)",
    "senders.forward('/' + otherTeam)",
  ],
  [
    'constructor',
    `class Publisher { constructor(team) { fetch('/' + team); } }
     function entry(team) { return new Publisher(team); }`,
    'new Publisher(team)',
    'new Publisher(otherTeam)',
  ],
  [
    'mutable alias',
    `function deliver(url) { return fetch(url); }
     function entry(team) { let forward = noop; forward = deliver; return forward(team); }`,
    'forward(team)',
    'forward(otherTeam)',
  ],
  [
    'mutable alias reassignment',
    `function deliverA(url) { return fetch('/a' + url); }
     function deliverB(url) { return fetch('/b' + url); }
     function entry(team) { let forward = deliverA; forward = deliverA; return forward(team); }`,
    'forward = deliverA; return',
    'forward = deliverB; return',
  ],
  [
    'shorthand property',
    `function deliver(url) { return fetch(url); }
     const senders = { deliver };
     function entry(team) { return senders.deliver(team); }`,
    'senders.deliver(team)',
    'senders.deliver(otherTeam)',
  ],
  [
    'dynamic property key',
    `function a(url) { return fetch('/a/' + url); } function b(url) { return fetch('/b/' + url); }
     const senders = { a, b }; const key = 'a'; function entry() { return senders[key]('private'); }`,
    "const key = 'a'",
    "const key = 'b'",
  ],
  [
    'dynamic destructured key',
    `function a(url) { return fetch('/a/' + url); } function b(url) { return fetch('/b/' + url); }
     const senders = { a, b }; const key = 'a'; const { [key]: forward } = senders;
     function entry() { return forward('private'); }`,
    "const key = 'a'",
    "const key = 'b'",
  ],
  [
    'negative zero destructured alias',
    `function deliver(team) { return fetch('/' + team); }
     const operations = { 0: deliver.bind(null, 'team-a') };
     const { [-0]: invoke } = operations; function entry() { return invoke(); }`,
    "'team-a'",
    "'team-b'",
  ],
  [
    'computed destructured bound alias',
    `function deliver(team) { return fetch('/' + team); }
     const senders = { forward: deliver.bind(null, 'team-a') };
     const { ['forward']: forward } = senders; function entry() { return forward(); }`,
    "'team-a'",
    "'team-b'",
  ],
  [
    'computed destructured alias',
    `function deliver(url) { return fetch(url); }
     const senders = { deliver }; const { ['deliver']: forward } = senders;
     function entry(team) { return forward(team); }`,
    'forward(team)',
    'forward(otherTeam)',
  ],
  [
    'destructured alias',
    `function deliver(url) { return fetch(url); }
     const senders = { deliver };
     const { deliver: forward } = senders;
     function entry(team) { return forward(team); }`,
    'forward(team)',
    'forward(otherTeam)',
  ],
  [
    'conditional alias',
    `function deliver(url) { return fetch(url); }
     const forward = flag ? deliver : noop;
     function entry(team) { return forward(team); }`,
    'forward(team)',
    'forward(otherTeam)',
  ],
  [
    'reassigned native fetch',
    `function noop(...args) {} let post = noop; post = fetch;
     function entry() { return post('/team-a'); }`,
    "post('/team-a')",
    "post('/team-b')",
  ],
  ...['call', 'apply'].map((name) => [
    `object ${name} method`,
    `function deliver(url) { return fetch(url); }
     const sender = { ${name}: deliver.bind(null, '/team-a') };
     function entry() { return sender.${name}(); }`,
    "'/team-a'",
    "'/team-b'",
  ]),
  ...['call', 'apply'].map((name) => [
    `ordinary ${name} alias`,
    `function a(url) { return fetch('/a/' + url); } function b(url) { return fetch('/b/' + url); }
     const ${name} = a; function entry() { return ${name}('private'); }`,
    `const ${name} = a`,
    `const ${name} = b`,
  ]),
  [
    'receiver state target',
    `function deliver() { return fetch(this.url); }
     const first = { url: '/a', forward: deliver }; const second = { url: '/b', forward: deliver };
     const senders = first; function entry() { return senders.forward(); }`,
    'const senders = first',
    'const senders = second',
  ],
  [
    'typed alias target',
    `function a(url: RequestInfo | URL, init?: RequestInit) { return fetch('/a/' + url, init); }
     function b(url: RequestInfo | URL, init?: RequestInit) { return fetch('/b/' + url, init); }
     const forward: typeof fetch = a; function entry() { return forward('private'); }`,
    'typeof fetch = a',
    'typeof fetch = b',
  ],
  [
    'destructured alias target',
    `function a(url) { return fetch('/a/' + url); } function b(url) { return fetch('/b/' + url); }
     const senders = { a, b }; const { a: forward } = senders;
     function entry() { return forward('private'); }`,
    '{ a: forward }',
    '{ b: forward }',
  ],
  [
    'shorthand upstream target',
    `function a(url) { return fetch('/a/' + url); } function b(url) { return fetch('/b/' + url); }
     const forward = a; const senders = { forward };
     function entry() { return senders.forward('private'); }`,
    'const forward = a',
    'const forward = b',
  ],
  [
    'object receiver target',
    `function a(url) { return fetch('/a/' + url); } function b(url) { return fetch('/b/' + url); }
     const first = { forward: a }; const second = { forward: b }; const senders = first;
     function entry() { return senders.forward('private'); }`,
    'const senders = first',
    'const senders = second',
  ],
  [
    'bound constructor target',
    `class Publisher { constructor(team) { fetch('/' + team); } }
     const Ctor = Publisher.bind(null, 'team-a'); function entry() { return new Ctor(); }`,
    "'team-a'",
    "'team-b'",
  ],
  [
    'shorthand bound wrapper',
    `function deliver(team) { return fetch('/' + team); }
     const forward = deliver.bind(null, 'team-a'); const senders = { forward };
     function entry() { return senders.forward(); }`,
    "'team-a'",
    "'team-b'",
  ],
  [
    'destructured bound wrapper',
    `function deliver(team) { return fetch('/' + team); }
     const senders = { forward: deliver.bind(null, 'team-a') }; const { forward } = senders;
     function entry() { return forward(); }`,
    "'team-a'",
    "'team-b'",
  ],
  ...['call', 'apply'].map((method) => [
    `destructured ${method} alias`,
    `function a(team) { return fetch('/a/' + team); }
     function b(team) { return fetch('/b/' + team); }
     const senders = { a, b }; const { a: forward } = senders;
     function entry() { return forward.${method}(null, ${method === 'apply' ? "['private']" : "'private'"}); }`,
    '{ a: forward }',
    '{ b: forward }',
  ]),
  [
    'reflected bound constructor',
    `class Publisher { constructor(team) { fetch('/' + team); } }
     const Ctor = Publisher.bind(null, 'team-a');
     function entry() { return Reflect.construct(Ctor, []); }`,
    "'team-a'",
    "'team-b'",
  ],
  [
    'class property bound wrapper',
    `function deliver(team) { return fetch('/' + team); }
     class Senders { forward = deliver.bind(null, 'team-a'); }
     const senders = new Senders(); function entry() { return senders.forward(); }`,
    "'team-a'",
    "'team-b'",
  ],
  [
    'returned wrapper',
    `function factory() { return (team) => fetch('/' + team); }
     function entry(team) { return factory()(team); }`,
    'factory()(team)',
    'factory()(otherTeam)',
  ],
  [
    'logical alias',
    `function deliver(url) { return fetch(url); }
     const forward = flag || deliver;
     function entry(team) { return forward(team); }`,
    'forward(team)',
    'forward(otherTeam)',
  ],
  [
    'reflect apply',
    `function deliver(url) { return fetch(url); }
     function entry(team) { return Reflect.apply(deliver, null, [team]); }`,
    '[team]',
    '[otherTeam]',
  ],
  [
    'reflect construct',
    `class Publisher { constructor(team) { fetch('/' + team); } }
     function entry(team) { return Reflect.construct(Publisher, [team]); }`,
    '[team]',
    '[otherTeam]',
  ],
]) {
  test(`delivery wrapper ${label} destination drift is rejected`, () => {
    const path = 'apps/server/src/services/indirect-delivery-probe.ts';
    const changed = source.replace(before, after);
    assert.notEqual(changed, source);
    const delivery = (text) =>
      accessFindings(path, text).filter(({ rule }) => rule === 'outbound-delivery');
    const known = violationKeys(delivery(source));
    const findings = delivery(changed);
    const { unexpected } = allowanceDiff(known, violationKeys(findings));
    assert.ok(unexpected.length, label);
    assertRejected(known, findings, unexpected[0]);
  });
}

test('unrelated static call and unique-symbol methods do not become delivery calls', () => {
  const path = 'apps/server/src/services/indirect-non-delivery-probe.ts';
  const source = `
    function deliver() { fetch('/private'); }
    class C { constructor() { deliver(); } static call() {} }
    function staticCall() { C.call(); }
    const idle = Symbol();
    const actions = { [idle]() {}, send() { deliver(); } };
    function keyed() { actions[idle](); }
    function destructured() { const { [idle]: run } = actions; run(); }
  `;
  const locations = accessFindings(path, source)
    .filter(({ rule }) => rule === 'outbound-delivery')
    .map(({ location }) => location);
  assert.ok(
    !locations.some((location) => /^(staticCall|keyed|destructured):/.test(location)),
    locations.join('\n'),
  );
});

test('numeric keys and explicitly declared call methods do not imply unrelated delivery', () => {
  const path = 'apps/server/src/services/delivery-names-probe.ts';
  const source = `
    function deliver() { fetch('/private'); }
    const handlers = { 0: () => {}, send: deliver };
    function numeric() { handlers[0](); }
    type Callable = (() => void) & { call: () => void };
    const fn = deliver as Callable;
    fn.call = () => {};
    function customCall() { fn.call(); }
  `;
  const locations = accessFindings(path, source)
    .filter(({ rule }) => rule === 'outbound-delivery')
    .map(({ location }) => location);
  assert.ok(
    !locations.some((location) => /^(numeric|customCall):/.test(location)),
    locations.join('\n'),
  );
});

test('signed keys and namespace call methods do not imply unrelated delivery', () => {
  const path = 'apps/server/src/services/signed-delivery-probe.ts';
  const source = `
    function deliver() { fetch('/private'); }
    const table = { [-1]: () => {}, send: deliver };
    function numeric() { table[-1](); }
    function destructured() { const { [-1]: run } = table; run(); }
    function transport() { deliver(); }
    namespace transport { export function call() {} }
    function customCall() { transport.call(); }
  `;
  const locations = accessFindings(path, source)
    .filter(({ rule }) => rule === 'outbound-delivery')
    .map(({ location }) => location);
  assert.ok(
    !locations.some((location) => /^(numeric|destructured|customCall):/.test(location)),
    locations.join('\n'),
  );
});

test('declared call signatures retain the native call delivery target', () => {
  const path = 'apps/server/src/services/call-signature-probe.ts';
  const source = `
    interface Callable { (url: string): void; call(thisArg: unknown, url: string): void; }
    function deliver(url: string) { fetch(url); }
    const fn = deliver as Callable;
    function entry() { fn.call(undefined, '/a'); }
  `;
  const delivery = (text) =>
    accessFindings(path, text).filter(({ rule }) => rule === 'outbound-delivery');
  const known = violationKeys(delivery(source));
  const findings = delivery(source.replace("'/a'", "'/b'"));
  const { unexpected } = allowanceDiff(known, violationKeys(findings));
  assert.ok(unexpected.length);
  assertRejected(known, findings, unexpected[0]);
});

test('a shadowed Reflect is not treated as the built-in delivery dispatcher', () => {
  const path = 'apps/server/src/services/reflect-shadow-probe.ts';
  const source = `
    function deliver(url) { return fetch(url); }
    function entry() { const Reflect = { apply: (_fn) => {} }; Reflect.apply(deliver); }
  `;
  assert.deepEqual(
    accessFindings(path, source)
      .filter(({ rule }) => rule === 'outbound-delivery')
      .map(({ location }) => location),
    ['deliver:fetch'],
  );
});

test('outbound delivery follows typed and bound callees, not names or setup calls', () => {
  const path = 'apps/server/src/services/fixture-delivery.ts';
  const findings = accessFindings(
    path,
    `
    import { sendApns as push } from './apns.js';
    import { type ImSocket } from './im/types.js';
    import { type ClientHttp2Session } from 'node:http2';
    function factory(): typeof fetch { return fetch; }
    function send(session: ClientHttp2Session, im: ImSocket, device: Parameters<typeof push>[1], local: { send(text: string): void }) {
      const post = globalThis.fetch.bind(globalThis);
      post('https://hooks.example/delivery', { method: 'POST', body: 'payload' });
      factory();
      const transmit: ImSocket['send'] = im.send;
      transmit('payload');
      const write = session.request({ ':path': '/delivery' });
      write.end('payload');
      const dispatch = push;
      dispatch(null!, device, null!);
      local.send('fixture');
    }
  `,
  ).filter(({ rule }) => rule === 'outbound-delivery');
  assert.deepEqual(
    findings.map(({ location }) => location),
    ['send:post', 'send:transmit', 'send:session.request', 'send:write.end', 'send:dispatch'],
  );
});

test('outbound delivery fingerprints the invocation of a returned fetch, not its factory', () => {
  const path = 'apps/server/src/lib/github.ts';
  const token = 'apps/server/src/lib/github-token.ts';
  const source = read(path);
  const original = 'githubTokenFetch(fetchImpl, token)(url, {';
  const edited = source.replace(original, 'githubTokenFetch(fetchImpl, token)(otherUrl, {');
  assert.notEqual(edited, source);
  const requestFindings = (input) =>
    sourceTreeFindings(
      new Map([
        [path, input],
        [token, read(token)],
      ]),
    ).filter(
      (finding) =>
        finding.path === path &&
        finding.rule === 'outbound-delivery' &&
        finding.location.startsWith('conditionalGetJson:githubTokenFetch'),
    );
  const known = violationKeys(requestFindings(source));
  const changed = requestFindings(edited);
  assert.equal(known.length, 1);
  assert.match(known[0], /conditionalGetJson:githubTokenFetch\(\)/);
  assert.ok(allowlist.includes(known[0]));
  const [unexpected] = violationKeys(changed);
  assert.notEqual(unexpected, known[0]);
  assertRejected(known, changed, unexpected);
});

test('moving the VM spawn between typed arrows changes only the call locator', () => {
  const path = 'apps/daemon/src/computer/vm-runtime.ts';
  const source = read(path);
  const call = source.match(/spawn\(argv\[0\][\s\S]+?\n {4}\}\)/)?.[0];
  assert.ok(call);
  const destination = (expression) => `
const otherVmCommand: VmCommandRunner = (argv, options = {}) =>
  new Promise(() => {
    const child = ${expression};
  });`;
  const original = source + destination('placeholder()');
  const moved = source.replace(call, 'placeholder()') + destination(call);
  const known = violationKeys(accessFindings(path, original));
  const findings = accessFindings(path, moved);
  const drift = allowanceDiff(known, violationKeys(findings));
  assert.equal(drift.stale.length, 1);
  const [oldKey] = drift.stale;
  assert.ok(oldKey.includes('runVmCommand:spawn'), oldKey);
  const movedKey = oldKey.replace('runVmCommand:spawn', 'otherVmCommand:spawn');
  assert.deepEqual(drift, { duplicates: [], unexpected: [movedKey], stale: [oldKey] });
  assertRejected(known, findings, movedKey);
});

test('process classification follows local wrappers transitively without matching shadowed names', () => {
  const path = 'apps/server/src/example.ts';
  const source = `
    import { spawn as launch } from 'node:child_process';
    function command(args: string[]) { return launch('git', args); }
    const wrapper: (args: string[]) => unknown = (args) => command(args);
    function entry(dir: string) { return wrapper(['status', dir]); }
    function unrelated(wrapper: (value: string) => void) { wrapper('fixture'); }
  `;
  const processLocations = accessFindings(path, source)
    .filter(({ rule }) => rule === 'process-invocation')
    .map(({ location }) => location);
  assert.deepEqual(processLocations, ['command:launch', 'wrapper:command', 'entry:wrapper']);
  const known = violationKeys(accessFindings(path, source));
  const edited = source.replace("wrapper(['status', dir])", "wrapper(['version', dir])");
  const findings = accessFindings(path, edited);
  const drift = allowanceDiff(known, violationKeys(findings));
  assert.equal(drift.unexpected.length, 1);
  assertRejected(known, findings, drift.unexpected[0]);
});

test('an adapter and its nested helpers share one scope opener budget', () => {
  const path = 'apps/server/src/example.ts';
  const source = 'function admittedAdapter() {\n  openRequestScope(context);\n}';
  enforceAllowlist([], accessFindings(path, source));
  for (const edited of [
    source.replace('\n}', '\n  openJobScope(context);\n}'),
    source.replace(
      'openRequestScope(context);',
      'openRequestScope(context); openJobScope(context);',
    ),
    source.replace('\n}', '\n  function helper() {\n    openJobScope(context);\n  }\n}'),
    source.replace(
      '  openRequestScope(context);',
      '  function helper() {\n    openJobScope(context);\n  }\n  openRequestScope(context);',
    ),
  ]) {
    assert.throws(() => enforceAllowlist([], accessFindings(path, edited)), /nested-scope-opener/);
  }
  const separate = 'function independentAdapter() {\n  openJobScope(context);\n}';
  enforceAllowlist([], accessFindings(path, `${source}\n${separate}`));
});

test('a new runGit invocation in an admitted source is rejected without a call allowance', () => {
  const path = 'apps/server/src/lib/git.ts';
  const source = read(path);
  const known = violationKeys(accessFindings(path, source));
  const changed = `${source}\nfunction inventoryProbe(dir: string) {\n  return runGit(['status'], { cwd: dir });\n}\n`;
  const findings = accessFindings(path, changed);
  const drift = allowanceDiff(known, violationKeys(findings));
  assert.deepEqual(drift.stale, []);
  assert.equal(drift.unexpected.length, 1);
  assert.match(drift.unexpected[0], /\| process-invocation \| inventoryProbe:runGit \|/);
  assertRejected(known, findings, drift.unexpected[0]);
});

test('a new direct SQLite open in an admitted source is rejected without an open allowance', () => {
  const path = 'apps/server/src/db/client.ts';
  const source = read(path);
  const known = violationKeys(accessFindings(path, source));
  const changed = `${source}\nfunction inventoryProbe() {\n  return new Database(':memory:');\n}\n`;
  const findings = accessFindings(path, changed);
  const drift = allowanceDiff(known, violationKeys(findings));
  assert.deepEqual(drift.stale, []);
  assert.equal(drift.unexpected.length, 1);
  assert.match(drift.unexpected[0], /\| sqlite-open \| inventoryProbe:Database \|/);
  assertRejected(known, findings, drift.unexpected[0]);
});

test('SQLite opens follow driver bindings and fingerprint their arguments', () => {
  const path = 'apps/server/src/example.ts';
  const source = `
    import Driver from 'better-sqlite3';
    import { DatabaseSync as Native } from 'node:sqlite';
    import * as sqlite from 'sqlite3';
    import { Database as BunDatabase } from 'bun:sqlite';
    const { Database: Required } = require('sqlite3');
    const Alias = Driver;
    function fixture() {
      new Driver(':memory:');
      Alias(':memory:');
      new Native(':memory:');
      new sqlite['Database'](':memory:');
      new Required(':memory:');
      new (sqlite.verbose().Database)(':memory:');
      BunDatabase.open(':memory:');
      const deferred = new Native(':memory:', { open: false });
      deferred.open();
    }
    async function loaded() {
      const { DatabaseSync } = await import('node:sqlite');
      new DatabaseSync(':memory:');
    }
    function unrelated(Driver: new (path: string) => unknown) { new Driver('fixture'); }
  `;
  const original = accessFindings(path, source);
  assert.deepEqual(
    original.filter(({ rule }) => rule === 'sqlite-open').map(({ location }) => location),
    [
      'fixture:Driver',
      'fixture:Alias',
      'fixture:Native',
      'fixture:sqlite.Database',
      'fixture:Required',
      'fixture:sqlite.verbose().Database',
      'fixture:BunDatabase.open',
      'fixture:Native',
      'fixture:deferred.open',
      'loaded:DatabaseSync',
    ],
  );
  const known = violationKeys(original);
  const edited = source.replace(
    "new Native(':memory:')",
    "new Native(':memory:', { readOnly: true })",
  );
  const findings = accessFindings(path, edited);
  const drift = allowanceDiff(known, violationKeys(findings));
  assert.equal(drift.stale.length, 1);
  assert.equal(drift.unexpected.length, 1);
  assertRejected(known, findings, drift.unexpected[0]);
});

test('process call fingerprints retain the arguments of direct and wrapped invocations', () => {
  const path = 'apps/server/src/example.ts';
  const source = [
    "import { spawn as launch, exec } from 'node:child_process';",
    "import * as child from 'node:child_process';",
    'const execute = promisify(child.execFile);',
    'function readFixture(dir: string) {',
    "  launch('git', ['status'], { cwd: dir });",
    "  exec('git status', { cwd: dir });",
    "  child.execFile('git', ['status'], { cwd: dir });",
    "  execute('git', ['status'], { cwd: dir });",
    "  /fixture/.exec('fixture');",
    '}',
  ].join('\n');
  const known = violationKeys(accessFindings(path, source));
  assert.deepEqual(
    accessFindings(path, source)
      .filter(({ rule }) => rule === 'process-invocation')
      .map(({ location }) => location),
    ['readFixture:launch', 'readFixture:exec', 'readFixture:child.execFile', 'readFixture:execute'],
  );
  for (const edited of [
    source.replace("launch('git', ['status']", "launch('git', ['version']"),
    source.replace(
      "execute('git', ['status'], { cwd: dir }",
      "execute('git', ['status'], { cwd: otherDir }",
    ),
  ]) {
    const drift = allowanceDiff(known, violationKeys(accessFindings(path, edited)));
    assert.equal(drift.unexpected.length, 1);
    assert.equal(drift.stale.length, 1);
    assert.throws(() => enforceAllowlist(known, accessFindings(path, edited)), /unexpected/);
  }
});

for (const [path, rule, before, after, expectedChanges = 1] of [
  [
    'apps/server/src/services/attachments.ts',
    'filesystem-invocation',
    'writeSync(fd, Buffer.from(fileBytes))',
    'writeSync(fd, Buffer.from(fileBytes), 0, fileBytes.length, 1)',
    2,
  ],
  [
    'apps/daemon/src/attach-file.ts',
    'filesystem-invocation',
    'readSync(fd, bytes, size, bytes.length - size, null)',
    'readSync(fd, bytes, size, bytes.length - size, 0)',
    2,
  ],
  [
    'apps/server/src/services/im/env.ts',
    'network-invocation',
    'new WebSocket(url)',
    'new WebSocket(otherUrl)',
  ],
  [
    'apps/daemon/src/computer/screen-channel.ts',
    'network-invocation',
    'new WebSocket(url, {',
    'new WebSocket(otherUrl, {',
  ],
  [
    'apps/daemon/src/machine-client.ts',
    'network-invocation',
    "this.fetchImpl(this.url('/api/machine/stream'), {",
    "this.fetchImpl(this.url('/api/machine/other-stream'), {",
  ],
]) {
  test(`${rule} records argument changes in ${path}`, () => {
    const source = read(path);
    const changed = source.replace(before, after);
    assert.notEqual(changed, source);
    const original = accessFindings(path, source).filter((row) => row.rule === rule);
    const findings = accessFindings(path, changed).filter((row) => row.rule === rule);
    const known = violationKeys(original);
    const drift = allowanceDiff(known, violationKeys(findings));
    assert.equal(drift.stale.length, expectedChanges);
    assert.equal(drift.unexpected.length, expectedChanges);
    for (const key of drift.unexpected) assertRejected(known, findings, key);
  });
}

test('argument changes through real process aliases retain a rejecting identity', () => {
  const path = 'apps/daemon/src/imsg-bridge.ts';
  const source = read(path);
  const changed = source.replace("spawnProc(bin, ['rpc']", "spawnProc(bin, ['fixture']");
  assert.notEqual(changed, source);
  const original = accessFindings(path, source);
  const findings = accessFindings(path, changed);
  const known = violationKeys(original);
  const key = allowanceDiff(known, violationKeys(findings)).unexpected.find((row) =>
    row.includes('createImsgBridge.runSession:spawnProc'),
  );
  assert.ok(key);
  assertRejected(known, findings, key);
});

test('the gate distinguishes an identical effect moved to a different branch or callback', () => {
  const path = 'apps/server/src/operation-site-probe.ts';
  for (const [rule, setup, call] of [
    ['filesystem-invocation', "import { writeSync } from 'node:fs';", 'writeSync(fd, bytes);'],
    ['process-invocation', "import { spawn } from 'node:child_process';", "spawn('git', argv);"],
    ['network-invocation', '', 'fetch(url);'],
    ['sql-invocation', '', "db.exec('SELECT 1');"],
  ]) {
    const fixture = (then, other) => `${setup}
      function route(db: import('node:sqlite').DatabaseSync, enabled: boolean) {
        if (enabled) { ${then} } else { ${other} }
      }
    `;
    const changed = accessFindings(path, fixture('', call));
    const known = violationKeys(accessFindings(path, fixture(call, '')));
    const { unexpected } = allowanceDiff(known, violationKeys(changed));
    const key = unexpected.find((row) => row.includes(` | ${rule} | `));
    assert.ok(key, rule);
    assertRejected(known, changed, key);
  }
  const callback = (first, second) => `function route() {
    handler(() => { ${first} }, () => { ${second} });
  }`;
  const call = 'fetch(url);';
  const known = violationKeys(accessFindings(path, callback(call, '')));
  const changed = accessFindings(path, callback('', call));
  const [key] = allowanceDiff(known, violationKeys(changed)).unexpected;
  assert.ok(key);
  assertRejected(known, changed, key);
});

for (const [rule, setup, body] of [
  ['hub-invocation', '', 'hub.publishTodoDoc(teamId, record);'],
  ['unresolved-loader', '', 'require(moduleName);'],
  ['nested-scope-opener', '', 'openRequestScope(ctx); openJobScope(ctx);'],
  ['sql-expression', "import { sql } from 'drizzle-orm';", 'const query = sql`SELECT 1`;'],
  ['sql-dependency', '', "require('node:sqlite');"],
  ['file-dependency', '', "require('node:fs');"],
  ['network-dependency', '', "require('node:http');"],
  ['process-dependency', '', "require('node:child_process');"],
  ['credential-dependency', '', "require('./credentials.js');"],
  ['classified-operation', '', 'const owner = { teamId: ctx.team.id };'],
  ['opaque-sql', '', 'db.exec(query);'],
  ['sqlite-open', "import { DatabaseSync } from 'node:sqlite';", "new DatabaseSync(':memory:');"],
  ['filesystem-invocation', "import { writeSync } from 'node:fs';", 'writeSync(fd, bytes);'],
  ['network-invocation', '', 'fetch(url);'],
  ['network-handoff', '', 'handler({ fetch: fetch });'],
  ['process-invocation', "import { spawn } from 'node:child_process';", "spawn('git', argv);"],
  ['sql-invocation', '', "db.exec('SELECT 1');"],
  ['persisted-output-write', '', "db.exec('UPDATE client_message SET response = 1');"],
]) {
  test(`${rule} fingerprints a changed enclosing guard`, () => {
    const path = 'apps/server/src/context-probe.ts';
    const source = `${setup}\nfunction probe(db: import('node:sqlite').DatabaseSync) {\nif (allowed) {\n${body}\n}\n}`;
    const findings = accessFindings(path, source).filter((row) => row.rule === rule);
    assert.ok(findings.length, rule);
    const changed = accessFindings(
      path,
      source.replace('if (allowed)', 'if (otherAllowed)'),
    ).filter((row) => row.rule === rule);
    assert.equal(changed.length, findings.length);
    if (rule === 'persisted-output-write') {
      assert.notDeepEqual(
        changed.map(({ writer }) => writer.hash),
        findings.map(({ writer }) => writer.hash),
      );
    } else {
      const known = violationKeys(findings);
      enforceAllowlist(known, findings);
      const drift = allowanceDiff(known, violationKeys(changed));
      assert.ok(drift.unexpected.length, rule);
      assertRejected(known, changed, drift.unexpected[0]);
    }
  });
}

test('forwarded dependencies fingerprint their enclosing guard', () => {
  const path = 'apps/server/src/context-probe.ts';
  const source = "if (allowed) { require('./raw.js'); }";
  const known = violationKeys(accessFindings(path, source, () => true));
  const changed = accessFindings(path, source.replace('allowed', 'otherAllowed'), () => true);
  assertRejected(known, changed, allowanceDiff(known, violationKeys(changed)).unexpected[0]);
});

for (const source of [
  'if (allowed) { hub.publish(teamId, doc); }',
  'allowed ? hub.publish(teamId, doc) : noop();',
  'allowed && hub.publish(teamId, doc);',
  'allowed || hub.publish(teamId, doc);',
  'allowed ?? hub.publish(teamId, doc);',
  'switch (allowed) { case 1: hub.publish(teamId, doc); }',
  'while (allowed) { hub.publish(teamId, doc); }',
  'do { hub.publish(teamId, doc); } while (allowed);',
  'for (; allowed;) { hub.publish(teamId, doc); }',
  'for (const item of allowed) { hub.publish(teamId, doc); }',
  'for (const item in allowed) { hub.publish(teamId, doc); }',
]) {
  test(`hub fingerprints the branch context: ${source}`, () => {
    const path = 'apps/server/src/context-probe.ts';
    const known = violationKeys(accessFindings(path, source));
    const changed = accessFindings(path, source.replace('allowed', 'otherAllowed'));
    const [key] = allowanceDiff(known, violationKeys(changed)).unexpected;
    assert.ok(key);
    assertRejected(known, changed, key);
  });
}

for (const [path, source] of [
  ['scripts/probe.sh', 'if allowed; then\n sqlite3 "$DB" "SELECT 1"\n .backup backup.db\nfi'],
  ['scripts/probe.py', 'if allowed:\n sqlite3.connect(path)'],
  [
    'scripts/deploy-probe.sh',
    'if allowed; then\n sqlite3 "$DB" "UPDATE deploy_lease SET status=1;"\nfi',
  ],
  [
    'apps/server/drizzle/context-probe.sql',
    'CREATE TRIGGER probe AFTER INSERT ON sample WHEN allowed BEGIN SELECT 1; UPDATE client_message SET response = 1; END;',
  ],
]) {
  test(`non-AST rules retain guard context in ${path}`, () => {
    const original = accessFindings(path, source);
    assert.ok(original.length);
    const known = violationKeys(original);
    const changed = accessFindings(path, source.replace('allowed', 'otherAllowed'));
    const drift = allowanceDiff(known, violationKeys(changed));
    assert.equal(drift.unexpected.length, known.length);
    assertRejected(known, changed, drift.unexpected[0]);
    if (path.endsWith('.sql')) {
      const writers = migrationWriterFindings(path, source);
      const changedWriters = migrationWriterFindings(
        path,
        source.replace('allowed', 'otherAllowed'),
      );
      assert.notDeepEqual(
        writers.map(({ writer }) => writer.hash),
        changedWriters.map(({ writer }) => writer.hash),
      );
    }
  });
}

for (const [source, changed] of [
  [
    'function probe() { if (!allowed) return; hub.publishTodoDoc(teamId, doc); }',
    'function probe() { if (!otherAllowed) return; hub.publishTodoDoc(teamId, doc); }',
  ],
  [
    'function probe() { if (!allowed) throw Error(); hub.publishTodoDoc(teamId, doc); }',
    'function probe() { if (!otherAllowed) throw Error(); hub.publishTodoDoc(teamId, doc); }',
  ],
  [
    "switch (value) { case 'a': case 'b': hub.publishTodoDoc(teamId, doc); }",
    "switch (value) { case 'b': hub.publishTodoDoc(teamId, doc); }",
  ],
  [
    "switch (value) { case 'a': break; case 'b': hub.publishTodoDoc(teamId, doc); }",
    "switch (value) { case 'a': case 'b': hub.publishTodoDoc(teamId, doc); }",
  ],
  [
    'try { hub.publishTodoDoc(teamId, doc); } catch {}',
    'try {} catch { hub.publishTodoDoc(teamId, doc); }',
  ],
  [
    'try { hub.publishTodoDoc(teamId, doc); } finally {}',
    'try {} finally { hub.publishTodoDoc(teamId, doc); }',
  ],
]) {
  test(`control-flow reachability changes invalidate the fingerprint: ${source}`, () => {
    const path = 'apps/server/src/reachability-probe.ts';
    const known = violationKeys(accessFindings(path, source));
    const findings = accessFindings(path, changed);
    const [key] = allowanceDiff(known, violationKeys(findings)).unexpected;
    assert.ok(key);
    assertRejected(known, findings, key);
  });
}

test('the deployed hub publication rejects a changed guard without changing its call', () => {
  const path = 'apps/server/src/services/todos.ts';
  const source = read(path);
  const changed = source.replace('if (record && changed.length > 0)', 'if (record)');
  assert.notEqual(changed, source);
  const known = violationKeys(accessFindings(path, source));
  const findings = accessFindings(path, changed);
  const key = allowanceDiff(known, violationKeys(findings)).unexpected.find((key) =>
    key.includes('hub-invocation | setTodoPhase:publication'),
  );
  assert.ok(key);
  assertRejected(known, findings, key);
});

test('filesystem byte operations follow descriptor and handle bindings but not unrelated writers', () => {
  const path = 'apps/daemon/src/file-handle-probe.ts';
  const source = `
    import { writeSync as put } from 'node:fs';
    import { open } from 'node:fs/promises';
    async function store(fd, bytes, socket) {
      const alias = put;
      alias(fd, bytes);
      const handle = await open(path, 'w');
      await handle.write(bytes, 0);
      socket.write(bytes, 0);
    }
  `;
  const original = accessFindings(path, source).filter(
    (row) => row.rule === 'filesystem-invocation',
  );
  assert.equal(original.length, 3);
  const known = violationKeys(original);
  const edit = (before, after) =>
    accessFindings(path, source.replace(before, after)).filter(
      (row) => row.rule === 'filesystem-invocation',
    );
  assert.deepEqual(violationKeys(edit('socket.write(bytes, 0)', 'socket.write(bytes, 1)')), known);
  for (const findings of [
    edit('alias(fd, bytes)', 'alias(fd, bytes, 1)'),
    edit('handle.write(bytes, 0)', 'handle.write(bytes, 1)'),
  ]) {
    const [key] = allowanceDiff(known, violationKeys(findings)).unexpected;
    assert.ok(key);
    assertRejected(known, findings, key);
  }
});

test('deployed legacy network handoffs, Git primitives, child transports and database opens are inventoried', () => {
  for (const [path, rule, symbol] of [
    ['apps/server/src/index.ts', 'network-handoff', 'machine'],
    [
      'apps/server/src/services/build-merge-request.ts',
      'process-invocation',
      'requestMerge:git.listBranches',
    ],
    [
      'apps/daemon/src/backend/mcp-stdio-client.ts',
      'process-invocation',
      'openStdioToolClient:StdioClientTransport',
    ],
    ['apps/daemon/src/computer/owner-chrome.ts', 'process-invocation', 'openStdioToolClient'],
    ['apps/server/src/index.ts', 'sqlite-open', 'opened:openDbWithHandle'],
    ['apps/server/src/reliability-report-cli.ts', 'sqlite-open', 'openReliabilityReportDb'],
    ['apps/server/src/db/seed.ts', 'sql-dependency', './client.js'],
  ]) {
    const key = violationKeys(
      baselineFindings().filter(
        (row) =>
          row.path === path &&
          row.rule === rule &&
          (row.location === symbol || row.location.endsWith(`:${symbol}`)),
      ),
    )[0];
    assert.ok(key, `${path}: ${symbol}`);
    assertRejected(
      allowlist.filter((row) => row !== key),
      baselineFindings(),
      key,
    );
  }
});

test('redirecting either screen stream handoff invalidates its allowance', () => {
  const path = 'apps/server/src/services/computer-screen.ts';
  const source = read(path);
  const handoffs = (text) =>
    accessFindings(path, text).filter(
      ({ rule, location }) =>
        rule === 'network-invocation' && location.startsWith('ComputerScreenGateway.pair:'),
    );
  const known = violationKeys(handoffs(source));
  assert.equal(known.length, 2);
  for (const key of known) assert.ok(allowlist.includes(key));
  for (const side of ['viewerStream', 'machineStream']) {
    const changed = source.replace(`.pipe(channel.${side})`, '.pipe(alternateStream)');
    assert.notEqual(changed, source);
    const findings = handoffs(changed);
    const { unexpected } = allowanceDiff(known, violationKeys(findings));
    assert.ok(unexpected.length, side);
    for (const key of unexpected) assertRejected(known, findings, key);
  }
});

test('stream helpers and Web Stream handoffs fingerprint their destinations', () => {
  const path = 'apps/server/src/stream-probe.ts';
  const source = `
    import { compose } from 'node:stream';
    import { pipeline as forward } from 'node:stream/promises';
    import { z } from 'zod';
    function relay(readable: ReadableStream, writable: WritableStream, transform: TransformStream) {
      forward(readable, writable);
      compose(readable, writable);
      readable.pipeTo(writable);
      readable.pipeThrough(transform);
    }
    function relayNode(source, socket) {
      const forwardTo = source.pipe.bind(source);
      forwardTo(socket);
    }
    const unrelated = { pipeline() {} };
    unrelated.pipeline();
    const schema = z.string();
    schema.pipe(z.string());
  `;
  const handoffs = (text) =>
    accessFindings(path, text).filter(({ rule }) => rule === 'network-invocation');
  const known = violationKeys(handoffs(source));
  assert.equal(known.length, 5);
  for (const target of [
    'forward(readable, writable)',
    'compose(readable, writable)',
    'pipeTo(writable)',
    'pipeThrough(transform)',
    'forwardTo(socket)',
  ]) {
    const changed = source.replace(target, target.replace(/\w+\)$/, 'otherDestination)'));
    const findings = handoffs(changed);
    const { unexpected } = allowanceDiff(known, violationKeys(findings));
    assert.equal(unexpected.length, 1, target);
    assertRejected(known, findings, unexpected[0]);
  }
});

test('Drizzle opens via filename and connection options are independently fingerprinted', () => {
  const path = 'apps/server/src/db/open-probe.ts';
  const source = `
    import { drizzle } from 'drizzle-orm/better-sqlite3';
    const file = drizzle('fixture.db');
    const options = drizzle({ connection: 'fixture.db' });
  `;
  const original = accessFindings(path, source).filter((row) => row.rule === 'sqlite-open');
  const known = violationKeys(original);
  assert.equal(known.length, 2);
  const findings = accessFindings(
    path,
    source.replace("connection: 'fixture.db'", "connection: 'other.db'"),
  ).filter((row) => row.rule === 'sqlite-open');
  const [key] = allowanceDiff(known, violationKeys(findings)).unexpected;
  assert.ok(key);
  assertRejected(known, findings, key);
});

test('the operational inventory distinguishes all deployment lease write statements', () => {
  const path = 'scripts/ops/deploy-self.sh';
  const source = read(path);
  const writes = (source) =>
    accessFindings(path, source).filter((row) => row.location === 'deploy-sql-write');
  const known = violationKeys(writes(source));
  assert.equal(known.length, 3);
  const changed = source.replace(
    'status=excluded.status,expiresAt=excluded.expiresAt',
    'status=excluded.status,expiresAt=0',
  );
  assert.notEqual(changed, source);
  const findings = writes(changed);
  const drift = allowanceDiff(known, violationKeys(findings));
  assert.equal(drift.unexpected.length, known.length);
  for (const key of drift.unexpected) assertRejected(known, findings, key);
});

test('equivalent protected trees reuse the same completed inventory', () => {
  const path = 'apps/server/src/services/computer-screen.ts';
  const changes = new Map([
    ['scripts/fixture-tool.mjs', "import { openSync } from 'node:fs';"],
    [path, read(path)],
  ]);
  assert.strictEqual(inventoryFindings(root, changes) === baselineFindings(), true);
  enforceAllowlist(allowlist, baselineFindings());
});

for (const [path, before, after] of [
  [
    'apps/server/src/services/coordinator-turn-snapshot.ts',
    "status = 'sealed'",
    "status = 'running'",
  ],
  ['apps/server/src/services/attachment-gc.ts', 'limit 128', 'limit 129'],
]) {
  test(`editing raw SQL in ${path} invalidates the query allowance`, () => {
    const source = read(path);
    const edited = source.replace(before, after);
    assert.notEqual(edited, source);
    const known = violationKeys(accessFindings(path, source));
    const findings = accessFindings(path, edited);
    const { unexpected } = allowanceDiff(known, violationKeys(findings));
    const changed = unexpected.find((key) => key.includes(' | sql-invocation | '));
    assert.ok(changed, 'raw SQL edit escaped the source gate');
    assertRejected(known, findings, changed);
  });
}

test('every installed database method has a rejecting fingerprint in both protected roots', (t) => {
  const surfaces = databaseMethodSurfaces();
  const probes = surfaces.flatMap(({ path, surface, typeArguments, methods }) => {
    const module = path.includes('drizzle-orm/')
      ? path.replace('node_modules/', '').replace(/\.d\.ts$/, '')
      : path.includes('better-sqlite3')
        ? 'better-sqlite3'
        : 'node:sqlite';
    const args =
      typeArguments && module.startsWith('drizzle-orm')
        ? `<${Array(typeArguments).fill('never').join(', ')}>`
        : '';
    return methods.map((method) => ({
      name: `${surface}_${method}`,
      line: `function ${surface}_${method}(handle: import('${module}').${surface}${args}) { handle['${method}']('SELECT 42'); }`,
    }));
  });
  for (const method of [
    'run',
    'all',
    'get',
    'values',
    'execute',
    'exec',
    'prepare',
    'iterate',
    'transaction',
  ]) {
    assert.ok(
      surfaces.some(({ methods }) => methods.includes(method)),
      `Missing driver method: ${method}`,
    );
  }
  const source = probes.map(({ line }) => line).join('\n');
  const overrides = new Map(
    ['server', 'daemon'].map((app) => [`apps/${app}/src/driver-inventory-probe.ts`, source]),
  );
  const gateFindings = sourceTreeFindings(overrides).filter(
    ({ rule }) => rule === 'sql-invocation',
  );
  for (const path of overrides.keys()) {
    assert.ok(isProtectedSource(path));
    const found = gateFindings.filter((row) => row.path === path);
    assert.deepEqual(
      found.map(({ location }) => location).sort(),
      probes.map(({ name }) => `${name}:query-or-mutation`).sort(),
      path,
    );
    const keys = violationKeys(found);
    for (const key of keys)
      assertRejected(
        keys.filter((row) => row !== key),
        found,
        key,
      );
  }
  t.diagnostic(`${probes.length} installed declaration methods × ${overrides.size} source roots`);
});

test('database fingerprints cover prepared statements, transaction execution and aliases without matching unrelated methods', () => {
  const path = 'apps/daemon/src/driver-inventory-probe.ts';
  const source = `
    import type SQLite from 'better-sqlite3';
    import type { DatabaseSync } from 'node:sqlite';
    import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
    export function raw(native: DatabaseSync, better: SQLite.Database) {
      const statement = native.prepare('SELECT ?');
      statement.run(1);
      native.prepare('SELECT ?').get(2);
      const { iterate } = statement;
      iterate(3);
      const read = statement.all.bind(statement);
      read(4);
      native.createTagStore().get\`SELECT \${5}\`;
      const settle = better.transaction((id: number) => better.prepare('SELECT ?').all(id));
      settle(6);
      settle.immediate(7);
      better.transaction(() => 8).exclusive();
      new Map().get(1);
      /SELECT/.exec('SELECT 1');
    }
    export function drizzle(handle: BaseSQLiteDatabase<'sync', unknown, never, never>) {
      handle.transaction((tx) => tx.values('SELECT 10'));
    }
  `;
  const known = violationKeys(accessFindings(path, source));
  for (const literal of [
    'run(1)',
    'get(2)',
    'iterate(3)',
    'read(4)',
    `SELECT \${5}`,
    'settle(6)',
    'immediate(7)',
    '=> 8',
    'SELECT 10',
  ]) {
    const changed = source.replace(literal, literal.replace(/\d+/, '99'));
    assert.notEqual(changed, source, literal);
    const findings = accessFindings(path, changed);
    const key = allowanceDiff(known, violationKeys(findings)).unexpected.find((row) =>
      row.includes(' | sql-invocation | '),
    );
    assert.ok(key, literal);
    assertRejected(known, findings, key);
  }
  const unrelated = source
    .replace('new Map().get(1)', 'new Map().get(2)')
    .replace("exec('SELECT 1')", "exec('SELECT 2')");
  enforceAllowlist(known, accessFindings(path, unrelated));
});

test('changing bound query values and prepared method aliases changes the database identity', () => {
  const path = 'apps/server/src/sql-binding-probe.ts';
  const source = `
    import { sql } from 'drizzle-orm';
    function read(db: import('node:sqlite').DatabaseSync) {
      const query = sql\`SELECT \${42}\`;
      db.prepare(query);
      const statement = db.prepare('SELECT ?');
      const readRow = statement.get;
      readRow(1);
    }
  `;
  const known = violationKeys(accessFindings(path, source));
  for (const changed of [
    source.replace('42', '43'),
    source.replace('statement.get;', 'statement.all;'),
  ]) {
    const findings = accessFindings(path, changed);
    const key = allowanceDiff(known, violationKeys(findings)).unexpected.find((row) =>
      row.includes(' | sql-invocation | '),
    );
    assert.ok(key);
    assertRejected(known, findings, key);
  }
});

test('the manifest tracks schema tables and locates classified sources', () => {
  assert.equal(inventory.format, 3);
  assert.ok(validateInventoryShape(inventory, baselineFindings()));
  assert.deepEqual(inventory.tables, schemaTables(read('apps/server/src/db/schema.ts')));
  const referencedPaths = new Set([
    ...inventory.exactParents.flatMap(({ writers }) => writers),
    ...inventory.files.flatMap(({ paths }) => paths),
    ...inventory.lineage.flatMap(({ writers }) => writers),
    ...inventory.lineageOperations.flatMap(({ writer, readers, persistedOutputs = {} }) =>
      [writer, ...readers, ...Object.values(persistedOutputs).flat()].map(({ path }) => path),
    ),
    ...inventory.callerChosenIdentifiers.flatMap(({ writers }) => writers),
    ...inventory.admission.flatMap(({ paths }) => paths),
    ...inventory.consumers.flatMap(({ locations }) => locations),
    ...inventory.jobs.flatMap(({ paths }) => paths),
    ...inventory.operational.flatMap(({ paths }) => paths),
  ]);
  for (const path of referencedPaths) assert.ok(read(path).length > 0, `Empty source file ${path}`);
});

test('the manifest rejects a missing physical foreign key from a multi-parent table', () => {
  const { foreignKeys } = inventory;
  const minimal = { ...inventory, lineageOperations: [] };
  assert.ok(validateInventoryShape(minimal, []));
  for (const table of Object.keys(foreignKeys)) {
    for (const index of foreignKeys[table].keys()) {
      const remaining = foreignKeys[table].filter((_, i) => i !== index);
      const incomplete = { ...foreignKeys, [table]: remaining };
      assert.equal(
        validateInventoryShape({ ...minimal, foreignKeys: incomplete }, []),
        false,
        `${table}[${index}]`,
      );
    }
  }
});

test('a gate verdict requires the exact build and producing build step', () => {
  const edges = new Map(inventory.exactParents.map((edge) => [edge.id, edge]));
  const build = edges.get('gate-verdict-build');
  const producer = edges.get('gate-verdict-producing-step');
  assert.deepEqual(build?.child, ['gate_verdict', 'team_id', 'build_id']);
  assert.deepEqual(build.parent, ['build', 'team_id', 'id']);
  assert.deepEqual(producer?.child, [
    'gate_verdict',
    'team_id',
    { column: 'conversation_kind', literal: 'build' },
    'build_id',
    'step_id',
  ]);
  assert.deepEqual(producer.parent, ['step', 'team_id', 'kind', 'conversation_id', 'id']);
  assert.match(producer.lifecycle, /retire.*before.*delet/i);
  assert.ok(producer.writers.includes('apps/server/src/services/build-gate-verdict.ts'));
});

test('exact-parent tuples reject missing columns on either side of every edge', () => {
  for (const edge of inventory.exactParents) {
    for (const side of ['child', 'parent']) {
      const incomplete = {
        ...inventory,
        exactParents: [{ ...edge, [side]: edge[side].slice(0, -1) }],
      };
      assert.equal(
        validateInventoryShape(incomplete, baselineFindings()),
        false,
        `${edge.id}: ${side}`,
      );
    }
  }
});

test('fixed conversation kinds are explicit child columns with literal values', () => {
  for (const [id, literal] of [
    ['build-registration', 'build'],
    ['chief-registration', 'chief'],
    ['schedule-run-step', 'build'],
    ['plan-step', 'build'],
    ['coordinator-snapshot-step', 'chief'],
    ['memory-attempt-step', 'chief'],
  ]) {
    const edge = inventory.exactParents.find((edge) => edge.id === id);
    const kindIndex = edge.parent.indexOf('kind');
    assert.deepEqual(edge.child[kindIndex], { column: 'conversation_kind', literal }, id);
    assert.equal(edge.child.length, edge.parent.length, id);
    const isolated = { ...inventory, exactParents: [edge] };
    assert.equal(validateInventoryShape(isolated, baselineFindings()), true, id);
    for (const invalid of [
      null,
      {},
      { literal },
      { column: 'conversation_kind' },
      { column: 'invalid column', literal },
      { column: 'conversation_kind', literal: '' },
      { column: 'conversation_kind', literal: {} },
    ]) {
      const child = [...edge.child];
      child[kindIndex] = invalid;
      assert.equal(
        validateInventoryShape(
          { ...isolated, exactParents: [{ ...edge, child }] },
          baselineFindings(),
        ),
        false,
        `${id}: ${JSON.stringify(invalid)}`,
      );
    }
  }
});

test('a nested receipt requires the exact task even when both other receipt edges match', () => {
  const edges = new Map(inventory.exactParents.map((edge) => [edge.id, edge]));
  const exactBuild = edges.get('receipt-nested-build-task');
  assert.ok(exactBuild, 'Missing exact task-to-build binding for nested receipts');
  assert.deepEqual(exactBuild.child, ['client_message', 'team_id', 'task_id', 'root_id']);
  assert.deepEqual(exactBuild.parent, ['build', 'team_id', 'todo_id', 'id']);

  const receipt = {
    team_id: 'team-a',
    task_id: 'task-a',
    operation: 'build-send',
    root_id: 'build-a',
    outer_receipt_id: 'receipt-a',
  };
  const outer = { team_id: receipt.team_id, task_root_id: receipt.task_id, id: 'receipt-a' };
  const build = {
    team_id: receipt.team_id,
    todo_id: receipt.task_id,
    operation: receipt.operation,
    id: receipt.root_id,
  };
  const wrongTaskBuild = { ...build, todo_id: 'task-b' };
  const tuple = (columns, row) => columns.slice(1).map((column) => row[column]);
  const buildRoot = edges.get('receipt-build-root');
  const nesting = edges.get('receipt-nesting');
  assert.deepEqual(tuple(buildRoot.child, receipt), tuple(buildRoot.parent, wrongTaskBuild));
  assert.deepEqual(tuple(nesting.child, receipt), tuple(nesting.parent, outer));
  assert.deepEqual(tuple(exactBuild.child, receipt), tuple(exactBuild.parent, build));
  assert.notDeepEqual(tuple(exactBuild.child, receipt), tuple(exactBuild.parent, wrongTaskBuild));
});

test('a nested receipt may lack only the outer receipt link before the outer commit', () => {
  const nesting = inventory.exactParents.find(({ id }) => id === 'receipt-nesting');
  assert.deepEqual(nesting.child, ['client_message', 'team_id', 'task_id', 'outer_receipt_id']);
  assert.deepEqual(nesting.parent, ['client_message', 'team_id', 'task_root_id', 'id']);
  assert.deepEqual(nesting.nullable, {
    column: 'outer_receipt_id',
    until: 'outer-receipt-commit',
  });
  assert.match(nesting.variant, /nested receipt can commit before the outer receipt exists/i);
  assert.match(nesting.lifecycle, /bind.*in the transaction that commits the outer receipt/i);
  const exactBuild = inventory.exactParents.find(({ id }) => id === 'receipt-nested-build-task');
  assert.equal(exactBuild.nullable, undefined);
  assert.match(
    exactBuild.variant,
    /^Mandatory for every nested build-send receipt, including before the outer receipt commits\b/,
  );
});

test('Coordinator inputs, producing steps and runs carry the same exact session binding', () => {
  const edges = new Map(inventory.exactParents.map((edge) => [edge.id, edge]));
  for (const owner of ['input', 'run']) {
    const session = edges.get(`coordinator-${owner}-session`);
    assert.deepEqual(session.child, [
      `coordinator_${owner}`,
      'team_id',
      'thread_id',
      'session_id',
      'store_generation',
    ]);
    assert.deepEqual(session.parent, [
      'coordinator_session',
      'team_id',
      'thread_id',
      'id',
      'store_generation',
    ]);
    const producer = edges.get(`coordinator-${owner}-producing-step`);
    assert.deepEqual(producer.child, [
      `coordinator_${owner}`,
      'team_id',
      'conversation_kind',
      'thread_id',
      'step_id',
    ]);
    assert.deepEqual(producer.parent, ['step', 'team_id', 'kind', 'conversation_id', 'id']);
  }
  const lineage = edges.get('coordinator-run-input');
  const binding = ['team_id', 'thread_id', 'session_id', 'store_generation', 'step_id'];
  const attempt = edges.get('coordinator-attempt-input');
  assert.deepEqual(attempt.child, ['coordinator_input_attempt', ...binding, 'input_id']);
  assert.deepEqual(attempt.parent, ['coordinator_input', ...binding, 'id']);
  assert.deepEqual(lineage.child, [
    'coordinator_run_input',
    ...binding,
    'input_id',
    'input_attempt',
  ]);
  assert.deepEqual(lineage.parent, [
    'coordinator_input_attempt',
    ...binding,
    'input_id',
    'attempt',
  ]);
});

test('Coordinator run lineage names the replay consumer and separates the input checks', () => {
  const operation = inventory.lineageOperations.find(({ id }) => id === 'coordinator-run-producer');
  assert.ok(operation);
  assert.deepEqual(operation.readers, [
    { path: 'apps/server/src/services/coordinator-runs.ts', symbol: 'coordinatorRuns' },
    {
      path: 'apps/server/src/coordinator/runtime/input-replay.ts',
      symbol: 'replayCoordinatorInputs',
    },
  ]);
  assert.match(operation.historicalEnforcement, /runtime.*accepted input submission.*entry/i);
  assert.match(
    operation.historicalEnforcement,
    /bindCoordinatorRun.*consumed only for the current attempt/,
  );
  assert.match(operation.outputs.join('\n'), /transcript rows.*producing step/);
});

test('watchdog and task-send lineage identify concrete scoped inputs and effects', () => {
  const operations = new Map(
    inventory.lineageOperations.map((operation) => [operation.id, operation]),
  );
  const watchdog = operations.get('watchdog-repeated-failure-snippet');
  assert.ok(watchdog);
  assert.deepEqual(watchdog.writer, {
    path: 'apps/server/src/services/notifications.ts',
    symbol: 'upsertAndPublish',
  });
  assert.deepEqual(
    watchdog.readers.map(({ symbol }) => symbol),
    [
      'gateReason',
      'sweepWorkerWatchdog',
      'raiseConditionNotices',
      'notifyWatchdogFlag',
      'toNotificationRecord',
      'publishNotification',
    ],
  );
  assert.match(watchdog.inputs.join('\n'), /build\.errorMessage/);
  assert.match(watchdog.outputs.join('\n'), /notification\.snippet/);
  assert.match(watchdog.outputs.join('\n'), /publication/);
  assert.match(watchdog.scopeKey.join('\n'), /team.*task.*build/i);
  assert.match(watchdog.evidence, /source build revisions.*published/i);

  const verdict = operations.get('watchdog-gate-verdict-snippet');
  assert.ok(verdict);
  assert.match(verdict.inputs.join('\n'), /gate_verdict/);
  assert.match(verdict.outputs.join('\n'), /notification\.snippet/);

  const receipt = operations.get('task-send-receipt-replay');
  assert.ok(receipt);
  assert.match(receipt.scopeKey.join('\n'), /team.*operation.*root.*client message/i);
  assert.match(receipt.evidence, /build belongs to the exact task/i);
});

test('omitting the shared notice fingerprint writer fails the lineage gate for either watchdog operation', () => {
  const ids = ['watchdog-repeated-failure-snippet', 'watchdog-gate-verdict-snippet'];
  for (const id of ids) {
    const omitted = {
      ...inventory,
      lineageOperations: inventory.lineageOperations.map((operation) => {
        if (operation.id !== id || !operation.persistedOutputs) return operation;
        const field = 'notice_mark.fingerprint';
        return {
          ...operation,
          persistedOutputs: { ...operation.persistedOutputs, [field]: [operation.writer] },
        };
      }),
    };
    assert.equal(validateInventoryShape(omitted, baselineFindings()), false, id);
  }
  const path = 'apps/server/src/services/notifications.ts';
  const extra = accessFindings(
    path,
    `
    import { noticeMark as mark } from '../db/schema.js';
    function extraWriter(db, value) {
      db.update(mark).set({ fingerprint: value }).run();
    }
  `,
  );
  const combined = [...baselineFindings(), ...extra];
  assert.equal(validateInventoryShape(inventory, combined), false);
});

for (const source of [
  'CREATE TABLE client_message (scopeId TEXT UNIQUE ON CONFLICT REPLACE, response);',
  'CREATE TABLE client_message (scopeId TEXT, response, PRIMARY KEY(scopeId) ON CONFLICT REPLACE);',
  'CREATE TEMP TABLE client_message (scopeId TEXT PRIMARY KEY ON CONFLICT REPLACE, response);',
]) {
  test(`DDL conflict actions are not mistaken for SQL writes: ${source}`, () => {
    const db = new DatabaseSync(':memory:');
    try {
      assert.doesNotThrow(() => db.exec(source));
    } finally {
      db.close();
    }
    assert.deepEqual(sqliteWrites(source), []);
    assert.deepEqual(migrationWriterFindings('apps/server/drizzle/ddl-probe.sql', source), []);
  });
}

test('SQL INSERT target columns stop at the closing delimiter and decode quoted identifiers', () => {
  for (const columns of [
    ['scopeId'],
    ['scopeId', 'response'],
    ['scopeId', 'response', 'teamId'],
    ['"WHERE"', '`response`', '[scopeId]', '"a""b"', '`a``b`'],
    ["'response'", "'a''b'"],
  ]) {
    const [insert, update] = sqliteWrites(`
      INSERT INTO client_message (${columns.join(', ')}) SELECT value FROM source WHERE ready;
      UPDATE notice_mark SET fingerprint = 'fixture';
    `);
    assert.deepEqual(
      [...insert.columns],
      columns.map(
        (column) =>
          ({
            '"WHERE"': 'WHERE',
            '`response`': 'response',
            '[scopeId]': 'scopeId',
            '"a""b"': 'a"b',
            '`a``b`': 'a`b',
            "'response'": 'response',
            "'a''b'": "a'b",
          })[column] ?? column,
      ),
    );
    assert.equal(insert.statement.includes('UPDATE'), false);
    assert.deepEqual([...update.columns], ['fingerprint']);
  }
  const [unfinished, next] = sqliteWrites(
    'INSERT INTO client_message (scopeId, response; UPDATE notice_mark SET fingerprint = 1;',
  );
  assert.deepEqual([...unfinished.columns], ['scopeId', 'response']);
  assert.deepEqual([...next.columns], ['fingerprint']);
});

for (const [label, source] of [
  ['not-indexed', 'UPDATE client_message NOT INDEXED SET response = 1;'],
  ['indexed-by', 'UPDATE client_message INDEXED BY receipt_index SET response = 1;'],
  ['cte-update', 'WITH input AS (SELECT 1) UPDATE client_message NOT INDEXED SET response = 1;'],
  [
    'trigger-update',
    'CREATE TRIGGER probe AFTER INSERT ON sample BEGIN UPDATE client_message NOT INDEXED SET response = 1; END;',
  ],
  ['delete', 'DELETE FROM client_message NOT INDEXED WHERE scopeId = 1;'],
  ['replace', 'REPLACE INTO client_message (response) VALUES (1);'],
  ['implicit-columns', 'INSERT INTO client_message VALUES (1, 2);'],
  [
    'qualified-alias',
    'UPDATE OR REPLACE main."client_message" AS receipt INDEXED BY receipt_index SET response = 1;',
  ],
  [
    'case-assignment',
    'UPDATE client_message SET scopeId = CASE WHEN 1 THEN 1 ELSE 2 END, response = 1;',
  ],
  ['cte-delete', 'WITH input AS (SELECT 1) DELETE FROM client_message WHERE scopeId = 1;'],
  [
    'trigger-delete',
    'CREATE TRIGGER probe AFTER UPDATE ON sample BEGIN DELETE FROM client_message WHERE scopeId = 1; END;',
  ],
]) {
  test(`lineage fails closed for the ${label} write form`, () => {
    const findings = migrationWriterFindings('apps/server/drizzle/write-probe.sql', source);
    assert.ok(
      findings.some(({ field }) => field === 'client_message.response'),
      source,
    );
    assert.equal(validateInventoryShape(inventory, baselineFindings()), true);
    assert.equal(validateInventoryShape(inventory, [...baselineFindings(), ...findings]), false);
  });
}

for (const source of [
  'UPDATE client_message SET scopeId = 1 IS DISTINCT FROM 2, response = 3;',
  'UPDATE client_message SET scopeId = 1 IS NOT DISTINCT FROM 2, response = 3;',
  'UPDATE client_message SET scopeId = CASE WHEN 1 IS DISTINCT FROM 2 THEN 1 ELSE 2 END, response = 3;',
  'UPDATE client_message SET scopeId = CASE WHEN 1 IS NOT DISTINCT FROM 2 THEN 1 ELSE 2 END, response = 3;',
  'UPDATE client_message SET scopeId = 1 IS DISTINCT FROM 2, response = 3 FROM source WHERE 1;',
  'WITH input AS (SELECT 1) UPDATE client_message SET scopeId = 1 IS DISTINCT FROM 2, response = 3;',
  'CREATE TRIGGER probe AFTER INSERT ON source BEGIN UPDATE client_message SET scopeId = 1 IS DISTINCT FROM 2, response = 3; END;',
  'INSERT INTO client_message (scopeId) VALUES (1) ON CONFLICT DO UPDATE SET scopeId = 1 IS DISTINCT FROM 2, response = 3;',
  'INSERT INTO client_message (scopeId) VALUES (1) ON CONFLICT DO UPDATE SET scopeId = 1 IS NOT DISTINCT FROM 2, response = 3;',
  'UPDATE client_message SET scopeId = :from, response = 3;',
  'UPDATE client_message SET scopeId = @where, response = 3;',
  'UPDATE client_message SET scopeId = :returning, response = 3;',
  'UPDATE client_message SET scopeId = :order, response = 3;',
  'UPDATE client_message SET scopeId = @limit, response = 3;',
  'UPDATE client_message SET scopeId = $from::scope(extra,UPDATE), response = 3;',
  'WITH input AS (SELECT 1) UPDATE client_message SET scopeId = :from, response = 3;',
  'INSERT INTO client_message (scopeId) VALUES (1) ON CONFLICT DO UPDATE SET scopeId = @where, response = 3;',
]) {
  test(`SQL expression tokens do not hide later assignment columns: ${source}`, () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        'CREATE TABLE client_message (scopeId INTEGER PRIMARY KEY, response); CREATE TABLE source (value);',
      );
      assert.doesNotThrow(() => db.exec(source));
    } finally {
      db.close();
    }
    const writes = sqliteWrites(source);
    assert.ok(writes.some(({ columns, resolved }) => resolved && columns.has('response')));
    const findings = migrationWriterFindings('apps/server/drizzle/expression-probe.sql', source);
    assert.ok(findings.some(({ field }) => field === 'client_message.response'));
    assert.equal(validateInventoryShape(inventory, [...baselineFindings(), ...findings]), false);
  });
}

for (const source of [
  'UPDATE client_message USING unsupported SET response = 1;',
  'WITH input AS (SELECT 1) UPDATE client_message USING unsupported SET response = 1;',
  'CREATE TRIGGER probe AFTER INSERT ON sample BEGIN UPDATE client_message USING unsupported SET response = 1; END;',
  'INSERT INTO client_message (response, scopeId VALUES (1, 2);',
  'INSERT INTO client_message (response) VALUES (1) ON CONFLICT DO UPDATE USING unsupported SET response = 2;',
  'UPDATE client_message SET (response, scopeId = (1, 2);',
  'UPDATE client_message SET response = 1, unsupported;',
  'REPLACE INTO client_message USING unsupported;',
  'DELETE client_message WHERE scopeId = 1;',
  'UPSERT client_message SET response = 1;',
  'UPDATE ONLY client_message SET response = 1;',
  'UPDATE client_message SET response = ? WHERE scopeId = ? RETURNING response; UPDATE client_message USING unsupported SET response = 2;',
]) {
  test(`unresolved audited SQL names and rejects its statement: ${source}`, () => {
    assert.throws(
      () => migrationWriterFindings('apps/server/drizzle/write-probe.sql', source),
      (error) => {
        assert.match(error.message, /Unresolved SQL write.*client_message/);
        assert.ok(
          error.message.includes(sqliteWrites(source).find(({ resolved }) => !resolved).statement),
        );
        return true;
      },
    );
    assert.throws(
      () =>
        accessFindings(
          'apps/server/src/write-probe.ts',
          `function write(db: import('node:sqlite').DatabaseSync) { db.exec(${JSON.stringify(source)}); }`,
        ),
      /Unresolved SQL write.*client_message/,
    );
  });
}

test('SQL INSERT conflict updates are separate writers bounded by their statement', () => {
  for (const body of ["SELECT 'root' ON CONFLICT", 'VALUES (\'root\') ON CONFLICT ("scopeId")']) {
    for (const targets of [
      '"response" = excluded."response", [teamId] = \'team\'',
      '("response", [teamId]) = (excluded."response", \'team\')',
      "'response' = excluded.response, 'teamId' = 'team'",
      "('response', 'teamId') = (excluded.response, 'team')",
    ]) {
      const writes = sqliteWrites(`
        INSERT INTO "client_message" ("scopeId") ${body} DO UPDATE SET ${targets};
        INSERT INTO notice_mark (id, fingerprint) VALUES ('mark', 'fixture');
      `);
      assert.deepEqual(
        writes.map(({ table, columns, symbol }) => ({ table, columns: [...columns], symbol })),
        [
          { table: 'client_message', columns: ['scopeId'], symbol: 'INSERT INTO "client_message"' },
          {
            table: 'client_message',
            columns: ['response', 'teamId'],
            symbol: 'INSERT INTO "client_message" ON CONFLICT DO UPDATE',
          },
          {
            table: 'notice_mark',
            columns: ['id', 'fingerprint'],
            symbol: 'INSERT INTO notice_mark',
          },
        ],
      );
      assert.equal(writes[0].statement, writes[1].statement);
      assert.equal(writes[1].statement.includes('notice_mark'), false);
    }
  }
});

test('SQL string values are not treated as assignment targets', () => {
  const [write] = sqliteWrites(
    "UPDATE client_message SET 'scopeId' = 'response', 'a''b' = 'fixture';",
  );
  assert.deepEqual([...write.columns], ['scopeId', "a'b"]);
  assert.deepEqual(
    sqliteWrites("SELECT 'response', 'UPDATE client_message SET response = 1';"),
    [],
  );
});

for (const [label, source, expectedOperation] of [
  [
    'single-quoted-column',
    "INSERT INTO client_message ('scopeId', 'response') SELECT 'root', 'fixture';",
    'INSERT INTO client_message (scopeId, response)',
  ],
  [
    'single-quoted-conflict-update',
    "INSERT INTO client_message (scopeId) VALUES ('root') ON CONFLICT DO UPDATE SET 'response' = 'fixture';",
    'INSERT INTO client_message ON CONFLICT DO UPDATE (response)',
  ],
  [
    'single-quoted-conflict-tuple',
    "INSERT INTO client_message (scopeId) VALUES ('root') ON CONFLICT DO UPDATE SET ('response', 'scopeId') = ('fixture', 'root');",
    'INSERT INTO client_message ON CONFLICT DO UPDATE (response, scopeId)',
  ],
  [
    'last-column',
    "INSERT INTO client_message (scopeId, response) SELECT 'root', 'fixture';",
    'INSERT INTO client_message (scopeId, response)',
  ],
  [
    'conflict-update',
    "INSERT INTO client_message (scopeId) SELECT 'root' ON CONFLICT DO UPDATE SET response = 'fixture';",
    'INSERT INTO client_message ON CONFLICT DO UPDATE (response)',
  ],
]) {
  test(`lineage rejects an unlisted INSERT ${label} writer`, () => {
    const path = 'apps/server/drizzle/insert_writer_probe.sql';
    const findings = migrationWriterFindings(path, source);
    const responseWriters = findings.filter(({ field }) => field === 'client_message.response');
    assert.deepEqual(
      responseWriters.map(({ writer }) => writer.operation),
      [expectedOperation],
    );
    const operation = inventory.lineageOperations.find(
      ({ id }) => id === 'task-send-receipt-replay',
    );
    const isolated = { ...inventory, lineageOperations: [operation] };
    assert.equal(validateInventoryShape(isolated, baselineFindings()), true);
    assert.equal(validateInventoryShape(isolated, [...baselineFindings(), ...findings]), false);
  });
}

test('lineage rejects a receipt response changed by a transitive table rebuild', () => {
  const path = 'apps/server/drizzle/receipt-rebuild-probe.sql';
  const ddl = read('apps/server/drizzle/0101_client_message.sql');
  const copy = `INSERT INTO [receipt_stage] (scopeId, clientMessageId, response, createdAt)
    SELECT scopeId, clientMessageId, 'changed response', createdAt FROM client_message;`;
  const migration = `
    ${ddl.replace('`client_message`', '`receipt_stage`')}
    ${copy}
    DROP TABLE client_message;
    ALTER TABLE main.[receipt_stage] RENAME TO "Receipt_Copy";
    ALTER TABLE receipt_copy RENAME TO client_message;
  `;
  using db = new DatabaseSync(':memory:');
  db.exec(ddl);
  db.exec("INSERT INTO client_message VALUES ('root', 'send', 'saved response', 1);");
  db.exec(migration);
  assert.equal(
    db.prepare('SELECT response FROM client_message').get().response,
    'changed response',
  );

  const responseWriters = (sql) =>
    migrationWriterFindings(path, sql).filter(({ field }) => field === 'client_message.response');
  const findings = responseWriters(migration);
  assert.deepEqual(
    findings.map(({ writer }) => writer.operation),
    ['INSERT INTO [receipt_stage] (scopeId, clientMessageId, response, createdAt)'],
  );
  assert.deepEqual(responseWriters(copy), []);
  assert.deepEqual(
    responseWriters(migration.replaceAll(', response,', ',').replace(", 'changed response',", ',')),
    [],
  );
  const operation = inventory.lineageOperations.find(({ id }) => id === 'task-send-receipt-replay');
  const isolated = { ...inventory, lineageOperations: [operation] };
  assert.equal(validateInventoryShape(isolated, baselineFindings()), true);
  assert.equal(validateInventoryShape(isolated, [...baselineFindings(), ...findings]), false);
  const changed = responseWriters(migration.replace('changed response', 'different response'));
  assert.notEqual(changed[0].writer.hash, findings[0].writer.hash);
});

for (const [verb, policy] of [
  ['REPLACE', ''],
  ['INSERT OR REPLACE', ''],
  ['INSERT', 'ON CONFLICT REPLACE'],
]) {
  test(`lineage rejects a receipt reset by ${policy || verb}`, () => {
    const ddl = read('apps/server/drizzle/0101_client_message.sql').replace(
      'PRIMARY KEY(`scopeId`, `clientMessageId`)',
      `PRIMARY KEY(\`scopeId\`, \`clientMessageId\`) ${policy}`,
    );
    const replace = `${verb} INTO client_message (scopeId, clientMessageId, createdAt) VALUES ('root', 'send', 2);`;
    using db = new DatabaseSync(':memory:');
    db.exec(ddl);
    db.exec("INSERT INTO client_message VALUES ('root', 'send', 'saved response', 1);");
    const receipt = db.prepare(
      "SELECT response FROM client_message WHERE clientMessageId = 'send'",
    );
    assert.equal(receipt.get().response, 'saved response');
    db.exec(replace);
    assert.equal(receipt.get().response, null);

    const path = 'apps/server/drizzle/receipt-replace-probe.sql';
    const findings = migrationWriterFindings(path, `${ddl}\n${replace}`);
    assert.deepEqual(
      findings.map(({ field }) => field).sort(),
      ['clientMessageId', 'createdAt', 'response', 'scopeId'].map(
        (field) => `client_message.${field}`,
      ),
    );
    const operation = inventory.lineageOperations.find(
      ({ id }) => id === 'task-send-receipt-replay',
    );
    const isolated = { ...inventory, lineageOperations: [operation] };
    assert.equal(validateInventoryShape(isolated, baselineFindings()), true);
    assert.equal(validateInventoryShape(isolated, [...baselineFindings(), ...findings]), false);
    if (policy) {
      const changed = inventoryFindings(
        root,
        new Map([
          [
            'apps/server/drizzle/9000_receipt_constraint.sql',
            ddl.replace('`client_message`', '`__new_client_message`'),
          ],
          [
            'apps/server/drizzle/9001_receipt_rename.sql',
            'ALTER TABLE `__new_client_message` RENAME TO `client_message`;',
          ],
          [path, replace],
        ]),
      );
      assert.ok(
        changed.some((row) => row.path === path && row.field === 'client_message.response'),
      );
      assert.equal(validateInventoryShape(isolated, changed), false);
      assert.strictEqual(inventoryFindings(root), baselineFindings());
    }
  });
}

test('historical notice INSERT writers list only their exact destination columns', () => {
  for (const path of [
    'apps/server/drizzle/0247_giant_mimic.sql',
    'apps/server/drizzle/0248_no_machine_reason_marks.sql',
  ]) {
    const insert = sqliteWrites(read(path)).find(({ symbol }) => symbol.startsWith('INSERT'));
    assert.equal(insert.table, 'notice_mark');
    assert.deepEqual(
      [...insert.columns],
      ['id', 'userId', 'condition', 'subjectId', 'fingerprint', 'notedAt'],
    );
  }
});

test('ALTER ADD initializes the named column with explicit or implicit defaults', () => {
  for (const source of [
    "ALTER TABLE main.`agent_memory` ADD COLUMN `history` TEXT DEFAULT '[]';",
    'ALTER TABLE agent_memory ADD history TEXT;',
    "ALTER TABLE agent_memory ADD history TEXT DEFAULT ('[]');",
  ]) {
    const [write] = sqliteWrites(source);
    assert.equal(write.table, 'agent_memory');
    assert.deepEqual([...write.columns], ['history']);
    assert.equal(write.resolved, true);
    assert.ok(
      migrationWriterFindings('apps/server/drizzle/probe.sql', source).some(
        ({ field }) => field === 'agent_memory.history',
      ),
    );
  }
  assert.deepEqual(sqliteWrites('ALTER TABLE agent_memory RENAME TO old_memory;'), []);
});

test('lineage rejects a changed historical memory default', () => {
  const path = 'apps/server/drizzle/0051_memory_dedupe.sql';
  const source = read(path);
  const changed = source.replace("DEFAULT '[]'", "DEFAULT '[1]'");
  assert.notEqual(changed, source);
  const original = migrationWriterFindings(path, source);
  assert.ok(original.some(({ field }) => field === 'agent_memory.history'));
  assert.equal(validateInventoryShape(inventory, baselineFindings()), true);
  const findings = [
    ...baselineFindings().filter((finding) => finding.path !== path),
    ...migrationWriterFindings(path, changed),
  ];
  assert.equal(validateInventoryShape(inventory, findings), false);
});

test('lineage rejects a second migration statement writing the same column', () => {
  const path = 'apps/server/drizzle/0248_no_machine_reason_marks.sql';
  const source = read(path);
  const original = source.split('\n').find((line) => line.startsWith('UPDATE `notice_mark`'));
  assert.ok(original);
  assert.equal(validateInventoryShape(inventory, baselineFindings()), true);
  const edited = original.replace("= 'no_machine'", "= 'fixture'");
  for (const changed of [
    `${source}\n${original}\n`,
    `${source}\n${edited}\n`,
    source.replace(original, edited),
  ]) {
    const findings = [
      ...baselineFindings().filter((finding) => finding.path !== path),
      ...migrationWriterFindings(path, changed),
    ];
    assert.equal(validateInventoryShape(inventory, findings), false);
  }
});

test('lineage rejects a duplicate write within an already inventoried function', () => {
  const path = 'apps/server/src/services/client-message.ts';
  const source = read(path);
  const original = source.match(/db\s*\.update\(clientMessage\)[\s\S]*?\.run\(\);/)?.[0];
  assert.ok(original);
  assert.equal(validateInventoryShape(inventory, baselineFindings()), true);
  const changed = source.replace(original, `${original}\n  ${original}`);
  const findings = [
    ...baselineFindings().filter((finding) => finding.path !== path),
    ...accessFindings(path, changed),
  ];
  assert.equal(validateInventoryShape(inventory, findings), false);
});

const lineageWriterProbes = {
  'watchdog-repeated-failure-snippet': ['noticeMark', 'fingerprint', 'notice_mark.fingerprint'],
  'watchdog-gate-verdict-snippet': ['notification', 'snippet', 'notification.snippet'],
  'task-send-receipt-replay': ['clientMessage', 'response', 'client_message.response'],
  'coordinator-run-producer': ['coordinatorRun', 'stepId', 'coordinator_run.stepId'],
  'coordinator-memory-flush': ['agentMemory', 'history', 'agent_memory.history'],
  'historical-design-version-backfill': [
    'designVersion',
    'attachmentId',
    'design_version.attachmentId',
  ],
  'memory-tool-receipt': ['memoryEditReceipt', 'summary', 'memory_edit_receipt.summary'],
};

for (const operation of inventory.lineageOperations) {
  const { id } = operation;
  test(`lineage writer control: ${id} rejects an unlisted source writer`, () => {
    const [table, column, field] = lineageWriterProbes[id];
    const path = 'apps/server/src/services/inventory-writer-probe.ts';
    const extra = accessFindings(
      path,
      `
      import { ${table} as target } from '../db/schema.js';
      function extraWriter(db, value) { db.update(target).set({ ${column}: value }).run(); }
    `,
    );
    assert.ok(
      extra.some(
        ({ rule, location }) =>
          rule === 'persisted-output-write' && location === `extraWriter:${field}`,
      ),
      `No source writer indexed for ${field}`,
    );
    const isolated = { ...inventory, lineageOperations: [operation] };
    assert.equal(validateInventoryShape(isolated, baselineFindings()), true);
    assert.equal(validateInventoryShape(isolated, [...baselineFindings(), ...extra]), false);
    for (const [field, writers] of Object.entries(operation.persistedOutputs)) {
      const withoutField = structuredClone(operation);
      delete withoutField.persistedOutputs[field];
      assert.equal(
        validateInventoryShape(
          { ...isolated, lineageOperations: [withoutField] },
          baselineFindings(),
        ),
        false,
        `${id}: ${field}`,
      );
      for (const writer of writers) {
        const withoutWriter = structuredClone(operation);
        withoutWriter.persistedOutputs[field] = writers.filter((candidate) => candidate !== writer);
        assert.equal(
          validateInventoryShape(
            { ...isolated, lineageOperations: [withoutWriter] },
            baselineFindings(),
          ),
          false,
          `${id}: ${field} ${writer.symbol}`,
        );
      }
    }
  });
}

test('lineage indexes aliased raw SQL, split builders and upsert conflict updates', () => {
  const path = 'apps/server/src/services/inventory-writer-probe.ts';
  const findings = accessFindings(
    path,
    `
    import { sql } from 'drizzle-orm';
    import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
    import * as schema from '../db/schema.js';
    const receipt = schema.clientMessage;
    type Db = BaseSQLiteDatabase<'sync', unknown, never, never>;
    function prepared(db: import('node:sqlite').DatabaseSync) {
      const query = 'UPDATE client_message SET response = ? WHERE scopeId = ?';
      const statement = db.prepare(query);
      statement.run('value', 'key');
    }
    function raw(db: Db) {
      const runSql = db.run.bind(db);
      runSql(sql\`update \${receipt} set \${sql.identifier(receipt.response.name)} = \${42}\`);
    }
    function split(db: Db) {
      const mutation = db.update(receipt);
      mutation.set({ response: 17 }).run();
    }
    function upsert(db: Db) {
      db.insert(receipt).values({ scopeId: 'root' }).onConflictDoUpdate({ target: receipt.scopeId, set: { response: 18 } }).run();
    }
  `,
  );
  assert.deepEqual(
    findings
      .filter(({ rule }) => rule === 'persisted-output-write')
      .map(({ location }) => location)
      .sort(),
    [
      'prepared:client_message.response',
      'raw:client_message.response',
      'split:client_message.response',
      'upsert:client_message.response',
      'upsert:client_message.scopeId',
    ],
  );
  const operation = inventory.lineageOperations.find(({ id }) => id === 'task-send-receipt-replay');
  const isolated = { ...inventory, lineageOperations: [operation] };
  for (const location of ['prepared', 'raw', 'split', 'upsert']) {
    const extra = findings.filter((finding) => finding.location.startsWith(`${location}:`));
    assert.equal(
      validateInventoryShape(isolated, [...baselineFindings(), ...extra]),
      false,
      location,
    );
  }
});

test('lineage does not accept a raw writer whose SQL cannot be resolved', () => {
  const findings = accessFindings(
    'apps/daemon/src/driver-inventory-probe.ts',
    `
    function unknownWrite(db: import('node:sqlite').DatabaseSync, query: string) {
      db.exec(query);
    }
  `,
  );
  assert.ok(
    findings.some(({ rule, location }) => rule === 'opaque-sql' && location === 'unknownWrite'),
  );
  assert.equal(validateInventoryShape(inventory, [...baselineFindings(), ...findings]), false);
});

test('memory flush and the historical design backfill record actual content movement', () => {
  const operations = new Map(
    inventory.lineageOperations.map((operation) => [operation.writer.symbol, operation]),
  );
  for (const [symbol, input, output] of [
    ['applyFlush', /transcript revisions/, /agent_memory file and index revisions/],
    [
      'INSERT INTO `design_version`',
      /message revisions and their conversation\/build\/task and attachment joins/,
      /design_version task\/page association/,
    ],
  ]) {
    const operation = operations.get(symbol);
    assert.ok(operation, `Missing lineage operation ${symbol}`);
    assert.match(operation.inputs.join('\n'), input);
    assert.match(operation.outputs.join('\n'), output);
  }
  for (const { writer, readers, persistedOutputs = {} } of inventory.lineageOperations) {
    for (const { path, symbol } of [
      writer,
      ...readers,
      ...Object.values(persistedOutputs).flat(),
    ]) {
      assert.ok(
        read(path).includes(symbol.split('.').at(-1)),
        `Missing lineage source ${path}:${symbol}`,
      );
    }
  }
});

test('new, moved, edited, repeated and retired findings are not silently grandfathered', () => {
  const source = "import { openSync as openFixture } from 'node:fs';\nopenFixture(fixturePath);";
  const original = accessFindings('apps/example/adapter.ts', source);
  const known = violationKeys(original);
  assert.equal(original.length, 2);
  assert.deepEqual(allowanceDiff(known, known), noDrift);
  for (const [path, changed] of [
    ['apps/example/other-adapter.ts', source],
    ['apps/example/adapter.ts', source.replaceAll('openFixture', 'openOther')],
    ['apps/example/adapter.ts', `${source}\n${source}`],
    ['apps/example/adapter.ts', "export { openSync as openFixture } from 'node:fs';"],
  ]) {
    const drift = allowanceDiff(known, violationKeys(accessFindings(path, changed)));
    assert.equal(drift.unexpected.length, changed.startsWith('export') ? 1 : 2);
    assert.equal(drift.stale.length, 2);
  }
  assert.deepEqual(allowanceDiff(known, []), { ...noDrift, stale: known });
  assert.deepEqual(allowanceDiff([...known, ...known], known), { ...noDrift, duplicates: known });
  enforceAllowlist([], accessFindings('apps/example/adapter.ts', 'export const fixture = 1;'));
});

test('relative raw re-exports retain their classification at a downstream import', () => {
  const consumer = 'apps/example/consumer.ts';
  const sources = new Map([
    ['apps/example/raw.ts', "export { openSync as openFixture } from 'node:fs';"],
    ['apps/example/forward.ts', "export * from './raw.js';"],
    [consumer, "import { openFixture as read } from './forward.js';"],
  ]);
  const findings = accessFindings(consumer, sources.get(consumer), forwardedSources(sources));
  assert.deepEqual(
    findings.map(({ rule }) => rule),
    ['forwarded-raw-dependency'],
  );
  assert.deepEqual(
    accessFindings(consumer, 'await import(namedModule);').map(({ rule }) => rule),
    ['unresolved-loader'],
  );
});

test('edits to a multiline legacy query are new findings, not the old allowance', () => {
  const path = 'apps/example/query.ts';
  const source = [
    "import { table } from '../db/schema.js';",
    'const result = db.select().from(table).where(',
    '  fixturePredicate(table),',
    ').get();',
  ].join('\n');
  const known = violationKeys(accessFindings(path, source));
  const changed = source.replace('fixturePredicate', 'anotherFixturePredicate');
  const diff = allowanceDiff(known, violationKeys(accessFindings(path, changed)));
  assert.equal(diff.unexpected.length, 1);
  assert.equal(diff.stale.length, 1);
});

test('editing a multiline import binding invalidates its allowance', () => {
  const path = 'apps/server/src/example.ts';
  const source = "import {\n  openSync as openFixture,\n} from 'node:fs';";
  const edited = source.replace('openFixture', 'openOther');
  assert.throws(
    () =>
      enforceAllowlist(violationKeys(accessFindings(path, source)), accessFindings(path, edited)),
    /unexpected/,
  );
});

test('moving an unchanged invocation between named functions invalidates its allowance', () => {
  const path = 'apps/server/src/example.ts';
  const inFunction = (name) => `function ${name}() {\n  db.select().from(table).all();\n}`;
  const source = `import { table } from '../db/schema.js';\n${inFunction('first')}`;
  const edited = source.replace(inFunction('first'), inFunction('second'));
  assert.throws(
    () =>
      enforceAllowlist(violationKeys(accessFindings(path, source)), accessFindings(path, edited)),
    /unexpected/,
  );
});

test('historical trigger exemptions are exact and ignore SQL comments and strings', () => {
  const path = 'apps/server/drizzle/example.sql';
  const trigger =
    'CREATE TEMP TRIGGER IF NOT EXISTS "sample" AFTER INSERT ON sample BEGIN SELECT CASE WHEN 1 THEN 0 END; END;';
  const source = `-- CREATE TRIGGER ignored;\nSELECT 'CREATE TRIGGER also_ignored';\n${trigger}`;
  assert.deepEqual(sqlTriggers(source), [{ name: 'sample', definition: trigger }]);
  const known = violationKeys(accessFindings(path, source));
  enforceAllowlist(known, accessFindings(path, source));
  assert.throws(
    () => enforceAllowlist(known, accessFindings(path, source.replace('THEN 0', 'THEN 1'))),
    /unexpected.*\n/,
  );
  assert.throws(
    () => enforceAllowlist(known, accessFindings(path, `${source}\n${trigger}`)),
    /unexpected.*\n/,
  );
  assert.throws(() => enforceAllowlist(known, accessFindings(path, 'SELECT 1;')), /stale.*\n/);
});
