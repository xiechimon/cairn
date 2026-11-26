import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const srcRoot = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = walk(srcRoot)
  .filter((path) => /\.tsx?$/.test(path))
  .map((path) => ({ rel: relative(srcRoot, path), text: readFileSync(path, 'utf8') }));

const CHAT_DIRS = /^(chief|components\/chat|detail)\//;

const holders = (pattern: RegExp, files = sources) =>
  files.filter((file) => pattern.test(file.text)).map((file) => file.rel);

describe('a chat message renders through one bubble, one meta row and one press menu', () => {
  test('only the shared bubble paints a message bubble', () => {
    expect(
      holders(/(bg|rounded)-\(--(bubble-fill|reply-bubble-fill|radius-bubble|radius-reply)\)/),
    ).toEqual(['components/chat/message-bubble.tsx']);
  });

  test('only the shared press menu opens a context menu on a message', () => {
    expect(holders(/from '[^']*ui\/context-menu(\.js)?'/).sort()).toEqual([
      'components/chat/message-press-menu.tsx',
      'design/components-overlays.tsx',
    ]);
  });

  test('chat code copies through the shared copy button, not its own copied state', () => {
    expect(
      holders(
        /\[copied, setCopied\]/,
        sources.filter((file) => CHAT_DIRS.test(file.rel)),
      ),
    ).toEqual([]);
  });

  test('the retired per-surface toolbars and menus stay deleted', () => {
    for (const gone of [
      'chief/message-toolbar.tsx',
      'chief/touch-message-tools.ts',
      'chief/reply-press-menu.tsx',
    ]) {
      expect(existsSync(join(srcRoot, gone)), gone).toBe(false);
    }
  });

  test('one time divider component draws the centred time line', () => {
    expect(holders(/data-testid="chief-time-divider"/)).toEqual(['components/chat/message-time.tsx']);
  });
});
