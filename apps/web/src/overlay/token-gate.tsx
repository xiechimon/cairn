import { cn } from 'cn';
import { type FormEvent, type MouseEvent, useEffect, useRef, useState } from 'react';
import {
  beginGateProbe,
  bootstrapLoopback,
  consumePairFragment,
  passGate,
  redeemPairingCode,
  rejectGate,
  useAuth,
} from '../api/auth.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { Spinner } from '../components/ui/spinner.js';
import { DEMO_MODE } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';

const PAIR_CODE_CELLS = 32;

export function TokenGate() {
  const { t } = useI18n();
  const auth = useAuth();
  const [value, setValue] = useState('');
  const [caret, setCaret] = useState<number | null>(null);
  const [probing, setProbing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cellsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      await consumePairFragment(() => rejectGate());
      if (!DEMO_MODE && (await bootstrapLoopback())) passGate();
    })();
  }, []);

  useEffect(() => {
    if (!auth.gateOpen) return;
    setValue('');
    inputRef.current?.focus();
  }, [auth.gateOpen]);

  if (!auth.gateOpen) return null;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const candidate = value.trim();
    if (candidate === '' || probing) return;
    setProbing(true);
    beginGateProbe();
    void redeemPairingCode(candidate).then((accepted) => {
      if (accepted) passGate();
      else rejectGate();
      setProbing(false);
    });
  };

  const cellCount = Math.max(PAIR_CODE_CELLS, value.length);
  const errCell = Math.min(value.length, cellCount - 1);
  const pickCell = (event: MouseEvent<HTMLInputElement>): void => {
    event.preventDefault();
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    const { clientX, clientY } = event;
    let at = value.length;
    const cells = cellsRef.current?.children ?? [];
    for (const [i, cell] of [...cells].entries()) {
      const rect = cell.getBoundingClientRect();
      if (
        clientY >= rect.top &&
        clientY <= rect.bottom &&
        clientX >= rect.left &&
        clientX <= rect.right
      ) {
        at = Math.min(i, value.length);
        break;
      }
    }
    input.setSelectionRange(at, at);
    setCaret(at);
  };

  return (
    <div className="fixed inset-0 z-(--z-gate) flex items-center justify-center bg-(--overlay-scrim)">
      <div className="flex w-[360px] max-w-[calc(100vw-48px)] flex-col items-center gap-3">
        <Card
          role="dialog"
          aria-modal="true"
          aria-label={t('配对这台电脑')}
          className="token-gate w-full rounded-(--cds-radius-xl) p-6 shadow-lg"
        >
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <h1 className="token-gate-title text-base font-semibold text-foreground">
              {t('配对这台电脑')}
            </h1>
            <p className="text-[13px] leading-normal text-content-secondary">
              {t(
                '输入一次性配对码。码在运行服务的电脑的远程访问设置里生成，5 分钟内有效，只能用一次。',
              )}
            </p>
            <label className="text-xs text-content-tertiary" htmlFor="cairn-pair-input">
              {t('配对码')}
            </label>
            <div className="relative">
              <div ref={cellsRef} className="grid grid-cols-8 gap-1.5" aria-hidden="true">
                {Array.from({ length: cellCount }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'flex h-10 items-center justify-center rounded-md border border-input bg-popover font-mono text-brand text-foreground select-none',
                      caret === i && 'border-ring',
                      auth.rejected && i === errCell && 'border-foreground',
                    )}
                  >
                    {value[i] ?? ''}
                  </span>
                ))}
              </div>
              <Input
                ref={inputRef}
                id="cairn-pair-input"
                className="absolute inset-0 h-full w-full cursor-text opacity-0"
                value={value}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={auth.rejected || undefined}
                aria-describedby={auth.rejected ? 'cairn-pair-error' : undefined}
                onMouseDown={pickCell}
                onChange={(event) => {
                  setValue(event.target.value);
                  setCaret(event.target.selectionStart);
                }}
                onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
                onFocus={(event) =>
                  setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
                }
                onBlur={() => setCaret(null)}
              />
            </div>
            {auth.rejected && (
              <p id="cairn-pair-error" className="text-xs text-destructive" role="alert">
                {t('配对码无效，请重试。')}
              </p>
            )}
            <Button
              type="submit"
              className="border-0 rounded-md px-3 text-[13px] font-normal"
              disabled={probing || value.trim() === ''}
            >
              {probing ? (
                <>
                  <Spinner className="size-3.5" />
                  {t('正在配对…')}
                </>
              ) : (
                t('进入')
              )}
            </Button>
          </form>
        </Card>
        <p className="m-0 text-center text-caption leading-normal text-content-tertiary">
          {t('服务器地址 {host} · 令牌只发一次，存在这台设备的浏览器里', {
            host: window.location.host,
          })}
        </p>
      </div>
    </div>
  );
}
