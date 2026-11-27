import { execFileSync, spawnSync } from 'node:child_process';
import { ownerOf } from './promote-queue.mjs';

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
}

function isAncestor(cwd, older, newer) {
  return spawnSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd }).status === 0;
}

export function commitPatchIds(cwd, base, tip) {
  const merges = gitOut(cwd, ['rev-list', '--merges', `${base}..${tip}`]);
  if (merges !== '') return null;
  const raw = gitOut(cwd, ['rev-list', '--reverse', `${base}..${tip}`]);
  if (raw === '') return [];
  const shas = raw.split('\n').filter(Boolean);
  return shas.map((sha) => {
    const patch = execFileSync('git', ['show', '--patch', '--binary', '--format=', sha], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const patched = spawnSync('git', ['patch-id', '--verbatim'], {
      cwd,
      input: patch,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    if (patched.status !== 0) {
      throw new Error(`git patch-id failed for ${sha}: ${patched.stderr}`);
    }
    const patchId = patched.stdout.trim().split(/\s+/)[0] ?? '';
    const meta = gitOut(cwd, ['show', '-s', '--format=%s%x00%an%x00%ae', sha]);
    return `${patchId}\0${meta}`;
  });
}

export function isCleanRebaseOf({ cwd, baseRef, testedSha, headSha }) {
  if (!cwd || !baseRef || !testedSha || !headSha) return false;
  let testedBase;
  let headBase;
  try {
    testedBase = gitOut(cwd, ['merge-base', baseRef, testedSha]);
    headBase = gitOut(cwd, ['merge-base', baseRef, headSha]);
  } catch {
    return false;
  }
  if (!testedBase || !headBase || !isAncestor(cwd, testedBase, headBase)) return false;
  let testedIds;
  let headIds;
  try {
    testedIds = commitPatchIds(cwd, testedBase, testedSha);
    headIds = commitPatchIds(cwd, headBase, headSha);
  } catch {
    return false;
  }
  if (!testedIds || !headIds || testedIds.length === 0 || testedIds.length !== headIds.length) {
    return false;
  }
  return testedIds.every((id, index) => id === headIds[index]);
}

export function rebaseOwnerLane(commitBody) {
  const owner = ownerOf(commitBody);
  return owner?.key?.startsWith('lane:') ? owner.key.slice('lane:'.length) : null;
}
