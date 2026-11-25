import { MAX_SKILL_FILE_BYTES, SKILL_DIR_NAME_RE, SKILL_ENTRY_FILE } from '@cairn/shared';
import {
  buildSkillEntry,
  parseSkillFrontmatter,
  splitSkillEntry,
} from '@cairn/shared/skill-frontmatter';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations, useSkillFile } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FORM_CONTROL_CLS, FormField, FormStack } from '../components/form-layout.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { FieldDescription, FieldError } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import { Textarea } from '../components/ui/textarea.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { FORM_TEXTAREA_CLS } from './parts.js';

export interface SkillEditTarget {
  id: string;
  name: string;
  description: string;
  imported?: boolean;
}

interface Fields {
  name: string;
  description: string;
  body: string;
}

function serverErrorCopy(
  err: unknown,
  t: (s: string) => string,
): { headline: string; detail: string } {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return {
        headline: t('同名技能已存在——请更换名称，或从列表打开它编辑。'),
        detail: err.message,
      };
    }
    if (err.status === 404) {
      return { headline: t('该技能已不存在——可能刚被移动或删除。'), detail: err.message };
    }
    if (err.status === 400) {
      return { headline: t('内容未通过校验。'), detail: err.message };
    }
    return { headline: t('保存失败，请重试。'), detail: err.message };
  }
  return { headline: t('保存失败，请重试。'), detail: '' };
}

