import { parseSearchQuery } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { projectRedirectSearch } from '../src/pages/project-redirect.js';
import { searchTodosLocally } from '../src/search/local-search.js';
import { projectSyntaxExample, SYNTAX_ROWS } from '../src/search/search-query.js';
import { SETTINGS_SECTION_IDS } from '../src/settings/settings-href.js';
import { SETTINGS_ROW_INDEX } from '../src/settings/settings-index.js';
import { todo } from './helpers.js';

const NOW = Date.UTC(2026, 10, 4, 12);

describe('C20 search syntax, local search, and settings index coverage', () => {
  test('SYNTAX_ROWS does not advertise retired by:builder or demo project fallback', () => {
    for (const row of SYNTAX_ROWS) {
      expect(row.example).not.toContain('builder');
      expect(row.example).not.toContain('r3-lifecycle');
    }
    expect(projectSyntaxExample('atlas')).toBe('project:atlas');
    expect(projectSyntaxExample('my app')).toBe('project:"my app"');
    expect(projectSyntaxExample(null)).toBe('');
  });

  test('local search supports NFKC folding, todo.spec, #seqNum, multi-word AND, and -exclude', () => {
    const records = [
      {
        ...todo(42, 'todo'),
        id: 't-42',
        title: 'Fix OAuth login',
        spec: 'Refresh token rotation for mobile clients',
      },
      {
        ...todo(43, 'todo'),
        id: 't-43',
        title: 'Fix legacy login',
        spec: 'Old flow',
      },
    ];
    const searchIds = (q: string) =>
      searchTodosLocally(records, () => 'atlas', parseSearchQuery(q, NOW)).todos.map((t) => t.id);

    expect(searchIds('rotation mobile')).toEqual(['t-42']);
    expect(searchIds('#42')).toEqual(['t-42']);
    expect(searchIds('＃４２')).toEqual(['t-42']);
    expect(searchIds('ＦＩＸ login -legacy')).toEqual(['t-42']);
  });

  test('SETTINGS_ROW_INDEX covers every settings section and key user terms', () => {
    const coveredSections = new Set(SETTINGS_ROW_INDEX.map((entry) => entry.section));
    for (const id of SETTINGS_SECTION_IDS) {
      expect(coveredSections.has(id), `missing settings section in index: ${id}`).toBe(true);
    }

    const matchSections = (term: string) => {
      const needle = term.normalize('NFKC').toLowerCase();
      return SETTINGS_ROW_INDEX.filter(
        (entry) =>
          entry.label.normalize('NFKC').toLowerCase().includes(needle) ||
          (entry.keywords ?? []).some((kw) => kw.normalize('NFKC').toLowerCase().includes(needle)),
      ).map((entry) => entry.section);
    };

    expect(matchSections('resident')).toContain('machines');
    expect(matchSections('model')).toContain('routing');
    expect(matchSections('usage')).toContain('routing');
    expect(matchSections('api key')).toContain('api-keys');
    expect(matchSections('secret')).toContain('secrets');
    expect(matchSections('vault')).toContain('vault');
    expect(matchSections('skill')).toContain('skills');
    expect(matchSections('github')).toContain('mcp');
    expect(matchSections('composio')).toContain('mcp');
    expect(matchSections('mail')).toContain('mcp');
    expect(matchSections('telegram')).toContain('im');
    expect(matchSections('slack')).toContain('im');
    expect(matchSections('wechat')).toContain('im');
    expect(matchSections('imessage')).toContain('im');
    expect(matchSections('tailscale')).toContain('remote');
    expect(matchSections('language')).toContain('account');
    expect(matchSections('notification')).toContain('account');
    expect(matchSections('schedule')).toContain('account');
  });

  test('projectRedirectSearch clears mutually exclusive query params on project and schedule jumps', () => {
    const fromProject = new URLSearchParams(
      'scenario=01&project=p1&chat=1&thread=t1&view=diff&artifact=a1&artifactName=x&chief=c1',
    );
    expect(projectRedirectSearch(fromProject, { pane: 'tasks', tab: 'scheduled' })).toBe(
      '?scenario=01&pane=tasks&tab=scheduled',
    );

    const toAnotherProject = projectRedirectSearch(fromProject, { id: 'p2' });
    expect(toAnotherProject).toBe('?scenario=01&project=p2&chat=1');
  });
});
