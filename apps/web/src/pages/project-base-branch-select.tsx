import { type ProjectRecord, projectBranchesResponseSchema } from '@cairn/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

export function ProjectBaseBranchSelect({ project }: { project: ProjectRecord }) {
  const { t } = useI18n();
  const mutations = useApiMutations(project.teamId);
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
      <Select
        items={items}
        value={selected}
        disabled={branches.data === undefined || mutations.patchProject.isPending}
        onValueChange={(value) =>
          mutations.patchProject.mutate(
            { id: project.id, body: { baseBranch: value || null } },
            { onError: (error) => toastError(t('保存失败，请重试。'), error) },
          )
        }
      >
        <SelectTrigger
          data-testid="project-base-branch"
          aria-label={t('目标分支')}
          className="w-48"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {branches.isError && (
        <span role="alert" className="text-meta text-destructive">
          {t('读取失败')}
        </span>
      )}
    </>
  );
}