export function SkillDialog({
  open,
  onClose,
  skill,
}: {
  open: boolean;
  onClose: () => void;
  skill?: SkillEditTarget;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const qc = useQueryClient();
  const editing = skill !== undefined;
  const [fields, setFields] = useState<Fields | null>(null);
  const [initial, setInitial] = useState<Fields | null>(null);
  const [error, setError] = useState<{ headline: string; detail: string } | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const fileQ = useSkillFile(teamId, skill?.id, open && live && editing);

  useEffect(() => {
    if (!open) {
      setFields(null);
      setInitial(null);
      setError(null);
      setDiscardConfirm(false);
      setDeleteConfirm(false);
      return;
    }
    if (!editing) {
      const blank = { name: '', description: '', body: '' };
      setFields(blank);
      setInitial(blank);
    } else if (!live) {
      const seeded = { name: skill.name, description: skill.description, body: '' };
      setFields(seeded);
      setInitial(seeded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialize fields only on the open/close edge
  }, [open]);

  useEffect(() => {
    if (!open || !editing || !live || fields !== null) return;
    if (fileQ.data === undefined) return;
    const split = splitSkillEntry(fileQ.data.content);
    const loaded = {
      name: split.name ?? skill.name,
      description: split.description ?? skill.description,
      body: split.body,
    };
    setFields(loaded);
    setInitial(loaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fields===null is the load gate
  }, [open, editing, live, fields, fileQ.data]);

  useEffect(() => {
    if (!open || !(fileQ.error instanceof ApiError)) return;
    if (fileQ.error.status === 404) {
      void qc.invalidateQueries({ queryKey: ['skills'] });
    }
    setError(serverErrorCopy(fileQ.error, t));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only when the error object identity changes
  }, [open, fileQ.error]);

  const entry =
    fields === null
      ? ''
      : buildSkillEntry(fields.name.trim(), fields.description.trim(), fields.body);
  const entryBytes = new TextEncoder().encode(entry).length;
  const nameBad = fields !== null && fields.name !== '' && !SKILL_DIR_NAME_RE.test(fields.name);
  const tooLarge = fields !== null && entryBytes > MAX_SKILL_FILE_BYTES;
  const roundTripBad =
    fields !== null &&
    fields.name.trim() !== '' &&
    fields.description.trim() !== '' &&
    (() => {
      const fm = parseSkillFrontmatter(entry);
      return fm.name !== fields.name.trim() || fm.description !== fields.description.trim();
    })();
  const busy =
    mutations.createSkill.isPending ||
    mutations.updateSkill.isPending ||
    mutations.deleteSkill.isPending ||
    mutations.refreshSkill.isPending;
  const dirty =
    fields !== null &&
    initial !== null &&
    (fields.name !== initial.name ||
      fields.description !== initial.description ||
      fields.body !== initial.body);
  const submittable =
    fields !== null &&
    fields.name.trim() !== '' &&
    !nameBad &&
    fields.description.trim() !== '' &&
    !tooLarge &&
    !roundTripBad &&
    !busy;

  const requestClose = () => {
    if (busy) return;
    if (dirty) {
      setDiscardConfirm(true);
      return;
    }
    onClose();
  };

  const remove = () => {
    if (!editing) return;
    setDeleteConfirm(false);
    if (!live) {
      blockDemoWrite();
      onClose();
      return;
    }
    setError(null);
    mutations.deleteSkill.mutate(skill.id, {
      onSuccess: onClose,
      onError: (err) => setError(serverErrorCopy(err, t)),
    });
  };

  const refresh = () => {
    if (!editing || !live || busy) return;
    setError(null);
    mutations.refreshSkill.mutate(skill.id, {
      onSuccess: () => {
        setFields(null);
        setInitial(null);
        void fileQ.refetch();
      },
      onError: (err) => setError(serverErrorCopy(err, t)),
    });
  };

  const submit = () => {
    if (fields === null || !submittable) return;
    const body = {
      name: fields.name.trim(),
      description: fields.description.trim(),
      files: [{ path: SKILL_ENTRY_FILE, content: entry }],
    };
    if (!live) {
      blockDemoWrite();
      onClose();
      return;
    }
    setError(null);
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.status === 404) {
        void qc.invalidateQueries({ queryKey: ['skills'] });
      }
      setError(serverErrorCopy(err, t));
    };
    if (editing) {
      mutations.updateSkill.mutate({ id: skill.id, body }, { onSuccess: onClose, onError });
    } else {
      mutations.createSkill.mutate(body, { onSuccess: onClose, onError });
    }
  };

  return (
    <>
      <DialogShell
        title={editing ? t('编辑技能') : t('新建技能')}
        open={open}
        onClose={requestClose}
        size="m"
        footer={
          <div className="flex w-full items-center gap-2">
            {editing && live && (
              <Button
                variant="ghost"
                className={`${DIALOG_TEXT_BUTTON} text-destructive`}
                onClick={() => setDeleteConfirm(true)}
                disabled={busy}
                data-testid="skill-dialog-delete"
              >
                {t('删除')}
              </Button>
            )}
            {editing && live && skill.imported === true && (
              <Button
                variant="ghost"
                className={DIALOG_TEXT_BUTTON}
                onClick={refresh}
                disabled={busy}
                data-testid="skill-dialog-refresh"
              >
                {mutations.refreshSkill.isPending ? t('刷新中…') : t('刷新')}
              </Button>
            )}
            <span className="flex-1" />
            <Button
              variant="ghost"
              className={DIALOG_TEXT_BUTTON}
              onClick={requestClose}
              disabled={busy}
            >
              {t('取消')}
            </Button>
            <Button className={DIALOG_PRIMARY_BUTTON} onClick={submit} disabled={!submittable}>
              {editing ? t('保存') : t('新建技能')}
            </Button>
          </div>
        }
      >
        {error !== null && fields === null ? (
          <FormStack className="max-w-none">
            <FieldError>
              {error.headline}
              {error.detail !== '' && (
                <span className="mt-0.5 block text-content-tertiary">{error.detail}</span>
              )}
            </FieldError>
          </FormStack>
        ) : fields === null ? (
          <FormStack className="max-w-none">
            <FieldDescription>{t('正在读取 SKILL.md…')}</FieldDescription>
          </FormStack>
        ) : (
          <FormStack className="max-w-none">
            <FormField label={t('名称')} htmlFor="dlg-skill-name">
              <Input
                id="dlg-skill-name"
                className={FORM_CONTROL_CLS}
                value={fields?.name ?? ''}
                onChange={(event) => setFields((f) => f && { ...f, name: event.target.value })}
                placeholder="deploy-to-prod"
              />
              {nameBad && (
                <FieldError>
                  {t('名称须以字母或数字开头，只能含字母、数字、点、横杠、下划线，最长 64 字符。')}
                </FieldError>
              )}
            </FormField>
            <FormField label={t('描述')} htmlFor="dlg-skill-desc">
              <Input
                id="dlg-skill-desc"
                className={FORM_CONTROL_CLS}
                value={fields?.description ?? ''}
                onChange={(event) =>
                  setFields((f) => f && { ...f, description: event.target.value })
                }
                placeholder={t('这个技能做什么、什么时候用它。')}
              />
              {roundTripBad && (
                <FieldError>
                  {t('描述不要用引号整体包裹——保存时引号会被剥去，与表单值不一致。')}
                </FieldError>
              )}
            </FormField>
            <FormField label={t('SKILL.md 正文')} htmlFor="dlg-skill-body">
              <Textarea
                id="dlg-skill-body"
                className={`min-h-40 font-mono ${FORM_TEXTAREA_CLS}`}
                value={fields?.body ?? ''}
                onChange={(event) => setFields((f) => f && { ...f, body: event.target.value })}
              />
              <FieldDescription className="text-meta text-content-tertiary">
                {editing
                  ? t('名称和描述由上方表单自动写入；未在此编辑的文件保持原样。')
                  : t('名称和描述由上方表单自动写入，这里只写正文。')}
              </FieldDescription>
              {tooLarge && (
                <FieldError>
                  {t('内容超出单文件上限（{limit} KB）。', {
                    limit: Math.round(MAX_SKILL_FILE_BYTES / 1000),
                  })}
                </FieldError>
              )}
            </FormField>
            {error !== null && (
              <FieldError>
                {error.headline}
                {error.detail !== '' && (
                  <span className="mt-0.5 block text-content-tertiary">{error.detail}</span>
                )}
              </FieldError>
            )}
          </FormStack>
        )}
      </DialogShell>
      <AlertDialogShell
        open={discardConfirm}
        title={t('放弃未保存的修改？')}
        ariaLabel={t('放弃修改')}
        onClose={() => setDiscardConfirm(false)}
        footer={
          <AlertDialogActions
            cancelLabel={t('继续编辑')}
            confirmLabel={t('放弃修改')}
            onCancel={() => setDiscardConfirm(false)}
            onConfirm={() => {
              setDiscardConfirm(false);
              onClose();
            }}
          />
        }
      >
        <p className="m-0 text-ui text-content-secondary">{t('关闭后，未保存的修改会丢失。')}</p>
      </AlertDialogShell>
      <DeleteConfirm
        open={deleteConfirm}
        title={t('确定删除这个技能？此操作不可撤销。')}
        summary={skill?.name ?? ''}
        ariaLabel={t('删除 {name}', { name: skill?.name ?? '' })}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={remove}
      />
    </>
  );
}
