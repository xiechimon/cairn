import type { CreateClaudeSubscription } from '@cairn/shared';
import { useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { InfoTip } from '../components/info-tip.js';
import { withCodeSpans } from '../components/notice-banner.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

const SETUP_TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export function AddClaudeSubscriptionDialog({
  onClose,
  onCreate,
  pending,
  error,
  reloginTarget,
}: {
  onClose: () => void;
  onCreate: (body: CreateClaudeSubscription) => void;
  pending: boolean;
  error: boolean;
  reloginTarget?: { id: string; label: string };
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(reloginTarget?.label ?? t('Claude 订阅'));
  const [token, setToken] = useState('');
  return (
    <DialogShell
      title={reloginTarget !== undefined ? t('重新登录 Claude') : t('添加 Claude 订阅')}
      open
      onClose={onClose}
      size="s"
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: t('保存'),
            disabled: pending || !label.trim() || !token.trim(),
            onClick: () =>
              onCreate({
                label: label.trim(),
                token: token.trim(),
                expiresAt: Date.now() + SETUP_TOKEN_LIFETIME_MS,
              }),
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <FormStack className="max-w-none">
        <p>
          {withCodeSpans(t('在你的电脑上运行 `claude setup-token`，把输出的 token 粘贴到下方。'))}
        </p>
        <p>
          {t('Coordinator 和任务都会用这个订阅。保存后无法再查看。')}{' '}
          <InfoTip info={t('不用再配 API key，Token 加密保存')} />
        </p>
        {reloginTarget === undefined && (
          <FormField label={t('名称')} htmlFor="subscription-label">
            <Input
              className={FORM_CONTROL_CLS}
              id="subscription-label"
              data-testid="subscription-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </FormField>
        )}
        <FormField label="Token" htmlFor="subscription-token">
          <Input
            className={FORM_CONTROL_CLS}
            id="subscription-token"
            data-testid="subscription-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </FormField>
        {error && <p role="alert">{t('保存失败，请检查填写内容后重试。')}</p>}
      </FormStack>
    </DialogShell>
  );
}
