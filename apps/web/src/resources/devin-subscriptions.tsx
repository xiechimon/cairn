import { useState } from 'react';
import type { CreateDevinSubscription } from '../api/devin-subscriptions.js';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { withCodeSpans } from '../components/notice-banner.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

const DEVIN_TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export function AddDevinSubscriptionDialog({
  onClose,
  onCreate,
  pending,
  error,
}: {
  onClose: () => void;
  onCreate: (body: CreateDevinSubscription) => void;
  pending: boolean;
  error: boolean;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(t('Devin 订阅'));
  const [token, setToken] = useState('');
  return (
    <DialogShell
      title={t('添加 Devin 订阅')}
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
                expiresAt: Date.now() + DEVIN_TOKEN_LIFETIME_MS,
              }),
          }}
          secondary={{ label: t('取消'), onClick: onClose }}
        />
      }
    >
      <FormStack className="max-w-none">
        <p>
          {withCodeSpans(
            t(
              '在登录过 Devin 的电脑上运行 `cat ~/.local/share/devin/credentials.toml`，把 `windsurf_api_key` 的值粘贴到下面。',
            ),
          )}
        </p>
        <p>{t('任务会用这个订阅跑 Devin，不用再配 API key。Token 加密保存，保存后无法再查看。')}</p>
        <FormField label={t('名称')} htmlFor="devin-subscription-label">
          <Input
            className={FORM_CONTROL_CLS}
            id="devin-subscription-label"
            data-testid="devin-subscription-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </FormField>
        <FormField label="Token" htmlFor="devin-subscription-token">
          <Input
            className={FORM_CONTROL_CLS}
            id="devin-subscription-token"
            data-testid="devin-subscription-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </FormField>
        {error && <p role="alert">{t('保存失败，请检查填写内容后重试。')}</p>}
      </FormStack>
    </DialogShell>
  );
}
