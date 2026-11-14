import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveReadmeFixture } from './readme-fixture-server.mjs';

const iosDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] ?? join(iosDir, '../../docs/assets/readme'));
const port = Number(process.env.PORT ?? 8791);
const device = process.env.CAIRN_SHOT_DEVICE ?? 'iPhone 18 Pro Max';
const runtime = process.env.CAIRN_SHOT_RUNTIME ?? 'com.apple.CoreSimulator.SimRuntime.iOS-27-0';
const shots = { '01-home': 'ios-home', '02-thread': 'ios-thread', '03-tasks': 'ios-tasks' };
const hairline = { light: '#e6e6e6', dark: '#303030' };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
  return result;
}

function runAsync(command, args, options) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options });
    child.on('close', (code) =>
      code === 0 ? done() : fail(new Error(`${command} exited ${code}`)),
    );
  });
}

function simulator() {
  const list = JSON.parse(
    spawnSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' })
      .stdout,
  );
  const found = (list.devices[runtime] ?? []).find((d) => d.name === device);
  if (found === undefined) throw new Error(`no ${device} simulator on ${runtime}`);
  return found;
}

function cairnCrashes() {
  return new Set(readdirSync(crashDir).filter((name) => name.startsWith('Cairn')));
}

const { udid, state } = simulator();
const crashDir = join(homedir(), 'Library/Logs/DiagnosticReports');
const crashesBefore = cairnCrashes();
const work = mkdtempSync(join(tmpdir(), 'cairn-ios-shots-'));
const derived = join(work, 'dd');
const destination = `platform=iOS Simulator,id=${udid}`;
const xcode = [
  '-project',
  'Cairn.xcodeproj',
  '-scheme',
  'Cairn',
  '-destination',
  destination,
  '-derivedDataPath',
  derived,
  'CODE_SIGN_IDENTITY=-',
  'CODE_SIGNING_REQUIRED=NO',
];

function boot() {
  spawnSync('xcrun', ['simctl', 'boot', udid]);
  run('xcrun', ['simctl', 'bootstatus', udid, '-b']);
}

function globalDefault(key) {
  return spawnSync('xcrun', ['simctl', 'spawn', udid, 'defaults', 'read', '-g', key], {
    encoding: 'utf8',
  }).stdout.trim();
}

async function warmAccessibilityCaches() {
  run('xcrun', ['simctl', 'launch', udid, 'com.apple.Preferences']);
  await new Promise((done) => setTimeout(done, 30_000));
  spawnSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.Preferences']);
}

boot();
let cold = state !== 'Booted';
if (globalDefault('AppleICUForce12HourTime') !== '1') {
  run('xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', '-g', 'AppleICUForce12HourTime', '-bool', 'YES']);
  spawnSync('xcrun', ['simctl', 'spawn', udid, 'defaults', 'delete', '-g', 'AppleICUForce24HourTime']);
  run('xcrun', ['simctl', 'shutdown', udid]);
  boot();
  cold = true;
}
if (cold) await warmAccessibilityCaches();
run('xcrun', [
  'simctl',
  'status_bar',
  udid,
  'override',
  '--time',
  '9:41',
  '--dataNetwork',
  'wifi',
  '--wifiMode',
  'active',
  '--wifiBars',
  '3',
  '--cellularMode',
  'active',
  '--cellularBars',
  '4',
  '--batteryState',
  'discharging',
  '--batteryLevel',
  '100',
]);
run('xcodegen', ['generate', '-q'], { cwd: iosDir });
run('xcodebuild', [...xcode, 'build-for-testing', '-quiet'], { cwd: iosDir });
mkdirSync(outDir, { recursive: true });

for (const language of ['en', 'zh-Hans']) {
  for (const appearance of ['light', 'dark']) {
    const tag = `${language === 'en' ? 'en' : 'zh'}-${appearance}`;
    const bundle = join(work, `${tag}.xcresult`);
    const attachments = join(work, tag);
    run('xcrun', ['simctl', 'ui', udid, 'appearance', appearance]);
    const server = await serveReadmeFixture(port);
    try {
      await runAsync(
        'xcodebuild',
        [
          ...xcode,
          '-only-testing:CairnUITests/ReadmeShotsTests',
          '-resultBundlePath',
          bundle,
          'test-without-building',
        ],
        {
          cwd: iosDir,
          env: {
            ...process.env,
            TEST_RUNNER_CAIRN_PILOT_SERVER: `http://127.0.0.1:${port}`,
            TEST_RUNNER_CAIRN_PILOT_TOKEN: `readme-${language === 'en' ? 'en' : 'zh'}`,
            TEST_RUNNER_CAIRN_SHOT_LANGUAGE: language,
            TEST_RUNNER_CAIRN_PILOT_APPEARANCE: appearance,
          },
        },
      );
    } finally {
      server.closeAllConnections();
      server.close();
    }
    run('xcrun', [
      'xcresulttool',
      'export',
      'attachments',
      '--path',
      bundle,
      '--output-path',
      attachments,
    ]);
    const manifest = JSON.parse(readFileSync(join(attachments, 'manifest.json'), 'utf8'));
    for (const attachment of manifest.flatMap((test) => test.attachments)) {
      const step = Object.keys(shots).find((name) =>
        attachment.suggestedHumanReadableName.startsWith(`${name}-`),
      );
      if (step === undefined) continue;
      const raw = join(attachments, attachment.exportedFileName);
      if (step === '01-home') copyFileSync(raw, join(outDir, `${shots[step]}-raw-${tag}.png`));
      const png = join(work, `${shots[step]}-${tag}.png`);
      run('python3', [
        join(iosDir, 'scripts/round-shot.py'),
        raw,
        png,
        hairline[appearance],
      ]);
      run('cwebp', [
        '-quiet',
        '-q',
        '90',
        '-alpha_q',
        '100',
        png,
        '-o',
        join(outDir, `${shots[step]}-${tag}.webp`),
      ]);
    }
  }
}

spawnSync('xcrun', ['simctl', 'status_bar', udid, 'clear']);
const newCrashes = [...cairnCrashes()].filter((name) => !crashesBefore.has(name));
if (newCrashes.length > 0) throw new Error(`Cairn or its test runner crashed: ${newCrashes.join(', ')}`);
rmSync(work, { recursive: true, force: true });
process.stdout.write(`wrote iOS shots to ${outDir}\n`);
