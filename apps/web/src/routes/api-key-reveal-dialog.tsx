import { CopyIconButton } from '../components/copy-icon-button.js';
import { FormActions, FormField, FormStack } from '../components/form-layout.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';

export function ApiKeyRevealDialog({
  plaintext,
  onDone,
}: {
  plaintext: string | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={t('保存你的 API 密钥')}
      subtitle={t('关闭后无法再次查看，请现在复制并妥善保存。')}
      open={plaintext !== null}
      onClose={onDone}
      dismissible={false}
      size="s"
      footer={<FormActions className="pt-0" primary={{ label: t('我已保存'), onClick: onDone }} />}
    >
      <FormStack className="max-w-none">
        <FormField
          label={t('新的 API 密钥')}
          htmlFor="apikey-reveal-value"
          help={t('以 cairn_ 开头，万一泄露，密钥扫描工具和你都能认出它。')}
        >
          <div className="flex items-start gap-1">
            <Textarea
              id="apikey-reveal-value"
              readOnly
              rows={2}
              value={plaintext ?? ''}
              data-testid="api-key-plaintext"
              className="min-h-0 min-w-0 flex-1 resize-none font-mono break-all"
              onFocus={(event) => {
                event.currentTarget.select();
                event.currentTarget.scrollTop = 0;
              }}
            />
            <CopyIconButton
              text={plaintext ?? ''}
              testId="api-key-copy"
              className="pointer-coarse:size-11"
            />
          </div>
        </FormField>
      </FormStack>
    </DialogShell>
  );
}
