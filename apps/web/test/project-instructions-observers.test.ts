import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { ProjectInstructionsField } from '../src/board/project-instructions-field.js';
import { I18nProvider } from '../src/i18n/provider.js';

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...original, useMutation: vi.fn(original.useMutation) };
});

test('an instructions field mounts only the mutation observer it needs', () => {
  vi.mocked(useMutation).mockClear();
  const client = new QueryClient();
  renderToString(
    createElement(QueryClientProvider, { client },
      createElement(I18nProvider, { initialLocale: 'en', children:
        createElement(ProjectInstructionsField, { project: { id: 'p1', instructions: 'Saved' }, teamId: 't1' }),
      }),
    ),
  );
  expect(vi.mocked(useMutation).mock.calls).toHaveLength(1);
  client.clear();
});
