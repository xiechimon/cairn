import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const langfuseDir = new URL('../../ops/langfuse/', import.meta.url);
const upstreamHandlerSha256 = '5a4e2d10e2c944a9ef1ba64d74aa6c19450eab52e6786b72dad91761a3581e3d';

function composeConfig() {
  const run = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      new URL('docker-compose.yml', langfuseDir).pathname,
      '--env-file',
      new URL('.env.example', langfuseDir).pathname,
      'config',
      '--format',
      'json',
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) return null;
  return JSON.parse(run.stdout);
}

const config = composeConfig();
const skip = config === null ? 'docker compose is not available' : false;

function networksOf(service) {
  return Object.keys(config.services[service].networks ?? { default: null }).sort();
}

test('the evaluator runner sits only on the sandbox network with no secrets, mounts or published ports', {
  skip,
}, () => {
  const runner = config.services['code-eval-runner'];
  assert.deepEqual(networksOf('code-eval-runner'), ['code-eval-sandbox']);
  assert.equal(runner.read_only, true);
  assert.deepEqual(runner.cap_drop, ['ALL']);
  assert.equal(runner.cap_add, undefined);
  assert.notEqual(runner.user, undefined);
  assert.notEqual(runner.user.split(':')[0], '0');
  assert.equal(runner.volumes, undefined);
  assert.equal(runner.ports, undefined);
  assert.deepEqual(runner.environment, { AWS_LAMBDA_FUNCTION_TIMEOUT: '2' });
  assert.ok(Number(runner.mem_limit) <= 256 * 1024 * 1024);
  assert.ok(runner.pids_limit > 0);
});

test('only the gateway joins the ingress and sandbox networks, and only the worker joins ingress', {
  skip,
}, () => {
  const members = (network) =>
    Object.keys(config.services)
      .filter((service) => networksOf(service).includes(network))
      .sort();
  assert.deepEqual(members('code-eval-ingress'), ['code-eval-gateway', 'langfuse-worker']);
  assert.deepEqual(members('code-eval-sandbox'), ['code-eval-gateway', 'code-eval-runner']);
  assert.equal(config.services['code-eval-gateway'].ports, undefined);
  for (const network of ['code-eval-ingress', 'code-eval-sandbox']) {
    assert.equal(config.networks[network].internal, true);
    assert.equal(
      config.networks[network].driver_opts['com.docker.network.bridge.gateway_mode_ipv4'],
      'isolated',
    );
  }
});

test('the worker dispatches to the gateway one evaluation at a time and only it holds signing values', {
  skip,
}, () => {
  const worker = config.services['langfuse-worker'].environment;
  assert.equal(worker.LANGFUSE_CODE_EVAL_DISPATCHER, 'aws-lambda');
  assert.equal(worker.LANGFUSE_CODE_EVAL_AWS_LAMBDA_ENDPOINT, 'http://code-eval-gateway:8080');
  assert.equal(worker.LANGFUSE_CODE_EVAL_AWS_LAMBDA_NODE_FUNCTION_NAME, 'function');
  assert.equal(worker.LANGFUSE_CODE_EVAL_EXECUTION_WORKER_CONCURRENCY, '1');
  assert.equal(
    config.services['langfuse-web'].environment.LANGFUSE_CODE_EVAL_DISPATCHER,
    'aws-lambda',
  );
  for (const [service, definition] of Object.entries(config.services)) {
    if (service === 'langfuse-worker') continue;
    for (const key of Object.keys(definition.environment ?? {}))
      assert.ok(
        !key.startsWith('AWS_ACCESS') && !key.startsWith('AWS_SECRET'),
        `${service} ${key}`,
      );
  }
});

test('the vendored evaluator handler is byte-identical to Langfuse v4.68.0', () => {
  const handler = readFileSync(
    new URL('code-eval-runner/code-based-eval-handler.mjs', langfuseDir),
  );
  assert.equal(createHash('sha256').update(handler).digest('hex'), upstreamHandlerSha256);
});
