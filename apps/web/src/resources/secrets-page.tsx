import { KeyRound, Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useSecrets } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { CreateSecretDialog } from './create-secret-dialog.js';
import {
  ResourceList,
  ResourceNewButton,
  ResourceRow,
  RowDesc,
  RowText,
  RowTitle,
} from './parts.js';

export const SECRETS_HREF = '/app/resources/secrets';

export function SecretsPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const secretsQ = useSecrets(teamId, live);
  const secrets = live ? (secretsQ.data ?? []) : (fixture.resources?.secrets ?? []);
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
          testId="resource-empty"
          className="mt-6"
          icon={KeyRound}
          title={t('尚无密钥。')}
          description={t(
            '团队密钥按 Agent 授权，在需要它的执行步中下发，不预置进任务 shell 环境。值只写不读：保存后只能覆盖或删除，无法再次查看。',
          )}
          action={{ label: t('添加密钥'), onClick: () => setCreateOpen(true) }}
          hint={{
            icon: Lightbulb,
            text: t('也可以让总管添加：它会开一张安全输入卡填写值，值不会进入对话。'),
          }}
        />
      ) : (
        <ResourceList>
          {secrets.map((secret) => (
            <ResourceRow key={secret.id}>
              <RowText>
                <RowTitle className="font-mono">{secret.name}</RowTitle>
                {secret.description != null && <RowDesc>{secret.description}</RowDesc>}
              </RowText>
            </ResourceRow>
          ))}
        </ResourceList>
      )}
      <CreateSecretDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={
          live
            ? (input) =>
                mutations.createSecret.mutate(input, {
                  onSuccess: () => setCreateOpen(false),
                  onError: (error) => toastError(t('添加密钥失败，请重试。'), error),
                })
            : undefined
        }
      />
    </PageShell>
  );
}
