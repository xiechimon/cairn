import { secretRequestAnswerSchema } from '@cairn/shared';
import { cn } from 'cn';
import { Ban, CircleAlert, CircleCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations, useProjects, useSecrets } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import { Input } from '../components/ui/input.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ApprovalCard, ApprovalHistoryLine } from './approval-card.js';
import type { ApprovalCardModel } from './approval-card-model.js';

type SecretRequestItem = Extract<ChiefStreamItem, { kind: 'secret-request' }>;

type Decision = 'save' | 'cancel';
type Problem = 'invalid' | 'owner-only' | 'closed' | 'failed' | null;

const SAVE_TEST_ID = 'chief-secret-request-save';
const CANCEL_TEST_ID = 'chief-secret-request-cancel';
const HISTORY_ICON_CLS = 'size-4 text-content-tertiary';

export function SecretRequestCard({ item }: { item: SecretRequestItem }) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const { answerSecretRequest } = useApiMutations(teamId);
  const [value, setValue] = useState('');
  const [decided, setDecided] = useState<Decision | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const waiting = item.outcome === 'waiting';
  const asking = waiting && decided === null;
  const secrets = useSecrets(teamId, asking);
  const projects = useProjects(teamId, asking && item.projectId !== null);
  const projectName =
    projects.data?.find((project) => project.id === item.projectId)?.name ?? item.projectId;
  const replaces =
    secrets.data?.some(
      (entry) => entry.name === item.name && (entry.projectId ?? null) === item.projectId,
    ) === true;

  const scopeNote =
    item.scope === 'project'
      ? t('加密保存为项目「{project}」的密钥，Coordinator 看不到原文', {
          project: projectName ?? '',
        })
      : t('加密保存为团队密钥，Coordinator 看不到原文');
  const card: ApprovalCardModel = {
    kind: 'secret',
    title: t('提供密钥 {name}', { name: item.name }),
    context: item.description === '' ? null : item.description,
    preview: null,
    mono: false,
    note: replaces ? `${scopeNote}${t('，会替换现有的值')}` : scopeNote,
    details: [],
  };

  const send = (decision: Decision) => {
    const parsed = secretRequestAnswerSchema.safeParse(
      decision === 'save'
        ? { decision, name: item.name, projectId: item.projectId, value }
        : { decision, name: item.name, projectId: item.projectId },
    );
    if (!parsed.success) {
      setProblem('invalid');
      return;
    }
    setProblem(null);
    answerSecretRequest.mutate(parsed.data, {
      onSuccess: () => {
        setValue('');
        setDecided(decision);
      },
      onError: (error) =>
        setProblem(
          error instanceof ApiError && error.status === 403
            ? 'owner-only'
            : error instanceof ApiError && error.status === 409
              ? 'closed'
              : 'failed',
        ),
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send('save');
  };

  const problemText =
    problem === 'invalid'
      ? t('值不能为空，不能超过 4096 个字符，也不能带换行。')
      : problem === 'owner-only'
        ? t('只有这台 Cairn 的所有者能保存密钥。')
        : problem === 'closed'
          ? t('这个请求已经结束。')
          : problem === 'failed'
            ? t('未能保存，请稍后重试。')
            : null;

  const outcome =
    decided === 'save' ? 'saved' : decided === 'cancel' && waiting ? 'cancelled' : item.outcome;
  const history =
    outcome === 'saved'
      ? {
          status: t('已保存'),
          icon: <CircleCheck strokeWidth={1.75} className={HISTORY_ICON_CLS} />,
        }
      : outcome === 'cancelled'
        ? { status: t('没有提供'), icon: <Ban strokeWidth={1.75} className={HISTORY_ICON_CLS} /> }
        : outcome === 'failed'
          ? {
              status: t('请求已结束'),
              icon: <CircleAlert strokeWidth={1.75} className={HISTORY_ICON_CLS} />,
            }
          : null;
  const busy = answerSecretRequest.isPending
    ? answerSecretRequest.variables?.decision === 'cancel'
      ? CANCEL_TEST_ID
      : SAVE_TEST_ID
    : null;

  return (
    <MessageScrollerItem style={{ contentVisibility: 'visible' }} className="mt-5">
      {asking || history === null ? (
        <ApprovalCard
          testId="chief-secret-request"
          outcome={outcome}
          card={card}
          busy={busy}
          actions={[
            { label: t('保存'), testId: SAVE_TEST_ID, onClick: () => send('save') },
            { label: t('不提供'), testId: CANCEL_TEST_ID, onClick: () => send('cancel') },
          ]}
          problem={problemText}
        >
          <form className="mt-2 flex" onSubmit={submit}>
            <Input
              className={cn(FORM_CONTROL_CLS, 'w-full min-w-0')}
              data-testid="chief-secret-request-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={t('{name} 的值', { name: item.name })}
              aria-invalid={problem === 'invalid' ? true : undefined}
              placeholder={t('粘贴密钥值')}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (problem !== null) setProblem(null);
              }}
            />
          </form>
        </ApprovalCard>
      ) : (
        <ApprovalHistoryLine
          testId="chief-secret-request"
          outcome={outcome}
          card={card}
          status={history.status}
          icon={history.icon}
        />
      )}
    </MessageScrollerItem>
  );
}
