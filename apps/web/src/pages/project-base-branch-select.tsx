import { type ProjectRecord, projectBranchesResponseSchema } from '@cairn/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { FilterPicker } from '../components/filter-picker.js';
import { Popover, PopoverContent } from '../components/ui/popover.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

export function ProjectBaseBranchSelect({ project }: { project: ProjectRecord }) {
  const { t } = useI18n();
  const mutations = useApiMutations(project.teamId);
  const [anchorEl, setAnchorEl] = useState<HTMLSpanElement | null>(null);
  const [errorDismissedAt, setErrorDismissedAt] = useState(0);
  const branches = useQuery({
    queryKey: [
      'project-branches',
      project.id,
      project.repoKind,
      project.githubRepo,
      project.localPath,
    ],
    queryFn: async () =>
      projectBranchesResponseSchema.parse(await api.get(`/api/projects/${project.id}/branches`)),
  });
  const names = branches.data?.branches.map((branch) => branch.name) ?? [];
  const selected = project.baseBranch ?? '';
  const items = [
    {
      value: '',
      label: branches.data?.defaultBranch
        ? t('{branch}（默认）', { branch: branches.data.defaultBranch })
        : t('默认分支'),
    },
    ...(selected !== '' && !names.includes(selected) ? [{ value: selected, label: selected }] : []),
    ...names.map((name) => ({ value: name, label: name })),
  ];
  return (
    <>
      <span ref={setAnchorEl} className="inline-flex">
        <FilterPicker
          options={items}
          value={selected}
          disabled={branches.data === undefined || mutations.patchProject.isPending}
          onPick={(value) =>
            mutations.patchProject.mutate(
              { id: project.id, body: { baseBranch: value || null } },
              { onError: (error) => toastError(t('保存失败，请重试。'), error) },
            )
          }
          label={t('目标分支')}
          placeholder={t('搜索分支')}
          noun={t('分支')}
          triggerTestId="project-base-branch"
          triggerClassName="w-48"
        />
      </span>
      {anchorEl !== null && (
        <Popover
          open={branches.isError && branches.errorUpdatedAt !== errorDismissedAt}
          onOpenChange={(open) => {
            if (!open) setErrorDismissedAt(branches.errorUpdatedAt);
          }}
        >
          <PopoverContent
            anchor={anchorEl}
            align="start"
            sideOffset={6}
            collisionPadding={12}
            initialFocus={false}
            finalFocus={false}
            className="w-auto max-w-[min(20rem,calc(100vw-2rem))] p-2.5"
          >
            <p role="alert" className="m-0 text-meta text-destructive">
              {t('读取失败')}
            </p>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
