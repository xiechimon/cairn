import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function designatedRequirement(codesignOutput) {
  const line = codesignOutput.split('\n').find((row) => row.startsWith('designated => '));
  return line === undefined ? null : line.slice('designated => '.length).trim();
}

export function certificateFingerprint(pem) {
  return new X509Certificate(pem).fingerprint.replaceAll(':', '').toUpperCase();
}

export function signedBy(requirement, bundleId, fingerprint) {
  const match = /^identifier "([^"]+)" and certificate (?:leaf|root) = H"([0-9a-fA-F]{40})"$/.exec(
    requirement ?? '',
  );
  return match !== null && match[1] === bundleId && match[2].toUpperCase() === fingerprint;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function check(app, certPath) {
  const verified = run('codesign', ['--verify', '--deep', '--strict', app]);
  if (verified.status !== 0) {
    console.error(`codesign --verify failed for ${app}:\n${verified.output}`);
    return false;
  }
  const bundleId = run('plutil', [
    '-extract',
    'CFBundleIdentifier',
    'raw',
    `${app}/Contents/Info.plist`,
  ]).output.trim();
  const requirement = designatedRequirement(run('codesign', ['-d', '-r-', app]).output);
  const fingerprint = certificateFingerprint(readFileSync(certPath, 'utf8'));
  console.log(`${app}: designated => ${requirement}`);
  if (signedBy(requirement, bundleId, fingerprint)) return true;
  console.error(
    `${app} is not signed by the certificate ${fingerprint} for ${bundleId}; macOS would drop its permissions on the next update`,
  );
  return false;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [certPath, ...apps] = process.argv.slice(2);
  if (certPath === undefined || apps.length === 0) {
    console.error('usage: check-signature.mjs <certificate pem> <app>...');
    process.exit(2);
  }
  const results = apps.map((app) => check(app, certPath));
  process.exit(results.every(Boolean) ? 0 : 1);
}
