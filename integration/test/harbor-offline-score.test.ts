import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const harborDir = join(import.meta.dirname, '../eval/harbor');
const taskDir = join(harborDir, 'tasks/offline-oracle');

const read = (path: string) => readFileSync(path, 'utf8');

describe('offline oracle scoring', () => {
  test('scoring runs offline and does not ask Harbor for a policy this Docker host rejects', () => {
    const toml = read(join(taskDir, 'task.toml'));
    expect(toml).toMatch(/UV_OFFLINE = "1"/);
    expect(toml).toMatch(/docker_image = "cairn-harbor-offline-oracle:1681"/);
    expect(toml).not.toMatch(/no-network/);
    expect(toml).not.toMatch(/network_mode = "public"/);
  });

  test('the task image installs uv, python and the test runner before scoring', () => {
    const dockerfile = read(join(taskDir, 'environment/Dockerfile'));
    expect(dockerfile).toMatch(/python3/);
    expect(dockerfile).toMatch(/uv-0\.9\.7/);
    expect(dockerfile).toMatch(/\/opt\/verifier/);
    expect(dockerfile).not.toMatch(/astral\.sh/);
    const build = read(join(harborDir, 'build-offline-oracle-image.sh'));
    expect(build).toMatch(/download\/0\.9\.7\/uv-x86_64-unknown-linux-gnu\.tar\.gz/);
    expect(build).toMatch(/pytest==8\.4\.1/);
    expect(build).toMatch(/pytest-json-ctrf==0\.3\.5/);
  });

  test('the scoring script uses the preinstalled runner and refuses a live network', () => {
    const script = read(join(taskDir, 'tests/test.sh'));
    expect(script).not.toMatch(/astral\.sh/);
    expect(script).not.toMatch(/apt-get/);
    expect(script).not.toMatch(/\buvx\b/);
    expect(script).not.toMatch(/pip install/);
    expect(script).not.toMatch(/curl /);
    expect(script).toMatch(/\/opt\/verifier\/bin\/pytest/);
    expect(script).toMatch(/raise SystemExit\(1\)/);
    expect(script).toMatch(/\/logs\/verifier\/network\.txt/);
    expect(script).toMatch(/\/logs\/verifier\/reward\.txt/);
  });

  test('scoring is not placed on the host network', () => {
    const job = read(join(harborDir, 'offline-score.job.yaml'));
    expect(job).not.toMatch(/host-network/);
    expect(job).not.toMatch(/network_mode:\s*host/);
    const compose = read(join(taskDir, 'environment/docker-compose.yaml'));
    expect(compose).toMatch(/network_mode:\s*none/);
    expect(compose).not.toMatch(/network_mode:\s*host/);
    expect(compose).not.toMatch(/network:\s*host/);
    const build = read(join(harborDir, 'build-offline-oracle-image.sh'));
    expect(build).toMatch(/docker build --network=host/);
    expect(build).toMatch(/cairn-harbor-offline-oracle:1681/);
    const taskEnvFiles = readdirSync(join(taskDir, 'environment'));
    expect(taskEnvFiles).not.toContain('host-network.compose.yaml');
  });
});
