import { expect, test } from 'vitest';
import {
  appendWorkBranchNote,
  buildWorkBranchNote,
  GITHUB_OVERLAP_RULE,
} from '../src/records/prompts.js';

test('overlap rule names no repository-specific script and skips without GitHub access', () => {
  expect(GITHUB_OVERLAP_RULE).not.toContain('github-overlap.mjs');
  expect(GITHUB_OVERLAP_RULE).toContain('last 7 days');
  expect(GITHUB_OVERLAP_RULE).toContain('close_as_duplicate');
  expect(GITHUB_OVERLAP_RULE).toContain('has no GitHub access, skip this check');
});

test('work branch note does not force PR or overlap rules onto external repositories', () => {
  const note = buildWorkBranchNote('lane/1834');
  expect(note).not.toContain('github-overlap.mjs');
  expect(note).not.toContain('close_as_duplicate');
  expect(note).toContain('AGENTS.md');
});

test('a prompt stored with the previous overlap/PR note rewrites cleanly to the neutral note', () => {
  const stored = `[cairn 系统规则，不是用户的消息]工作分支注记：本步的工作分支是 lane/1834。工作区已检出该分支——本步的全部提交与推送都必须落在它上面：不要创建或切换到自己的分支，不要另开 worktree 或 clone 到别处干活；开 Pull Request 时 head 分支也必须是它。\n${GITHUB_OVERLAP_RULE}\n开 PR 时直接开成 ready for review，不要开 draft。仓库接了审查回路（如 Codex 审查）时，审查意见会通过 wake 发回：意见没处理完，cairn 会把 PR 转为 draft 并加 cairn-review-hold 标签，处理完再转回 ready；PR 带这个标签时不要自己改它的 draft 状态。用户本人对这个 PR 的直接要求（例如标 ready 或转 draft）优先于本条系统规则。`;
  expect(appendWorkBranchNote(`task\n${stored}`, 'lane/1834')).toBe(
    `task\n${buildWorkBranchNote('lane/1834')}`,
  );
});
