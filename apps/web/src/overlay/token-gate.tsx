import { type FormEvent, useEffect, useState } from 'react';
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
import { DEMO_MODE } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';

export function TokenGate() {
  const { t } = useI18n();
  const auth = useAuth();
  const [value, setValue] = useState('');
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    void (async () => {
      await consumePairFragment(() => rejectGate());
      if (!DEMO_MODE && (await bootstrapLoopback())) passGate();
    })();
  }, []);

  useEffect(() => {
    if (!auth.gateOpen) return;
    setValue('');
    (document.getElementById('cairn-pair-input') as HTMLInputElement | null)?.focus();
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
      else {
        rejectGate();
        setValue('');
      }
      setProbing(false);
    });
  };

  return (
    <div className="fixed inset-0 z-(--z-gate) flex items-center justify-center bg-(--overlay-scrim)">
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={t('配对这台电脑')}
        className="token-gate w-[360px] max-w-[calc(100vw-48px)] rounded-(--cds-radius-xl) p-6 shadow-lg"
      >
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <h1 className="token-gate-title text-base font-semibold text-foreground">
            {probing ? t('正在配对…') : t('配对这台电脑')}
          </h1>
          <p className="text-[13px] leading-normal text-content-secondary">
            {t(
              '输入一次性配对码。码在运行服务的电脑的远程访问设置里生成，5 分钟内有效，只能用一次。',
            )}
          </p>
          <label className="text-xs text-content-tertiary" htmlFor="cairn-pair-input">
            {t('配对码')}
          </label>
          <Input
            id="cairn-pair-input"
            className="token-gate-input h-9 border-(--border) bg-(--card) px-3 py-0 text-sm text-foreground transition-[color,background-color,border-color] dark:bg-(--card)"
            type="password"
            value={value}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
          />
          {auth.rejected && (
            <p className="text-xs text-destructive" role="alert">
              {t('配对码无效，请重试。')}
            </p>
          )}
          <Button
            type="submit"
            className="token-gate-submit border-0 rounded-md px-3 text-[13px] font-normal"
            disabled={probing || value.trim() === ''}
          >
            {t('进入')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
