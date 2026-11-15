import type { SkillImportCandidate } from '@cairn/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations, useSkillImportCandidates } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { SegmentedTabs } from '../components/segmented.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { FieldError } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';

type Tab = 'local' | 'source';

interface Fields {
  localPath: string;
  url: string;
}

interface ErrorCopy {
  headline: string;
  detail: string;
}

const PROBLEM_COPY: Record<NonNullable<SkillImportCandidate['problem']>, string> = {
  'missing-name': 'SKILL.md 缺少名称',
  'invalid-name': '名称不能用作目录名',
  'missing-description': 'SKILL.md 缺少描述',
};

function serverErrorCopy(err: unknown, t: (s: string) => string): ErrorCopy {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return { headline: t('同名技能已存在——先处理现有技能，再重新导入。'), detail: err.message };
    }
    if (err.status === 400) {
      return { headline: t('来源未通过校验。'), detail: err.message };
    }
    if (err.status === 502 || err.status === 504) {
      return { headline: t('拉取来源失败——稍后重试。'), detail: err.message };
    }
    return { headline: t('导入失败，请重试。'), detail: err.message };
  }
  return { headline: t('导入失败，请重试。'), detail: String(err) };
}

function ErrorLine({ error }: { error: ErrorCopy }) {
  return (
    <FieldError>
      {error.headline}
      {error.detail !== '' && (
        <span className="mt-0.5 block text-muted-foreground">{error.detail}</span>
      )}
    </FieldError>
  );
}

