import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { evaluate } from './packaged-journey-gate.mjs';

const REGISTRY = '.claude/skills/verify-cairn/packaged-journeys.json';
const BASELINE = '.claude/skills/verify-cairn/packaged-journey-baseline.json';
const FEATURE_MAP = '.claude/skills/verify-cairn/feature-map.json';
const WALK = 'apps/desktop/scripts/journeys/probe.mjs';
const RUNNER = 'node scripts/packaged-journey.mjs';

const FEATURES = [
  { id: 'providers', name: 'Providers', status: 'shipped', reach: ['click testid:add-provider'] },
  {
    id: 'step-claim',
    name: 'Machine work protocol',
    status: 'shipped',
    reach: ['settings machines'],
  },
  { id: 'later', name: 'Later', status: 'planned', reach: [] },
];

const HOLLOW_WALK = `import assert from 'node:assert/strict';
const STEP_CLAIM_FEATURE = 'step-claim';
export default async function providersAndRouting({ window }) {
  await window.getByTestId('machines-button').click();
  await window.goto(new URL('/app/settings/machines', window.url()).toString());
  await window.getByTestId('machines-scroll').waitFor({ timeout: 15_000 });
  assert.equal(typeof STEP_CLAIM_FEATURE, 'string');
}
`;
const REAL_WALK = `export default async ({ window }) => {
  await window.getByTestId('add-provider').click();
  await window.getByTestId('provider-form').waitFor();
};
`;

function run({
  walk,
  claims = [],
  baseline,
  previousBaseline = null,
  features = FEATURES,
  desktopMac = RUNNER,
}) {
  const journeys =
    walk === undefined
      ? {}
      : { probe: { features: claims, modes: ['local-server', 'remote-server'] } };
  const files = {
    [FEATURE_MAP]: JSON.stringify({ features }),
    [REGISTRY]: JSON.stringify({ journeys }),
    [BASELINE]: JSON.stringify({ features: baseline }),
    [WALK]: walk ?? null,
    '.github/workflows/desktop-mac.yml': desktopMac,
    '.github/workflows/desktop-release.yml': RUNNER,
  };
  return evaluate({ read: (path) => files[path] ?? null, previousBaseline }).errors.join('\n');
}

test('the checked-in registry and baseline pass', () => {
  const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
  assert.deepEqual(evaluate({ read }).errors, []);
});

test('features on the baseline do not block, and planned ones need nothing', () => {
  assert.equal(run({ baseline: ['providers', 'step-claim'] }), '');
});

test('a feature off the baseline needs a walk in both modes', () => {
  assert.match(
    run({ baseline: ['step-claim'] }),
    /^providers \(Providers\) is not on the baseline .* local-server and remote-server$/,
  );
});

test('the baseline only shrinks, so a new feature cannot be added to it', () => {
  assert.match(
    run({ baseline: ['providers', 'step-claim'], previousBaseline: ['step-claim'] }),
    /providers was added; the list only shrinks/,
  );
});

test('a walked feature comes off the baseline', () => {
  assert.match(
    run({ walk: REAL_WALK, claims: ['providers'], baseline: ['providers', 'step-claim'] }),
    /remove providers; it now has a journey/,
  );
  assert.equal(run({ walk: REAL_WALK, claims: ['providers'], baseline: ['step-claim'] }), '');
});

test('the hollow walk, a feature name asserted to be a string, is refused and covers nothing', () => {
  const errors = run({ walk: HOLLOW_WALK, claims: ['step-claim'], baseline: ['providers'] });
  assert.match(errors, /claims step-claim, whose feature-map row has no testid reach step/);
  assert.match(errors, /step-claim \(Machine work protocol\) is not on the baseline/);
});

test('naming a test id in a string does not drive it', () => {
  const walk = `export default async ({ window }) => { await window.reload(); assert.ok('add-provider'); };`;
  assert.match(
    run({ walk, claims: ['providers'], baseline: ['step-claim'] }),
    /drives none of its test ids/,
  );
});

test('a walk with no UI action and no assertion is refused', () => {
  const walk = `export default async ({ window }) => { window.getByTestId('add-provider'); };`;
  const errors = run({ walk, claims: ['providers'], baseline: ['step-claim'] });
  assert.match(errors, /probe\.mjs performs no UI action/);
  assert.match(errors, /probe\.mjs asserts nothing/);
});

test('walking the built app after the live smoke launched it is red', () => {
  const built = `${RUNNER} release/mac-arm64/Cairn.app`;
  const baseline = ['providers', 'step-claim'];
  assert.match(
    run({ baseline, desktopMac: `run: pnpm smoke\n${built}` }),
    /desktop-mac\.yml walks the built app after pnpm smoke/,
  );
  assert.equal(run({ baseline, desktopMac: `${built}\nrun: pnpm smoke` }), '');
});
