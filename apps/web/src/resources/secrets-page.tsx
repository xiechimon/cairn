// 密钥 route (issue #69, r7 10): the capture — and the only recorded state
// of this surface — is the empty state: 48px hero key tile, heading,
// write-only description, 添加密钥 primary, 总管 hint row (captured 查看文档
// link removed #307 — local-first 无文档站, rides the shared EmptyState).
// (r2 §6.3 records the add dialog; the row list was never captured.)
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useSecrets } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { KeyThin } from '../icons/index.js';
import { PageShell } from '../pages/shell.js';
import { CreateSecretDialog } from './create-secret-dialog.js';
import {
  EmptyState,
  ResourceNewButton,
  RowCard,
  RowChevron,
  RowDesc,
  RowText,
  RowTitle,
  Tile,
} from './parts.js';

export const SECRETS_HREF = '/app/resources/secrets';

export function SecretsPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  // M5 live：GET secrets（只读掩码面，02 §8 值只写不读）。有行 = 复用
  // 资源行卡语言（r7 08 同款 res-card 行；行列表无观测截图，r7 10 仅空态
  // ——[设计] 呈现，04 §3 口径）；fixture 面保持 r7 10 空态字节不变。
  const { live, teamId } = useLiveData();
  const secretsQ = useSecrets(teamId, live);
  const secrets = live ? (secretsQ.data ?? []) : [];
  // wayfinder #173: 新建 (topbar + empty-state primary) opens the
  // 添加密钥 dialog; live submit = POST secrets then close
  // (invalidateAll refetches the masked rows), fixture = accept 律
  const mutations = useApiMutations(teamId);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <PageShell
      route={SECRETS_HREF}
      title={t('密钥')}
      selected={SECRETS_HREF}
      actions={<ResourceNewButton onClick={() => setCreateOpen(true)} />}
      fixture={fixture}
    >
      {secrets.length === 0 ? (
        <EmptyState
          Icon={KeyThin}
          title="尚无密钥。"
          description="团队密钥按 Agent 授权，在需要它的执行步中下发，不预置进任务 shell 环境。值只写不读：保存后只能覆盖或删除，无法再次查看。"
          actionLabel="添加密钥"
          onAction={() => setCreateOpen(true)}
          hint="也可以让总管添加：它会开一张安全输入卡填写值，值不会进入对话。"
        />
      ) : (
        secrets.map((secret) => (
          <RowCard key={secret.id}>
            <Tile Icon={KeyThin} size="sm" tone="orange" />
            <RowText>
              <RowTitle>{secret.name}</RowTitle>
              {secret.description != null && <RowDesc strong>{secret.description}</RowDesc>}
            </RowText>
            <RowChevron />
          </RowCard>
        ))
      )}
      <CreateSecretDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={
          live
            ? (input) =>
                mutations.createSecret.mutate(input, {
                  onSuccess: () => setCreateOpen(false),
                  // #638：失败 = 弹窗留着（关挂在 onSuccess）但零反馈。
                  onError: (error) => toastError(t('添加密钥失败，请重试。'), error),
                })
            : undefined
        }
      />
    </PageShell>
  );
}
