import { describe, expect, test } from 'vitest';
import { reportSummaryOf } from '../src/chief/research-report.js';
import { thinkingPreview } from '../src/components/chat/agent-rows.js';
import { parseFrontmatter } from '../src/design/design-doc.js';
import { parseChatMarkdown } from '../src/lib/markdown.js';
import { baseName } from '../src/lib/path-name.js';
import { parseMentionSegments } from '../src/overlay/mention-token.js';
import { findListMarkers } from '../src/overlay/ordered-list.js';
import { safeFilename } from '../src/vendor-open-design/design-handoff.js';

const BOUND_MS = 1_500;
const N = 160_000;

const hostile: [string, () => unknown][] = [
  ['report summary links', () => reportSummaryOf('['.repeat(N))],
  ['thinking opener', () => thinkingPreview(`thinking about ${'…'.repeat(N)}.x`, 'Thinking')],
  ['design frontmatter', () => parseFrontmatter(`---\ncolors:\n  a: b${' '.repeat(N)}x\n---\n`)],
  ['code block blank lines', () => parseChatMarkdown(`\`\`\`\n${'\n'.repeat(4_000)}x\n\`\`\``)],
  ['path slashes', () => baseName(`${'/'.repeat(N)}x`)],
  ['mention brackets', () => parseMentionSegments('['.repeat(N))],
  ['list marker spaces', () => findListMarkers(`1. ${' '.repeat(N)}\r`)],
  ['file name dashes', () => safeFilename(`a${'-'.repeat(N)}x`, 'file')],
];

describe('web parsers stay linear on hostile text', () => {
  test.each(hostile)(
    '%s',
    (_name, run) => {
      const started = performance.now();
      run();
      expect(performance.now() - started).toBeLessThan(BOUND_MS);
    },
    300_000,
  );
});
