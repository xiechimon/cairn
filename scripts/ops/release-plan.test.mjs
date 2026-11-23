import assert from 'node:assert/strict';
import test from 'node:test';
import { freeDesktopVersion } from './next-desktop-version.mjs';
import { fetchDesktopTagTargets, planRelease } from './release-plan.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

const target = (tag, sha = SHA) => ({ tag, sha });
const rel = (tag_name, draft = false, prerelease = false) => ({ tag_name, draft, prerelease });

test('a fresh tip releases at one above the highest desktop tag and release', () => {
  const plan = planRelease({
    sha: SHA,
    targets: [target('desktop-v0.1.9', OTHER_SHA), target('desktop-v0.1.10', OTHER_SHA)],
    releases: [rel('desktop-v0.1.10'), rel('desktop-v0.1.9')],
  });
  assert.deepEqual(plan, {
    released: false,
    version: '0.1.11',
    reason: null,
  });
});

test('a published tag on the tip ends the run without releasing', () => {
  const plan = planRelease({
    sha: SHA,
    targets: [target('desktop-v0.1.42'), target('desktop-v0.1.41', OTHER_SHA)],
    releases: [rel('desktop-v0.1.42'), rel('desktop-v0.1.41')],
  });
  assert.equal(plan.released, true);
  assert.equal(plan.version, '0.1.42');
  assert.match(plan.reason, /already released/);
});

test('an orphan tag on the tip is skipped past by version, never resumed', () => {
  for (const releases of [
    [],
    [rel('desktop-v0.1.42', true)],
    [rel('desktop-v0.1.42', false, true)],
  ]) {
    const plan = planRelease({
      sha: SHA,
      targets: [target('desktop-v0.1.42'), target('desktop-v0.1.41', OTHER_SHA)],
      releases,
    });
    assert.equal(plan.released, false, JSON.stringify(releases));
    assert.equal(plan.version, '0.1.43', JSON.stringify(releases));
  }
});

test('a draft or a prerelease without a tag reserves its version', () => {
  const draft = planRelease({
    sha: SHA,
    targets: [target('desktop-v0.1.701', OTHER_SHA)],
    releases: [rel('desktop-v0.1.701'), rel('desktop-v0.1.702', true)],
  });
  assert.equal(draft.released, false);
  assert.equal(
    draft.version,
    '0.1.703',
    'a draft holds its version name, so the pick steps past it',
  );
  const prerelease = planRelease({
    sha: SHA,
    targets: [target('desktop-v0.1.701', OTHER_SHA)],
    releases: [rel('desktop-v0.1.701'), rel('desktop-v0.1.702', false, true)],
  });
  assert.equal(prerelease.released, false);
  assert.equal(prerelease.version, '0.1.703');
});

test('drafts holding the next names move the pick to the first free version', () => {
  const plan = planRelease({
    sha: SHA,
    targets: [target('desktop-v0.1.1', OTHER_SHA)],
    releases: [rel('desktop-v0.1.1'), rel('desktop-v0.1.2', true), rel('desktop-v0.1.3', true)],
  });
  assert.equal(plan.released, false);
  assert.equal(plan.version, '0.1.4');
});

test('a draft far above the base never raises the base version', () => {
  const plan = planRelease({
    sha: SHA,
    targets: [target('desktop-v0.1.1', OTHER_SHA)],
    releases: [rel('desktop-v0.1.1'), rel('desktop-v9.9.9', true)],
  });
  assert.equal(plan.version, '0.1.2');
});

test('the free version scan is bounded by the occupied names, not a fixed cap', () => {
  const occupied = new Set(Array.from({ length: 20 }, (_, i) => `desktop-v0.1.${i + 2}`));
  assert.equal(
    freeDesktopVersion({ names: ['desktop-v0.1.1'], occupied }),
    '0.1.22',
    'a run of twenty held names still yields the first free one',
  );
  assert.equal(freeDesktopVersion({ names: [], occupied: new Set() }), '0.1.1');
  assert.equal(
    freeDesktopVersion({
      names: [],
      occupied: new Set(['desktop-v0.1.1', 'web-v9.9.9', 'desktop-vbeta']),
    }),
    '0.1.2',
    'non desktop-v versions never occupy a name',
  );
});

