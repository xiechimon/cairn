import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fetchDesktopReleases, highestBaselineRelease } from './last-desktop-release.mjs';
import { fetchDesktopTagTargets } from './release-plan.mjs';

const OWNER = /^<!-- cairn-desktop-run:([1-9]\d*) revision:([0-9a-f]{40}) -->$/m;
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[1-9]\d*$/;

export function releaseOwner(runId, revision) {
  return `<!-- cairn-desktop-run:${runId} revision:${revision} -->`;
}

export function activeReservation({ releases, sha, repo, gh }) {
  for (const draft of releases) {
    if (draft.draft !== true || draft.target_commitish !== sha) continue;
    const owner = OWNER.exec(draft.body ?? '');
    if (!owner) continue;
    let run;
    try {
      run = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${owner[1]}`]));
    } catch (error) {
      if (/\(HTTP 404\)\s*$/.test(String(error.stderr ?? ''))) continue;
      throw error;
    }
    if (String(run.id) !== owner[1] || run.head_sha !== owner[2]) {
      throw new Error('the draft owner did not match the workflow run');
    }
    if (ACTIVE.has(run.status)) return owner[1];
    if (run.status !== 'completed') throw new Error('the draft owner has an unknown status');
  }
  return null;
}

export function reserveDraft({ sha, version, runId, revision, repo, gh }) {
  const releases = fetchDesktopReleases({ repo, gh });
  if (activeReservation({ releases, sha, repo, gh }) !== null) return null;
  const baseline = highestBaselineRelease(releases);
  if (baseline !== null) {
    const stable = fetchDesktopTagTargets({ repo, gh }).find(({ tag }) => tag === baseline);
    if (stable?.sha === sha) return null;
  }
  const tag = `desktop-v${version}`;
  if (releases.some((item) => item.tag_name === tag)) {
    throw new Error(`${tag} is already held by a release`);
  }
  const matching = JSON.parse(gh(['api', `repos/${repo}/git/matching-refs/tags/${tag}`]));
  if (!Array.isArray(matching)) throw new Error('the tag inventory is unknown');
  if (
    matching.some(
      ({ ref }) =>
        ref === `refs/tags/${tag}` ||
        ref.startsWith(`refs/tags/${tag}/`) ||
        ref.startsWith(`refs/tags/${tag}-`),
    )
  ) {
    throw new Error(`${tag} is already held by a tag; an occupied tag is never adopted`);
  }
  const body = `Built from ${sha}.

| Platform | Download |
| --- | --- |
| macOS (Apple Silicon) | \`Cairn-${version}-mac-arm64.dmg\` |
| macOS (Intel) | \`Cairn-${version}-mac-x64.dmg\` |
| Windows (64-bit Installer) | \`Cairn-${version}-win-x64.exe\` |
| Windows (64-bit Portable ZIP) | \`Cairn-${version}-win-x64.zip\` |
| Linux (64-bit) | \`Cairn-${version}-linux-x64.tar.gz\` |

\`-mac-*.zip\` and \`desktop-latest.json\` are for in-app auto-updates.

macOS builds are signed with Cairn's own certificate, not an Apple one: the first launch needs right-click, Open.

${releaseOwner(runId, revision)}`;
  const id = gh([
    'api',
    '-X',
    'POST',
    `repos/${repo}/releases`,
    '-F',
    'draft=true',
    '-f',
    `tag_name=${tag}`,
    '-f',
    `target_commitish=${sha}`,
    '-f',
    `name=Cairn ${version}`,
    '-f',
    `body=${body}`,
    '--jq',
    '.id',
  ]).trim();
  if (!ID.test(id)) throw new Error('the reservation did not return a numeric release id');
  return id;
}

export function verifyDraft({ id, sha, version, runId, revision, repo, gh, empty }) {
  if (!ID.test(id)) throw new Error('not a numeric release id');
  const draft = JSON.parse(gh(['api', `repos/${repo}/releases/${id}`]));
  const owner = OWNER.exec(draft.body ?? '');
  if (
    String(draft.id) !== id ||
    draft.draft !== true ||
    draft.tag_name !== `desktop-v${version}` ||
    draft.target_commitish !== sha ||
    owner?.[1] !== runId ||
    owner?.[2] !== revision
  ) {
    throw new Error('the draft no longer holds its original state, tag, commit and owner');
  }
  if (empty && (!Array.isArray(draft.assets) || draft.assets.length !== 0)) {
    throw new Error('the reserved draft is not empty; use a fresh workflow run');
  }
}

if (process.argv[1] && import.meta.filename === realpathSync(process.argv[1])) {
  try {
    const [, , action] = process.argv;
    const {
      GITHUB_REPOSITORY: repo,
      RELEASE_SHA: sha,
      VERSION: version,
      RELEASE_ID: id,
      GITHUB_RUN_ID: runId,
      GITHUB_SHA: revision,
    } = process.env;
    if (
      !repo ||
      !SHA.test(sha) ||
      !/^\d+\.\d+\.\d+$/.test(version) ||
      !ID.test(runId) ||
      !SHA.test(revision)
    ) {
      throw new Error('invalid desktop release reservation inputs');
    }
    const gh = (args) =>
      execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const params = { id, sha, version, runId, revision, repo, gh };
    if (action === 'reserve') {
      const reserved = reserveDraft(params);
      console.log(`release=${reserved !== null}`);
      if (reserved !== null) console.log(`release_id=${reserved}`);
      else console.error('[release-reservation] this SHA was already released or reserved');
    } else if (action === 'verify-empty' || action === 'verify') {
      verifyDraft({ ...params, empty: action === 'verify-empty' });
    } else throw new Error(`unknown action: ${action}`);
  } catch (error) {
    console.error(`[release-reservation] ${String(error.message).split('\n')[0]}`);
    process.exitCode = 2;
  }
}
