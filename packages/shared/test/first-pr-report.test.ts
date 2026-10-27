import { describe, expect, it } from 'vitest';
import {
  FIRST_PR_DISCUSSION_BODY_FIELDS,
  FIRST_PR_DISCUSSION_CATEGORY,
  firstPrDiscussionUrl,
  teamRecordSchema,
} from '../src/index.js';

const OFF = { enabled: false, due: false, dismissedAt: null, firstPrAt: null, firstPrNumber: null };

function url(overrides: Partial<Parameters<typeof firstPrDiscussionUrl>[0]> = {}) {
  return firstPrDiscussionUrl({ daysToFirstPr: 3, ...overrides });
}

function decoded(urlText: string) {
  return new URL(urlText);
}

describe('the team-level first-PR prompt (issue #2001)', () => {
  it('defaults to off, not due, not dismissed', () => {
    const team = {
      id: 'team_1',
      name: 'Owner team',
      createdAt: 1,
      plan: 'free',
      avatarStyle: null,
      firstPrReportPrompt: OFF,
    };
    expect(teamRecordSchema.parse(team)).toEqual(team);
    expect(
      teamRecordSchema.safeParse({
        id: 'team_1',
        name: 'Owner team',
        createdAt: 1,
        plan: 'free',
        avatarStyle: null,
      }).success,
    ).toBe(true);
  });

  it('a malformed prompt state is rejected', () => {
    expect(
      teamRecordSchema.safeParse({
        id: 'team_1',
        name: 'Owner team',
        createdAt: 1,
        plan: 'free',
        avatarStyle: null,
        firstPrReportPrompt: { enabled: 'yes', due: false, dismissedAt: null },
      }).success,
    ).toBe(false);
  });
});

describe('the prefilled Discussions link', () => {
  it('points at the repository new-discussion form in the first-PR category', () => {
    const parsed = decoded(url());
    expect(parsed.origin).toBe('https://github.com');
    expect(parsed.pathname).toBe('/xiechimon/cairn/discussions/new');
    expect(parsed.searchParams.get('category')).toBe(FIRST_PR_DISCUSSION_CATEGORY);
    expect(FIRST_PR_DISCUSSION_CATEGORY).toBe('Q&A');
  });

  it('carries a short prefilled title', () => {
    const title = decoded(url()).searchParams.get('title') ?? '';
    expect(title.length).toBeGreaterThan(0);
    expect(title.length).toBeLessThanOrEqual(120);
  });

  it('encodes exactly the documented fields and nothing else', () => {
    const parsed = decoded(url());
    const body = parsed.searchParams.get('body') ?? '';
    const keys = body
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).split(':')[0]);
    expect(keys).toEqual([...FIRST_PR_DISCUSSION_BODY_FIELDS]);
  });

  it('the prefilled payload carries no repository name, PR URL, user, machine name or team id', () => {
    const parsed = decoded(url());
    const payload = [parsed.searchParams.get('title'), parsed.searchParams.get('body')].join('\n');
    for (const forbidden of [
      '/pull/',
      'team_1',
      'BoZYfvqKSGanlxsXVbXSa',
      'macbook',
      'owner@example.com',
      'secret-repo',
    ]) {
      expect(payload).not.toContain(forbidden);
    }
  });

  it('keeps the whole URL short enough that GitHub does not truncate it', () => {
    expect(url().length).toBeLessThanOrEqual(2000);
    expect(url({ daysToFirstPr: 3650 }).length).toBeLessThanOrEqual(2000);
  });

  it('omits the day count when the first PR predates the prompt', () => {
    const text = decodeURIComponent(url({ daysToFirstPr: null }));
    expect(text).not.toContain('days');
  });
});
