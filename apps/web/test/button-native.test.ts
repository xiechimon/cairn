import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button, rendersLink } from '../src/components/ui/button.js';

const markup = (props: Parameters<typeof Button>[0]) =>
  renderToStaticMarkup(createElement(Button, props));

describe('Button', () => {
  it('is a native button by default', () => {
    expect(markup({ children: 'Go' })).toMatch(/^<button[^>]*type="button"/);
  });

  it('keeps a link a link when it renders one, with no button role', () => {
    const html = markup({
      render: createElement('a', { href: '/x' }),
      children: 'Go',
      variant: 'ghost',
    });
    expect(html).toMatch(/^<a[^>]*href="\/x"/);
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('data-variant="ghost"');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('type="button"');
  });

  it('recognises a router link by its to prop', () => {
    expect(rendersLink(createElement('span', { to: '/x' }))).toBe(true);
  });

  it('does not treat other render targets as links', () => {
    expect(rendersLink(createElement('div'))).toBe(false);
    expect(rendersLink(undefined)).toBe(false);
  });
});
