#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const AGENT_SDKS = [{ name: '@anthropic-ai/claude-agent-sdk', workspace: 'apps/daemon' }];

export function pinReleaseAgeExcludes(workspaceYaml, name, packages) {
  const kept = workspaceYaml
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(`- '${name}`));
  const entries = packages.map((pkg) => `  - '${pkg}'`).sort();
  const at = kept.indexOf('minimumReleaseAgeExclude:');
  if (at === -1) return [...kept, 'minimumReleaseAgeExclude:', ...entries, ''].join('\n');
  kept.splice(at + 1, 0, ...entries);
  return kept.join('\n');
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const root = join(import.meta.dirname, '..', '..');
  const run = (command, args) =>
    execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }).trim();
  const bumped = [];
  for (const sdk of AGENT_SDKS) {
    const manifestPath = join(root, sdk.workspace, 'package.json');
    const pinned = JSON.parse(readFileSync(manifestPath, 'utf8')).dependencies[sdk.name];
    const latest = run('npm', ['view', sdk.name, 'version']);
    if (pinned === latest) {
      console.log(`[bump-agent-sdk] ${sdk.name} ${pinned} is the latest`);
      continue;
    }
    const workspacePath = join(root, 'pnpm-workspace.yaml');
    const platforms = Object.keys(
      JSON.parse(
        run('npm', ['view', `${sdk.name}@${latest}`, 'optionalDependencies', '--json']) || '{}',
      ),
    ).filter((pkg) => pkg.startsWith(sdk.name));
    writeFileSync(
      workspacePath,
      pinReleaseAgeExcludes(
        readFileSync(workspacePath, 'utf8'),
        sdk.name,
        [sdk.name, ...platforms].map((pkg) => `${pkg}@${latest}`),
      ),
    );
    run('pnpm', [
      '--dir',
      sdk.workspace,
      'add',
      '--save-exact',
      '--ignore-scripts',
      `${sdk.name}@${latest}`,
    ]);
    bumped.push(`${sdk.name} ${pinned} -> ${latest}`);
    console.log(`[bump-agent-sdk] ${sdk.name} ${pinned} -> ${latest}`);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `bumped=${bumped.join('; ')}\n`);
  }
}
