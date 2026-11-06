import { describe, expect, it } from 'vitest';
import { buttonVariants } from '../src/components/ui/button.js';

describe('ghost icon buttons', () => {
  it.each(['icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const)(
    '%s is flat with no focus halo and a hover background',
    (size) => {
      const cls = buttonVariants({ variant: 'ghost', size });
      expect(cls).toContain('shadow-none');
      expect(cls).toContain('focus-visible:ring-0');
      expect(cls).toContain('hover:bg-muted');
    },
  );

  it('keeps the focus halo on text ghost buttons', () => {
    expect(buttonVariants({ variant: 'ghost', size: 'default' })).not.toContain(
      'focus-visible:ring-0',
    );
  });
});
