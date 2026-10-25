import {
  buildSkillEntry,
  MAX_SKILL_FILE_BYTES,
  parseSkillFrontmatter,
  SKILL_DIR_NAME_RE,
  SKILL_ENTRY_FILE,
  splitSkillEntry,
} from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations, useSkillFile } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { FieldDescription, FieldError } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { FORM_TEXTAREA_CLS } from './parts.js';

export interface SkillEditTarget {
  id: string;
  name: string;
  description: string;
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
        headline: t('同名技能已存在——换个名称，或从列表打开它编辑。'),
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
  return { headline: t('保存失败，请重试。'), detail: String(err) };
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
  const [error, setError] = useState<{ headline: string; detail: string } | null>(null);

  const fileQ = useSkillFile(teamId, skill?.id, open && live && editing);

  useEffect(() => {
    if (!open) {
      setFields(null);
      setError(null);
      return;
    }
    if (!editing) {
      setFields({ name: '', description: '', body: '' });
    } else if (!live) {
      setFields({ name: skill.name, description: skill.description, body: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialize fields only on the open/close edge
  }, [open]);

  useEffect(() => {
    if (!open || !editing || !live || fields !== null) return;
    if (fileQ.data === undefined) return;
    const split = splitSkillEntry(fileQ.data.content);
    setFields({
      name: split.name ?? skill.name,
      description: split.description ?? skill.description,
      body: split.body,
    });
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
  const submittable =
    fields !== null &&
    fields.name.trim() !== '' &&
    !nameBad &&
    fields.description.trim() !== '' &&
    !tooLarge &&
    !roundTripBad &&
    !mutations.createSkill.isPending &&
    !mutations.updateSkill.isPending;

  const submit = () => {
    if (fields === null || !submittable) return;
    const body = {
      name: fields.name.trim(),
      description: fields.description.trim(),
      files: [{ path: SKILL_ENTRY_FILE, content: entry }],
    };
    if (!live) {
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
    <DialogShell
      title={editing ? t('编辑技能') : t('新建技能')}
      open={open}
      onClose={onClose}
      size="m"
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: editing ? t('保存') : t('新建技能'),
            onClick: submit,
            disabled: !submittable,
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      {error !== null && fields === null ? (
        <FormStack className="max-w-none">
          <FieldError>
            {error.headline}
            {error.detail !== '' && (
              <span className="mt-0.5 block text-muted-foreground">{error.detail}</span>
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
              onChange={(event) => setFields((f) => f && { ...f, description: event.target.value })}
              placeholder={t('这个技能做什么、什么时候用它。')}
            />
            {roundTripBad && (
              <FieldError>
                {t('描述不要用引号整体包裹——写进 frontmatter 后引号会被剥去，与表单值不一致。')}
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
                ? t('frontmatter（name/description）由上方表单生成；未在此编辑的文件保持原样。')
                : t('frontmatter（name/description）由上方表单生成，这里只写正文。')}
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
                <span className="mt-0.5 block text-muted-foreground">{error.detail}</span>
              )}
            </FieldError>
          )}
        </FormStack>
      )}
    </DialogShell>
  );
}
