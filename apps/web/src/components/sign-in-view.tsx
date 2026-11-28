import { cn } from 'cn';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/provider.js';
import { copyTextWithFeedback } from '../lib/clipboard.js';
import { Button } from './ui/button.js';
import { RingSpinner } from './ui/ring-spinner.js';
import { Skeleton } from './ui/skeleton.js';
import { toastError } from './ui/toaster.js';

const COPIED_MS = 1600;

function useCopied(): [boolean, (value: string) => void] {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const copy = (value: string) =>
    copyTextWithFeedback(
      value,
      () => {
        if (!mounted.current) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      },
      (error) => toastError(t('复制失败，请重试。'), error),
    );
  return [copied, copy];
}

export function DeviceCode({
  code,
  cells = false,
  expired = false,
}: {
  code: string;
  cells?: boolean;
  expired?: boolean;
}) {
  const { t } = useI18n();
  const [copied, copy] = useCopied();
  if (cells) {
    return (
      <div
        data-testid="mcp-github-code"
        className={cn('flex items-center justify-center gap-1.5', expired && 'opacity-40')}
      >
        <span className="sr-only">{code}</span>
        {code.split('').map((char, i) =>
          /[A-Za-z0-9]/.test(char) ? (
            <span
              key={i}
              aria-hidden="true"
              className={cn(
                'flex h-12 w-9 items-center justify-center rounded-(--radius-control) border border-input bg-card font-mono text-brand text-foreground',
                expired && 'line-through',
              )}
            >
              {char}
            </span>
          ) : (
            <span
              key={i}
              aria-hidden="true"
              className="flex h-12 w-2 items-center justify-center font-mono text-heading text-content-tertiary"
            >
              {char}
            </span>
          ),
        )}
      </div>
    );
  }
  return (
    <div
      className={cn(
        'flex min-h-14 items-center gap-3 rounded-(--radius-control) bg-muted px-4 py-3 pointer-coarse:min-h-17',
        expired && 'opacity-40',
      )}
    >
      <code
        data-testid="sign-in-code"
        translate="no"
        className={cn(
          'min-w-0 flex-1 font-mono text-heading break-all text-foreground',
          expired && 'line-through',
        )}
      >
        {code}
      </code>
      {!expired && (
        <Button
          variant="outline"
          size="xs"
          data-testid="sign-in-copy"
          className="shrink-0 px-2.5 pointer-coarse:h-11 pointer-coarse:px-3.5"
          onClick={() => copy(code)}
        >
          {copied ? t('已复制') : t('复制')}
        </Button>
      )}
    </div>
  );
}

export function SignInView({
  instruction,
  code,
  waiting,
  failure,
  onCancel,
  cancelTestId,
  testId = 'sign-in-view',
}: {
  instruction?: ReactNode;
  code?: { value: string; expired?: boolean } | 'loading';
  waiting?: string | null;
  failure?: string | null;
  onCancel?: () => void;
  cancelTestId?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-3">
      {instruction != null && <p className="m-0 text-ui text-foreground">{instruction}</p>}
      {code === 'loading' ? (
        <Skeleton
          aria-hidden="true"
          className="h-14 w-full rounded-(--radius-control) pointer-coarse:h-17"
        />
      ) : code !== undefined ? (
        <DeviceCode code={code.value} expired={code.expired === true} />
      ) : null}
      {waiting != null && waiting !== '' && (
        <div className="flex min-h-8 items-center gap-2 pointer-coarse:min-h-11">
          <RingSpinner role="presentation" aria-hidden="true" className="size-4 flex-none" />
          <span role="status" className="min-w-0 flex-1 text-meta text-content-secondary">
            {waiting}
          </span>
          {onCancel !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              className="flex-none pointer-coarse:h-11"
              data-testid={cancelTestId}
              onClick={onCancel}
            >
              {t('取消')}
            </Button>
          )}
        </div>
      )}
      {failure != null && failure !== '' && (
        <p role="alert" className="m-0 text-pretty text-ui text-foreground">
          {failure}
        </p>
      )}
    </div>
  );
}
