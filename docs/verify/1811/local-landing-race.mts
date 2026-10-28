import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit, systemGitOps } from '../../../apps/server/src/lib/git.ts';

const root = await mkdtemp(join(tmpdir(), 'cairn-1811-landing-'));
const repo = join(root, 'repo.git');
const env = {
  GIT_AUTHOR_NAME: 'landing-repro',
  GIT_AUTHOR_EMAIL: 'landing@example.invalid',
  GIT_COMMITTER_NAME: 'landing-repro',
  GIT_COMMITTER_EMAIL: 'landing@example.invalid',
};
try {
  await systemGitOps.initBareRepo(repo);
  const base = await systemGitOps.seedInitialCommit(repo, 'base');
  const candidateResult = await runGit(
    ['commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-p', base, '-m', 'candidate'],
    { cwd: repo, env },
  );
  const competingResult = await runGit(
    ['commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-p', base, '-m', 'competing'],
    { cwd: repo, env },
  );
  assert.equal(candidateResult.code, 0);
  assert.equal(competingResult.code, 0);
  const candidate = candidateResult.stdout.toString().trim();
  const competing = competingResult.stdout.toString().trim();
  assert(await systemGitOps.isAncestor(repo, base, candidate));
  await systemGitOps.updateBranchRef(repo, 'main', competing);
  assert.equal(await systemGitOps.isAncestor(repo, competing, candidate), false);
  await systemGitOps.updateBranchRef(repo, 'main', candidate);
  assert.equal(await systemGitOps.resolveCommit(repo, 'refs/heads/main'), candidate);
  console.log(
    JSON.stringify(
      {
        sourceCommit: '05d0dd12e3e9eab720bfd7c4afeb097ed4c0615e',
        originalCheckPassed: true,
        competingAdvanceAfterCheck: true,
        candidateContainsCompetingCommit: false,
        unconditionalUpdateOverwroteCompetingAdvance: true,
        boundary: 'Real GitOps calls in a temporary bare repository; no server endpoint exercised',
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
