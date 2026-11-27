import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { ChangesCard } from '../src/board/side-chat.js';
import { deriveThreadChanges } from '../src/board/thread-changes.js';
import { EN } from '../src/i18n/en.js';
import { I18nProvider } from '../src/i18n/provider.js';

function renderCard(props: {
  plainFolder?: NonNullable<ReturnType<typeof deriveThreadChanges>['plainFolder']>;
  files?: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
    hunks: [];
  }>;
  undoSubmitting?: boolean;
  onUndo?: () => void;
}): string {
  const changes = deriveThreadChanges({
    live: true,
    buildId: 'build-1',
    query: {
      status: 'success',
      data: {
        files: props.files ?? [],
        reported: true,
        ...(props.plainFolder !== undefined ? { plainFolder: props.plainFolder } : {}),
      },
    },
    fixture: undefined,
    expanded: true,
  });
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(ChangesCard, {
        changes,
        buildId: 'build-1',
        open: false,
        onOpenChange: () => {},
        onRetry: () => {},
        ...(props.undoSubmitting !== undefined ? { undoSubmitting: props.undoSubmitting } : {}),
        ...(props.onUndo !== undefined ? { onUndo: props.onUndo } : {}),
      }),
    }),
  );
}

describe('plain-folder task panel undo UI', () => {
  test('renders only the single Undo button for merged plain-folder builds, never checkpoint timelines or extra buttons', () => {
    const html = renderCard({
      files: [{ path: 'notes.md', status: 'modified', additions: 2, deletions: 0, hunks: [] }],
      plainFolder: {
        mode: 'isolated',
        status: 'merged',
        undoable: true,
        undoPending: false,
      },
      onUndo: vi.fn(),
    });
    expect(html).toContain('data-testid="undo-task-changes"');
    expect(html).toContain('撤销这次任务的改动');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('data-testid="plain-folder-conflict"');
    expect(html.match(/<button/g)?.length).toBe(2);
  });

  test('disables Undo and shows 正在撤销… during rapid click submission or server undoPending', () => {
    const submittingHtml = renderCard({
      files: [{ path: 'notes.md', status: 'modified', additions: 1, deletions: 0, hunks: [] }],
      plainFolder: {
        mode: 'isolated',
        status: 'merged',
        undoable: true,
        undoPending: false,
      },
      undoSubmitting: true,
      onUndo: vi.fn(),
    });
    expect(submittingHtml).toContain('data-testid="undo-task-changes"');
    expect(submittingHtml).toContain('disabled=""');
    expect(submittingHtml).toContain('正在撤销…');

    const serverPendingHtml = renderCard({
      files: [{ path: 'notes.md', status: 'modified', additions: 1, deletions: 0, hunks: [] }],
      plainFolder: {
        mode: 'in-place',
        status: 'merged',
        undoable: true,
        undoPending: true,
      },
      onUndo: vi.fn(),
    });
    expect(serverPendingHtml).toContain('disabled=""');
    expect(serverPendingHtml).toContain('正在撤销…');
  });

  test('settles to 已撤销改动 when status is undone, even with empty diff files', () => {
    const changes = deriveThreadChanges({
      live: true,
      buildId: 'build-1',
      query: {
        status: 'success',
        data: {
          files: [],
          reported: true,
          plainFolder: {
            mode: 'isolated',
            status: 'undone',
            undoable: false,
            undoPending: false,
          },
        },
      },
      fixture: undefined,
      expanded: true,
    });
    expect(changes.status).toBe('ready');

    const html = renderCard({
      plainFolder: {
        mode: 'isolated',
        status: 'undone',
        undoable: false,
        undoPending: false,
      },
      onUndo: vi.fn(),
    });
    expect(html).toContain('本地文件夹改动');
    expect(html).toContain('data-testid="undo-task-changes-done"');
    expect(html).toContain('已撤销改动');
    expect(html).not.toContain('data-testid="undo-task-changes"');
  });

  test('keeps ChangesCard ready and shows role="alert" on conflict or snapshot-missing/partial-unknown even when diff hunks are empty', () => {
    for (const plainFolder of [
      {
        mode: 'isolated' as const,
        status: 'conflict' as const,
        undoable: false,
        undoPending: false,
        conflictFiles: ['notes.md'],
        error: '合并冲突：notes.md',
      },
      {
        mode: 'isolated' as const,
        status: 'snapshot-missing' as const,
        undoable: false,
        undoPending: false,
        error: '历史快照已被清理或缺失，无法自动撤销',
      },
    ]) {
      const changes = deriveThreadChanges({
        live: true,
        buildId: 'build-1',
        query: { status: 'success', data: { files: [], reported: true, plainFolder } },
        fixture: undefined,
        expanded: true,
      });
      expect(changes.status).toBe('ready');

      const html = renderCard({ plainFolder, onUndo: vi.fn() });
      expect(html).toContain('role="alert"');
      expect(html).toContain('data-testid="plain-folder-conflict"');
      expect(html).toContain(plainFolder.error);
      expect(html).not.toContain('data-testid="undo-task-changes"');
    }
  });

  test('standard Git / GitHub / hosted builds render zero Undo button', () => {
    const html = renderCard({
      files: [{ path: 'src/index.ts', status: 'modified', additions: 3, deletions: 1, hunks: [] }],
      plainFolder: undefined,
      onUndo: vi.fn(),
    });
    expect(html).not.toContain('data-testid="undo-task-changes"');
    expect(html).not.toContain('data-testid="undo-task-changes-done"');
    expect(html).not.toContain('撤销这次任务的改动');
  });

  test('en translations exist for every plain-folder ChangesCard UI string', () => {
    expect(EN['本地文件夹改动']).toBe('Local folder changes');
    expect(EN['撤销这次任务的改动']).toBe("Undo this task's changes");
    expect(EN['正在撤销…']).toBe('Undoing…');
    expect(EN['已撤销改动']).toBe('Undone');
    expect(EN['撤销失败，请重试。']).toBe('Undo failed. Please try again.');
  });
});
