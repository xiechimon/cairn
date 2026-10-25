import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { FieldError } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

interface Fields {
  localPath: string;
  url: string;
}

function serverErrorCopy(
  err: unknown,
  t: (s: string) => string,
): { headline: string; detail: string } {
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

export function SkillImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [fields, setFields] = useState<Fields | null>(null);
  const [error, setError] = useState<{ headline: string; detail: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setFields(null);
      setError(null);
      return;
    }
    setFields({ localPath: '', url: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialize fields only on the open/close edge
  }, [open]);

  const localFilled = fields !== null && fields.localPath.trim() !== '';
  const urlFilled = fields !== null && fields.url.trim() !== '';
  const submittable =
    fields !== null && localFilled !== urlFilled && !mutations.importSkill.isPending;

  const submit = () => {
    if (fields === null || !submittable) return;
    if (!live) {
      onClose();
      return;
    }
    setError(null);
    const body = localFilled ? { localPath: fields.localPath.trim() } : { url: fields.url.trim() };
    mutations.importSkill.mutate(body, {
      onSuccess: onClose,
      onError: (err) => setError(serverErrorCopy(err, t)),
    });
  };

  return (
    <DialogShell
      title={t('导入技能')}
      open={open}
      onClose={onClose}
      size="m"
      footer={
        <FormActions
          className="pt-0"
          primary={{ label: t('导入'), onClick: submit, disabled: !submittable }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      {fields === null ? null : (
        <FormStack className="max-w-none">
          <FormField
            label={t('本地路径')}
            htmlFor="dlg-skill-import-path"
            help={t('server 本机上的技能目录路径，目录里要有 SKILL.md。')}
          >
            <Input
              id="dlg-skill-import-path"
              className={FORM_CONTROL_CLS}
              value={fields.localPath}
              onChange={(event) => setFields((f) => f && { ...f, localPath: event.target.value })}
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
