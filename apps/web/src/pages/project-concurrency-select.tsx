import type { ProjectRecord } from '@cairn/shared';
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

const LIMITS = [2, 3, 4, 6, 8] as const;

export function ProjectConcurrencySelect({ project }: { project: ProjectRecord }) {
  const { t } = useI18n();
  const mutations = useApiMutations(project.teamId);
  const items = [
    { value: '', label: t('不限（跟随 Runner 上限）') },
    { value: '1', label: t('串行，一次一个') },
    ...LIMITS.map((limit) => ({ value: String(limit), label: t('最多 {n} 个', { n: limit }) })),
  ];
  return (
    <Select
      items={items}
      value={project.maxConcurrent === undefined ? '' : String(project.maxConcurrent)}
      disabled={mutations.patchProject.isPending}
      onValueChange={(value) =>
        mutations.patchProject.mutate(
          { id: project.id, body: { maxConcurrent: value === '' ? null : Number(value) } },
          { onError: (error) => toastError(t('保存失败，请重试。'), error) },
        )
      }
    >
      <SelectTrigger
        data-testid="project-concurrency"
        aria-label={t('并发与优先级')}
        className="w-56"
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
  );
}
