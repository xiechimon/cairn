// 技能导入弹窗（#1170）：localPath 与 url 两字段二选一的导入表单——
// POST /api/teams/{id}/skills/import（server 收集与守卫：SSRF 固定 host 面 /
// realpath 归一 / 字节闸 / utf8 严格；落盘复用 createLocalSkill 校验）。
// 客户端预检只有一条：两字段恰好一个非空（xor 同 shared importSkillBodySchema
// ——双填/双空不发请求）；其余校验全在 server（与 SkillDialog「server 仍是
// 终闸」同律：400/409/502/504 落内联错误行，headline 按 status 分译，server
// 原文作 detail 行，消息子串不作契约）。
// fixture 面 = accept 律（#148：提交即关），不发请求。
// Paper 表单：FormStack / FormField + footer FormActions（同 SkillDialog 形）。

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

/** 服务端错误 → 可读 headline（status 分译）+ 原文 detail。 */
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

  // 开/关初始化：关 = 清场；开 = 空表（无编辑面——导入是单向动作）。
  // SkillDialog 同律（open 沿初始化，exhaustive-deps 豁免注释同形）。
  useEffect(() => {
    if (!open) {
      setFields(null);
      setError(null);
      return;
    }
    setFields({ localPath: '', url: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在开/关沿初始化
  }, [open]);

  const localFilled = fields !== null && fields.localPath.trim() !== '';
  const urlFilled = fields !== null && fields.url.trim() !== '';
  // xor 预检（server schema 同律）：双填/双空不发请求。
  const submittable =
    fields !== null && localFilled !== urlFilled && !mutations.importSkill.isPending;

  const submit = () => {
    if (fields === null || !submittable) return;
    if (!live) {
      onClose(); // fixture accept 律
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
      width={560}
      footer={
        <FormActions
          className="pt-0"
          primary={{ label: t('导入'), onClick: submit, disabled: !submittable }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      {fields === null ? null : (
        <FormStack className="max-w-none py-1">
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
