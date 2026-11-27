import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  SettingsCard,
  SettingsFlat,
  SettingsHeader,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from '../src/components/settings-list.js';

describe('settings account alignment and heading font', () => {
  it('omits px-1 on SettingsSection headings inside SettingsRows so they align with px-0 rows', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsRows, {
        children: createElement(SettingsSection, {
          title: 'Appearance',
          testId: 'account-appearance',
          children: createElement(SettingsCard, {
            children: createElement(SettingsRow, { label: 'Color theme', children: 'control' }),
          }),
        }),
      }),
    );
    const headerMatch = /<div class="([^"]*)">\s*<div[^>]*>\s*<h2\b/.exec(html);
    expect(headerMatch).not.toBeNull();
    expect(headerMatch?.[1]?.split(/\s+/)).not.toContain('px-1');
  });

  it('keeps px-1 on SettingsSection headings for standalone card sections and omits it in SettingsFlat', () => {
    const cardHtml = renderToStaticMarkup(
      createElement(SettingsSection, {
        title: 'Standalone',
        children: createElement(SettingsCard, {
          children: createElement(SettingsRow, { label: 'Item', children: 'control' }),
        }),
      }),
    );
    const cardHeaderMatch = /<div class="([^"]*)">\s*<div[^>]*>\s*<h2\b/.exec(cardHtml);
    expect(cardHeaderMatch?.[1]?.split(/\s+/)).toContain('px-1');

    const flatHtml = renderToStaticMarkup(
      createElement(SettingsFlat, {
        children: createElement(SettingsSection, {
          title: 'Flat',
          children: createElement(SettingsCard, {
            children: createElement(SettingsRow, { label: 'Item', children: 'control' }),
          }),
        }),
      }),
    );
    const flatHeaderMatch = /<div class="([^"]*)">\s*<div[^>]*>\s*<h2\b/.exec(flatHtml);
    expect(flatHeaderMatch?.[1]?.split(/\s+/)).not.toContain('px-1');
  });

  it('renders SettingsHeader title in the sans heading voice matching the settings page', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsRows, {
        children: createElement(SettingsHeader, { title: 'Alice' }),
      }),
    );
    const headingMatch = /<h2 class="([^"]*)">Alice<\/h2>/.exec(html);
    expect(headingMatch).not.toBeNull();
    const classes = headingMatch?.[1]?.split(/\s+/) ?? [];
    expect(classes).not.toContain('voice-title');
    expect(classes).not.toContain('text-page');
    expect(classes).toContain('text-heading');
    expect(classes).toContain('font-title');
    const wrapperMatch = /^<div class="([^"]*)">/.exec(html);
    expect(wrapperMatch?.[1]?.split(/\s+/)).not.toContain('px-1');
  });
});
