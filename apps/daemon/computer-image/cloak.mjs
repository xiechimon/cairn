import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { binaryInfo, ensureBinary, getDefaultStealthArgs, licenseErrorFrom } from 'cloakbrowser';

const [profile, envFile] = process.argv.slice(2);

function readIdentity(file) {
  const identity = JSON.parse(readFileSync(file, 'utf8'));
  const keys = Object.keys(identity).sort().join(',');
  if (
    keys !== 'locale,platform,seed,timezone' ||
    !Number.isInteger(identity.seed) ||
    identity.seed < 10000 ||
    identity.seed > 99999 ||
    !['windows', 'macos', 'linux'].includes(identity.platform) ||
    identity.locale !== 'en-US' ||
    identity.timezone !== 'UTC'
  )
    throw new Error('CloakBrowser profile identity is invalid');
  return identity;
}

function identityOf(directory) {
  const file = join(directory, '.cairn-cloak-identity.json');
  try {
    return readIdentity(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('CloakBrowser profile identity is invalid');
  }
  const defaults = getDefaultStealthArgs();
  const created = {
    seed: Number(defaults.find((arg) => arg.startsWith('--fingerprint='))?.split('=')[1]),
    platform: defaults.find((arg) => arg.startsWith('--fingerprint-platform='))?.split('=')[1],
    locale: 'en-US',
    timezone: 'UTC',
  };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.cloak-identity-${randomUUID()}`);
  writeFileSync(temporary, JSON.stringify(created), { flag: 'wx', mode: 0o600 });
  try {
    linkSync(temporary, file);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    unlinkSync(temporary);
  }
  return readIdentity(file);
}

function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

try {
  const key = (process.env.CLOAKBROWSER_LICENSE_KEY ?? '').trim();
  if (key === '' || /[\0\r\n]/.test(key)) throw new Error('missing key');
  const installed = binaryInfo();
  const executable =
    installed.installed && installed.binaryPath ? installed.binaryPath : await ensureBinary(key);
  const version = binaryInfo().version ?? 'unknown';
  const identity = identityOf(profile);
  const args = [
    '--no-sandbox',
    `--fingerprint=${identity.seed}`,
    `--fingerprint-platform=${identity.platform}`,
    `--lang=${identity.locale}`,
    `--fingerprint-locale=${identity.locale}`,
    `--fingerprint-timezone=${identity.timezone}`,
    '--ignore-gpu-blocklist',
    '--start-maximized',
    '--ozone-platform=x11',
    '--password-store=basic',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    '--restore-last-session',
  ];
  const lines = [
    `CAIRN_CLOAK_EXECUTABLE=${quote(executable)}`,
    `CAIRN_CLOAK_ARGS=${quote(args.join(' '))}`,
  ];
  const temporary = `${envFile}.${randomUUID()}`;
  writeFileSync(temporary, `${lines.join('\n')}\n`, { mode: 0o600 });
  renameSync(temporary, envFile);
  process.stdout.write(`${version}\n`);
} catch (error) {
  if (licenseErrorFrom(error)) {
    process.stderr.write('CloakBrowser license denied or unavailable\n');
    process.exit(3);
  }
  process.stderr.write(
    error instanceof Error && error.message === 'CloakBrowser profile identity is invalid'
      ? `${error.message}\n`
      : 'CloakBrowser binary acquisition failed\n',
  );
  process.exit(4);
}
