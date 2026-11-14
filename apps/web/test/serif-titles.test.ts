import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

function openingTags(source: string, tag: string): string[] {
  return [...source.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g'))].map((m) => m[1] ?? '');
}

const STYLES = join(SRC, 'styles');

function read(path: string): string {
  return readFileSync(join(SRC, path), 'utf8');
}

describe('the serif voice follows claude.ai (DESIGN.md Typography)', () => {
  it('each voice role is a utility over the serif face and a weight token', () => {
    const app = readFileSync(join(STYLES, 'app.css'), 'utf8');
    for (const role of ['greeting', 'title', 'response']) {
      expect(app).toMatch(
        new RegExp(
          `@utility voice-${role} \\{\\s*font-family: var\\(--font-serif\\);\\s*font-weight: var\\(--voice-${role}-weight\\);`,
        ),
      );
    }
  });

  it('Chinese under the serif falls back to the sans CJK faces, as claude.ai does', () => {
    const fonts = readFileSync(join(STYLES, 'fonts.css'), 'utf8');
    const chain = /--font-source-serif:([^;]*);/.exec(fonts)?.[1] ?? '';
    expect(chain).toContain('"PingFang SC"');
    expect(chain).toContain('"Noto Sans CJK SC"');
    expect(chain).not.toMatch(/Songti|Serif CJK/);
  });

  it('the Greeting component is the greeting voice at the greeting size', () => {
    const greeting = read('components/stream/greeting.tsx');
    expect(greeting).toContain('voice-greeting text-greeting');
    expect(greeting).not.toContain('font-heading');
    expect(greeting).not.toContain('font-semibold');
  });

  it('no page h1 is set in the heading face', () => {
    const offenders = sources(SRC).flatMap((file) =>
      openingTags(readFileSync(file, 'utf8'), 'h1')
        .filter((attrs) => attrs.includes('font-heading'))
        .map(() => relative(SRC, file)),
    );
    expect(offenders).toEqual([]);
  });

  it('serif is only reached through a voice role', () => {
    const offenders = sources(SRC)
      .filter((file) => readFileSync(file, 'utf8').includes('font-serif'))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('page titles and the wordmark are the title voice', () => {
    expect(read('components/title-menu-trigger.tsx')).toMatch(/page: '[^']*voice-title text-page/);
    expect(read('pages/shell.tsx')).toContain('voice-title text-page');
    expect(read('components/settings-list.tsx')).toContain('voice-title text-page');
    expect(read('chief/chief-settings.tsx')).toContain('voice-title text-page');
    expect(read('board/sidebar.tsx')).toMatch(/sidebar-team-name[^"]*voice-title text-brand/);
  });

  it('agent replies are sans like the approved chat draft, not the response voice', () => {
    const rows = read('chief/chief-message-rows.tsx');
    expect(rows).toMatch(/BUBBLE_WRAP_CLS = [`'][^`']*font-sans/);
    expect(rows).not.toContain('voice-response');
    const transcript = read('detail/transcript.tsx');
    expect(transcript).toMatch(/font-sans[^"]*"\s*data-testid="agent-text"/);
    expect(read('chief/research-report.tsx')).toMatch(/data-testid="research-report-doc"\s*className="[^"]*font-sans/);
    expect(transcript).not.toContain('voice-response');
  });
});
