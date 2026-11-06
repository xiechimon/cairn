import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceSchemaSection } from './pr-schema-sync.mjs';

const glance =
  '### Schema changes\n\n| table | change | detail |\n|---|---|---|\n| `tasks` | + due_at | integer |\n';
const stale =
  '### Schema changes\n\n| table | change | detail |\n|---|---|---|\n| `tasks` | + due_at | text |\n';

test('replaces a stale table in place and keeps the content after it', () => {
  const body = `## Proof\nran\n\n${stale}\nVerified:\n\n| step | result |\n|---|---|\n| migrate | ok |\n\n## What\nx\n`;
  const result = replaceSchemaSection(body, glance);
  assert.ok(result.includes('| `tasks` | + due_at | integer |'));
  assert.ok(!result.includes('+ due_at | text'));
  assert.ok(result.includes('| migrate | ok |'));
  assert.equal(result.split('### Schema changes').length, 2);
});

test('replaces the No schema changes line', () => {
  const body = '## Proof\n\n### Schema changes\n\nNo schema changes\n\n## What\nx\n';
  const result = replaceSchemaSection(body, glance);
  assert.ok(!result.includes('No schema changes'));
  assert.ok(result.includes('+ due_at | integer'));
});

test('inserts before ## What when the section is missing', () => {
  const result = replaceSchemaSection('## Proof\nran\n## What\nx\n', glance);
  assert.ok(result.indexOf('### Schema changes') < result.indexOf('## What'));
  assert.ok(result.indexOf('ran') < result.indexOf('### Schema changes'));
  assert.match(result, /ran\n\n### Schema changes/);
  assert.match(result, /integer \|\n\n## What/);
});

test('appends when there is neither a section nor a What heading', () => {
  const result = replaceSchemaSection('Proof only\n', glance);
  assert.ok(result.endsWith('integer |\n'));
});

test('ignores a heading inside a code fence', () => {
  const body = '## Proof\n```\n### Schema changes\n| a |\n```\n## What\nx\n';
  const result = replaceSchemaSection(body, glance);
  assert.ok(result.includes('```\n### Schema changes\n| a |\n```'));
  assert.equal(result.split('### Schema changes').length, 3);
});

test('is idempotent', () => {
  const once = replaceSchemaSection('## Proof\nran\n## What\nx\n', glance);
  assert.equal(replaceSchemaSection(once, glance), once);
});

test('ignores headings inside HTML comments', () => {
  const body =
    '## Proof\nran\n<!--\n### Schema changes\n| a |\n## What\n-->\n## What\nx\n<!-- ## What -->\n';
  const result = replaceSchemaSection(body, glance);
  assert.ok(result.includes('<!--\n### Schema changes\n| a |\n## What\n-->'));
  assert.match(result, /-->\n\n?### Schema changes[\s\S]*integer \|\n\n## What\nx/);
  assert.equal(result.split('### Schema changes').length, 3);
});

test('a commented-out schema heading does not hide the real section', () => {
  const body = `<!-- ### Schema changes -->\n## Proof\n\n${stale}\n## What\nx\n`;
  const result = replaceSchemaSection(body, glance);
  assert.ok(!result.includes('+ due_at | text'));
  assert.ok(result.includes('<!-- ### Schema changes -->'));
});
