import { CLOAK_LICENSE_SECRET, cloakLicenseBodySchema } from '@cairn/shared';
import { cn } from 'cn';
import { type FormEvent, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { REPLY_BUBBLE_CLS } from '../detail/chat-markdown.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

type CloakLicenseItem = Extract<ChiefStreamItem, { kind: 'cloak-license' }>;

const GET_LICENSE_URL = 'https://cloakbrowser.dev';

type Problem = 'invalid' | 'owner-only' | 'failed' | null;

export function CloakLicenseCard({ item }: { item: CloakLicenseItem }) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const { saveCloakLicense } = useApiMutations(teamId);
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<Problem>(null);
  const [savedHere, setSavedHere] = useState(false);
  const saved = item.outcome === 'saved' || savedHere;
  const waiting = item.outcome === 'waiting' && !saved;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = cloakLicenseBodySchema.safeParse({ value });
    if (!parsed.success) {
      setProblem('invalid');
      return;
    }
    setProblem(null);
    saveCloakLicense.mutate(parsed.data, {
      onSuccess: () => {
        setValue('');
        setSavedHere(true);
      },
      onError: (error) =>
        setProblem(error instanceof ApiError && error.status === 403 ? 'owner-only' : 'failed'),
    });
  };

  const title = saved
    ? t('已保存 CloakBrowser 许可证')
    : waiting
      ? t('需要 CloakBrowser 许可证')
      : t('没有保存 CloakBrowser 许可证');

  const problemText =
    problem === 'invalid'
      ? t('许可证不能为空，不能超过 512 个字符，也不能带换行。')
      : problem === 'owner-only'
        ? t('只有这台 Cairn 的所有者能保存许可证。')
        : problem === 'failed'
          ? t('没能保存，请稍后重试。')
          : null;

  return (
    <MessageScrollerItem style={{ contentVisibility: 'visible' }} className="mt-5">
      <section
        data-testid="chief-cloak-license"
        data-outcome={saved ? 'saved' : item.outcome}
        aria-label={t('CloakBrowser 许可证')}
        className={cn(REPLY_BUBBLE_CLS, 'flex flex-col gap-1 py-3')}
      >
        <p className="m-0 flex items-center gap-2 text-ui font-title text-foreground">
          {waiting && (
            <span
              aria-hidden="true"
              data-slot="needs-you-dot"
              className="size-1.5 flex-none rounded-full bg-(--card-button)"
            />
          )}
          {title}
        </p>
        {saved ? (
          <p
            className="m-0 text-meta text-content-secondary"
            data-testid="chief-cloak-license-saved"
          >
            {t('已存为团队密钥')} <code>{CLOAK_LICENSE_SECRET}</code>
            {t('，Coordinator 会重试刚才的操作。')}
          </p>
        ) : waiting ? (
          <>
            {item.reason !== '' && (
              <p className="m-0 text-meta text-content-secondary">{item.reason}</p>
            )}
            <p className="m-0 text-meta text-content-tertiary">
              {t('隐身浏览器要用它打开拦截自动访问的网站。加密保存为团队密钥，保存后看不到原文。')}{' '}
              <a
                href={GET_LICENSE_URL}
                target="_blank"
                rel="noreferrer"
                data-testid="chief-cloak-license-get"
                className="whitespace-nowrap text-foreground underline underline-offset-2"
              >
                {t('免费获取许可证')}
              </a>
            </p>
            <form className="mt-2 flex flex-wrap items-center gap-3" onSubmit={submit}>
              <Input
                className={cn(FORM_CONTROL_CLS, 'w-auto min-w-0 flex-1 basis-56')}
                data-testid="chief-cloak-license-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-label={t('CloakBrowser 许可证')}
                aria-invalid={problem === 'invalid' ? true : undefined}
                placeholder={t('粘贴许可证')}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (problem !== null) setProblem(null);
                }}
              />
              <Button
                type="submit"
                size="sm"
                className="pointer-coarse:h-11 pointer-coarse:px-4"
                disabled={value.trim() === '' || saveCloakLicense.isPending}
                data-testid="chief-cloak-license-save"
              >
                {t('保存')}
              </Button>
            </form>
            {problemText !== null && (
              <p
                role="alert"
                className="m-0 text-meta text-destructive"
                data-testid="chief-cloak-license-problem"
              >
                {problemText}
              </p>
            )}
          </>
        ) : (
          <p className="m-0 text-meta text-content-secondary">{t('这一步已停止，不会自动重试')}</p>
        )}
      </section>
    </MessageScrollerItem>
  );
}