test('an orphan tag on the tip stays an orphan when a higher published release exists elsewhere', () => {
  const plan = planRelease({
    sha: SHA,
    targets: [target('desktop-v0.1.2'), target('desktop-v0.1.9', OTHER_SHA)],
    releases: [rel('desktop-v0.1.9')],
  });
  assert.equal(plan.released, false);
  assert.equal(plan.version, '0.1.10');
});

test('a published tag on an older commit does not stop the tip release and still bumps it', () => {
  const plan = planRelease({
    sha: SHA,
    targets: [target('desktop-v0.1.42', OTHER_SHA)],
    releases: [rel('desktop-v0.1.42')],
  });
  assert.deepEqual(plan, {
    released: false,
    version: '0.1.43',
    reason: null,
  });
});

test('a nested or suffixed name occupies its version base without raising the baseline', () => {
  const base = {
    sha: SHA,
    releases: [rel('desktop-v0.1.1')],
  };
  for (const tag of ['desktop-v0.1.2/rc1', 'desktop-v0.1.2-rc1']) {
    const plan = planRelease({
      ...base,
      targets: [target('desktop-v0.1.1', OTHER_SHA), target(tag, OTHER_SHA)],
    });
    assert.equal(plan.version, '0.1.3', `a tag ${tag} keeps the parent ref uncreatable`);
  }
  for (const name of ['desktop-v0.1.2/rc1', 'desktop-v0.1.2-rc1']) {
    const plan = planRelease({
      ...base,
      targets: [target('desktop-v0.1.1', OTHER_SHA)],
      releases: [rel('desktop-v0.1.1'), rel(name)],
    });
    assert.equal(plan.version, '0.1.3', `a release ${name} occupies its version base`);
  }
  const high = planRelease({
    ...base,
    targets: [target('desktop-v0.1.1', OTHER_SHA), target('desktop-v9.9.9/rc1', OTHER_SHA)],
  });
  assert.equal(
    high.version,
    '0.1.2',
    'a nested name only reserves its own base; it never raises the base version',
  );
  const shapeless = planRelease({
    ...base,
    targets: [target('desktop-v0.1.1', OTHER_SHA), target('desktop-v0.1.2x', OTHER_SHA)],
  });
  assert.equal(shapeless.version, '0.1.2', 'a name without the version boundary occupies nothing');
});

test('non desktop tags and unparsed refs do not count toward the version', () => {
  const plan = planRelease({
    sha: SHA,
    targets: [target('web-v9.9.9'), target('draft'), target('desktop-v0.1.2', OTHER_SHA)],
    releases: [rel('web-v9.9.9'), rel('desktop-vbeta'), rel('draft')],
  });
  assert.equal(plan.version, '0.1.3');
  assert.equal(plan.released, false);
});

test('fetchDesktopTagTargets resolves lightweight tags and dereferences annotated tags', () => {
  const calls = [];
  const targets = fetchDesktopTagTargets({
    repo: 'o/r',
    gh(args) {
      const url = args[1];
      calls.push(url);
      if (url.includes('git/tags/tagobj1')) {
        return JSON.stringify({ object: { sha: SHA, type: 'commit' } });
      }
      return JSON.stringify([
        { ref: 'refs/tags/desktop-v0.1.1', object: { sha: OTHER_SHA, type: 'commit' } },
        { ref: 'refs/tags/desktop-v0.1.2', object: { sha: 'tagobj1', type: 'tag' } },
        { ref: 'refs/tags/web-v1', object: { sha: 'c'.repeat(40), type: 'commit' } },
      ]);
    },
  });
  assert.deepEqual(targets, [
    { tag: 'desktop-v0.1.1', sha: OTHER_SHA },
    { tag: 'desktop-v0.1.2', sha: SHA },
  ]);
  assert.ok(calls.some((url) => url.includes('git/tags/tagobj1')));
});
