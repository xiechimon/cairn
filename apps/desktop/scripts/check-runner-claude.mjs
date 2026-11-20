import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function claudeBinarySpecifier(platform, arch) {
  return `@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude${platform === 'win32' ? '.exe' : ''}`;
}

export function resolveRunnerClaude(runnerDir, platform, arch) {
  const sdk = createRequire(join(resolve(runnerDir), 'dist', 'cli.mjs')).resolve(
    '@anthropic-ai/claude-agent-sdk',
  );
  const binary = createRequire(sdk).resolve(claudeBinarySpecifier(platform, arch));
  accessSync(binary, constants.X_OK);
  return binary;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [runnerDir, platform = process.platform, arch = process.arch] = process.argv.slice(2);
  if (runnerDir === undefined) {
    console.error('usage: check-runner-claude.mjs <runner dir> [platform] [arch]');
    process.exit(2);
  }
  try {
    console.log(`runner Claude Code binary: ${resolveRunnerClaude(runnerDir, platform, arch)}`);
  } catch (error) {
    console.error(
      `the runner in ${runnerDir} cannot resolve ${claudeBinarySpecifier(platform, arch)} from the Claude Agent SDK, so every Claude Code turn fails without a claude on PATH: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