function CandidateList({
  candidates,
  selected,
  failed,
  onToggle,
}: {
  candidates: SkillImportCandidate[];
  selected: Set<string>;
  failed: Map<string, ErrorCopy>;
  onToggle: (c: SkillImportCandidate) => void;
}) {
  const { t } = useI18n();
  const selectedIds = new Set(
    candidates.filter((c) => selected.has(c.sourcePath)).map((c) => c.id),
  );
  return (
    <div
      data-testid="skill-candidates"
      className="max-h-80 overflow-y-auto rounded-md border border-border bg-card dark:bg-input/30"
    >
      {candidates.map((c, index) => {
        const checkboxId = `skill-candidate-${index}`;
        const checked = selected.has(c.sourcePath);
        const reason = c.alreadyImported
          ? t('已导入')
          : c.problem !== null
            ? t(PROBLEM_COPY[c.problem])
            : !checked && selectedIds.has(c.id)
              ? t('已勾选另一个同名技能')
              : null;
        const error = failed.get(c.sourcePath);
        return (
          <label
            key={c.sourcePath}
            htmlFor={checkboxId}
            data-testid="skill-candidate"
            data-skill-id={c.id}
            className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2 last:border-b-0 has-disabled:cursor-default"
          >
            <Checkbox
              id={checkboxId}
              className="mt-0.5"
              checked={checked}
              disabled={reason !== null}
              onCheckedChange={() => onToggle(c)}
              aria-label={c.id}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-ui text-foreground">{c.id}</span>
                {reason !== null && (
                  <span className="shrink-0 text-meta text-content-tertiary">{reason}</span>
                )}
              </span>
              {c.description !== null && (
                <span className="line-clamp-2 text-meta text-content-secondary">
                  {c.description}
                </span>
              )}
              <span className="truncate font-mono text-meta text-content-tertiary">
                {c.sourcePath}
              </span>
              {error !== undefined && <ErrorLine error={error} />}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function SkillImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [tab, setTab] = useState<Tab>('local');
  const [fields, setFields] = useState<Fields | null>(null);
  const [error, setError] = useState<ErrorCopy | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Map<string, ErrorCopy>>(new Map());
  const [importing, setImporting] = useState(false);
  const candidatesQ = useSkillImportCandidates(teamId, open && live && tab === 'local');

  useEffect(() => {
    if (!open) {
      setFields(null);
      setError(null);
      setQuery('');
      setSelected(new Set());
      setFailed(new Map());
      setTab('local');
      return;
    }
    setFields({ localPath: '', url: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialize fields only on the open/close edge
  }, [open]);

  const candidates = candidatesQ.data?.candidates ?? [];
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ''
      ? candidates
      : candidates.filter(
          (c) =>
            c.id.toLowerCase().includes(needle) ||
            (c.description ?? '').toLowerCase().includes(needle),
        );

  const localFilled = fields !== null && fields.localPath.trim() !== '';
  const urlFilled = fields !== null && fields.url.trim() !== '';
  const busy = importing || mutations.importSkill.isPending;
  const submittable =
    !busy && (tab === 'local' ? selected.size > 0 : fields !== null && localFilled !== urlFilled);

  const toggle = (c: SkillImportCandidate) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c.sourcePath)) next.delete(c.sourcePath);
      else next.add(c.sourcePath);
      return next;
    });

  const importPicked = async () => {
    setImporting(true);
    const errors = new Map<string, ErrorCopy>();
    for (const sourcePath of selected) {
      try {
        await mutations.importSkill.mutateAsync({ localPath: sourcePath });
      } catch (err) {
        errors.set(sourcePath, serverErrorCopy(err, t));
      }
    }
    setImporting(false);
    if (errors.size === 0) {
      onClose();
      return;
    }
    setFailed(errors);
    setSelected(new Set(errors.keys()));
  };

  const submit = () => {
    if (!submittable) return;
    if (!live) {
      blockDemoWrite();
      onClose();
      return;
    }
    setError(null);
    if (tab === 'local') {
      void importPicked();
      return;
    }
    if (fields === null) return;
    const body = localFilled ? { localPath: fields.localPath.trim() } : { url: fields.url.trim() };
    mutations.importSkill.mutate(body, {
      onSuccess: onClose,
      onError: (err) => setError(serverErrorCopy(err, t)),
    });
  };

  const primaryLabel =
    tab === 'local' && selected.size > 0
      ? t('导入 {count} 个', { count: selected.size })
      : t('导入');

  return (
    <DialogShell
      title={t('导入技能')}
      open={open}
      onClose={onClose}
      size="m"
      footer={
        <FormActions
          className="pt-0"
          primary={{ label: primaryLabel, onClick: submit, disabled: !submittable }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      {fields === null ? null : (
        <FormStack className="max-w-none">
          <SegmentedTabs
            slide
            value={tab}
            onChange={setTab}
            options={[
              { value: 'local', label: t('从本机选择'), testId: 'skill-import-tab-local' },
              { value: 'source', label: t('路径或 GitHub'), testId: 'skill-import-tab-source' },
            ]}
          />
          {tab === 'local' ? (
            <>
              <Input
                aria-label={t('搜索技能')}
                className={FORM_CONTROL_CLS}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('搜索技能')}
              />
              {candidatesQ.isError ? (
                <ErrorLine error={serverErrorCopy(candidatesQ.error, t)} />
              ) : candidatesQ.isPending && live ? null : shown.length === 0 ? (
                <p data-testid="skill-candidates-empty" className="text-meta text-content-tertiary">
                  {candidates.length === 0
                    ? t('本机 ~/.agents/skills 和 ~/.claude/skills 里没有技能。')
                    : t('没有匹配的技能。')}
                </p>
              ) : (
                <CandidateList
                  candidates={shown}
                  selected={selected}
                  failed={failed}
                  onToggle={toggle}
                />
              )}
              <p className="text-meta text-content-tertiary">
                {t('导入会把技能复制到 Cairn 自己的目录，原目录不会被改动。')}
              </p>
            </>
          ) : (
            <>
              <FormField
                label={t('本地路径')}
                htmlFor="dlg-skill-import-path"
                help={t('server 本机上的技能目录路径，目录里要有 SKILL.md。')}
              >
                <Input
                  id="dlg-skill-import-path"
                  className={FORM_CONTROL_CLS}
                  value={fields.localPath}
                  onChange={(event) =>
                    setFields((f) => f && { ...f, localPath: event.target.value })
                  }
                  placeholder="/Users/you/skills/deploy-to-prod"
                />
              </FormField>
              <FormField
                label={t('GitHub 地址')}
                htmlFor="dlg-skill-import-url"
                help={t('GitHub 公共仓库或其中子目录的地址；导入后可用 refresh 重新拉取。')}
              >
                <Input
                  id="dlg-skill-import-url"
                  className={FORM_CONTROL_CLS}
                  value={fields.url}
                  onChange={(event) => setFields((f) => f && { ...f, url: event.target.value })}
                  placeholder="https://github.com/anthropics/skills/tree/main/document-skills/pdf"
                />
              </FormField>
              {localFilled && urlFilled ? (
                <FieldError>{t('两字段二选一：填其中一个，另一个留空。')}</FieldError>
              ) : null}
              {error !== null && <ErrorLine error={error} />}
            </>
          )}
        </FormStack>
      )}
    </DialogShell>
  );
}
