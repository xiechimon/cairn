import { PROJECT_INSTRUCTIONS_MAX, type ProjectRecord } from '@cairn/shared';
import { cn } from 'cn';
import { useState } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { Textarea } from '../components/ui/textarea.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

export function ProjectInstructionsField({
  project,
  teamId,
  named = false,
  testId,
}: {
  project: Pick<ProjectRecord, 'id' | 'name' | 'instructions'>;
  teamId: string | undefined;
  named?: boolean;
  testId?: string;
}) {
  const { t } = useI18n();
  const mutations = useApiMutations(teamId);
  const [draft, setDraft] = useState<string | null>(null);
  const saved = project.instructions ?? '';
  const value = draft ?? saved;
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label={named ? t('{name} 的项目说明', { name: project.name }) : t('项目说明')}
        data-testid={testId}
        className="min-h-28 w-full"
        maxLength={PROJECT_INSTRUCTIONS_MAX}
        placeholder={t('例如：仓库内容用英文；改动后跑 pnpm lint；不要 force push。')}
        value={value}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex items-center justify-end gap-3">
        <span className="text-meta tabular-nums text-content-tertiary">
          {`${value.length.toLocaleString('en')} / ${PROJECT_INSTRUCTIONS_MAX.toLocaleString('en')}`}
        </span>
        <Button
          className={cn(DIALOG_PRIMARY_BUTTON)}
          aria-label={
            named ? t('保存 {name} 的项目说明', { name: project.name }) : t('保存项目说明')
          }
          disabled={mutations.patchProject.isPending || value === saved}
          onClick={() => {
            const next = value.trim();
            mutations.patchProject.mutate(
              { id: project.id, body: { instructions: next === '' ? null : next } },
              {
                onSuccess: () => setDraft(null),
                onError: (error) => toastError(t('项目说明保存失败，请重试。'), error),
              },
            );
          }}
        >
          {t('保存')}
        </Button>
      </div>
    </div>
  );
}
