import { type FeishuBotBody, type FeishuBotStatus, feishuBotBodySchema } from '@cairn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '../api/client.js';
import { FormField, FormStack } from '../components/form-layout.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import { FieldError } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

export function FeishuSettings({ teamId }: { teamId: string }) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ['feishu', teamId],
    queryFn: () => api.get<FeishuBotStatus>(`/api/teams/${teamId}/feishu`),
    staleTime: Infinity,
  });
  const id = useId();
  const queryClient = useQueryClient();
  const [edited, setDraft] = useState<FeishuBotBody | null>(null);
  const status = query.data;
  const draft = edited ?? {
    appId: status?.appId ?? '',
    appSecret: '',
    openId: status?.openId ?? '',
    cairnOrigin: status?.cairnOrigin ?? '',
  };
  const [invalid, setInvalid] = useState(false);
  const acceptStatus = (next: FeishuBotStatus) => {
    queryClient.setQueryData(['feishu', teamId], next);
    setDraft(null);
    setInvalid(false);
  };
  const save = useMutation({
    mutationFn: (body: FeishuBotBody) =>
      api.put<FeishuBotStatus>(`/api/teams/${teamId}/feishu`, body),
    onSuccess: acceptStatus,
    onError: (error) => toastError(t('保存失败，请重试。'), error),
  });
  const unbind = useMutation({
    mutationFn: () => api.del<void>(`/api/teams/${teamId}/feishu`),
    onSuccess: () => {
      setConfirmOpen(false);
      acceptStatus({ configured: false, appId: null, openId: null, cairnOrigin: null });
    },
    onError: (error) => toastError(t('断开连接失败，请重试。'), error),
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (query.isError)
    return (
      <div role="alert">
        {t('飞书配置加载失败')}{' '}
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t('重试')}
        </Button>
      </div>
    );
  if (!status) return <p role="status">{t('正在加载飞书配置')}</p>;
  const pending = save.isPending || unbind.isPending;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('飞书机器人')}</h2>
        </CardTitle>
        <CardDescription>{t('仅保存配置，不会连接飞书或启用审批。')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          aria-label={t('飞书机器人')}
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = feishuBotBodySchema.safeParse(draft);
            if (
              !parsed.success ||
              ((!status.configured || draft.appId.trim() !== status.appId) &&
                draft.appSecret.trim() === '')
            ) {
              setInvalid(true);
              return;
            }
            setInvalid(false);
            save.mutate(parsed.data);
          }}
        >
          <FormStack>
            <p role="status">{status.configured ? t('已配置') : t('未配置')}</p>
            {(
              [
                ['appId', 'App ID'],
                ['appSecret', 'App Secret'],
                ['openId', t('接收者 Open ID')],
                ['cairnOrigin', t('Cairn 地址')],
              ] as const
            ).map(([name, label]) => (
              <FormField
                key={name}
                label={label}
                htmlFor={`${id}-${name}`}
                help={
                  name === 'appSecret' && status.configured
                    ? t('留空保留当前密钥；更换 App ID 时须填写新密钥。')
                    : undefined
                }
              >
                <Input
                  id={`${id}-${name}`}
                  type={name === 'appSecret' ? 'password' : 'text'}
                  value={draft[name]}
                  autoComplete="off"
                  maxLength={name === 'appSecret' ? 4096 : name === 'cairnOrigin' ? 2048 : 256}
                  disabled={pending}
                  aria-invalid={invalid || undefined}
                  onChange={(event) => setDraft({ ...draft, [name]: event.target.value })}
                />
              </FormField>
            ))}
            {invalid && <FieldError>{t('请检查 App ID、密钥、接收者和 Cairn 地址。')}</FieldError>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                {t('保存配置')}
              </Button>
              <Button
                variant="destructive"
                disabled={pending || !status.configured}
                onClick={() => setConfirmOpen(true)}
              >
                {t('解除绑定')}
              </Button>
            </div>
          </FormStack>
        </form>
        <AlertDialogShell
          title={t('解除飞书绑定？')}
          subtitle={t('将删除保存的 App ID 和 App Secret。')}
          ariaLabel={t('解除飞书绑定确认')}
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          footer={
            <AlertDialogActions
              cancelLabel={t('取消')}
              confirmLabel={t('解除绑定')}
              onCancel={() => setConfirmOpen(false)}
              onConfirm={() => unbind.mutate()}
              confirmDisabled={unbind.isPending}
            />
          }
        >
          <p>{t('解除后需要重新填写才能恢复连接。')}</p>
        </AlertDialogShell>
      </CardContent>
    </Card>
  );
}
