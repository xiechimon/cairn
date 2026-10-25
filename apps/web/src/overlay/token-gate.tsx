import { ENV_VARS } from '@cairn/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { passGate, probeToken, useAuth } from '../api/auth.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

export function TokenGate() {
  const { t } = useI18n();
  const auth = useAuth();
  const [value, setValue] = useState('');
  const [rejected, setRejected] = useState(false);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    if (!auth.gateOpen) return;
    setValue('');
    setRejected(false);
    (document.getElementById('cairn-token-input') as HTMLInputElement | null)?.focus();
  }, [auth.gateOpen]);

  if (!auth.gateOpen) return null;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const candidate = value.trim();
    if (candidate === '' || probing) return;
    setProbing(true);
    setRejected(false);
    void probeToken(candidate).then((accepted) => {
      if (accepted) {
        passGate(candidate);
      } else {
        setRejected(true);
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
        aria-label={t('需要访问令牌')}
        className="token-gate w-[360px] max-w-[calc(100vw-48px)] rounded-[12px] p-6 shadow-lg"
      >
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <h1 className="token-gate-title text-base font-semibold text-foreground">
            {t('需要访问令牌')}
          </h1>
          <p className="text-[13px] leading-normal text-content-secondary">
            {t('服务端已开启令牌鉴权，输入访问令牌后继续使用。')}
          </p>
          <p className="token-gate-help text-xs leading-relaxed text-content-tertiary">
            {t(
              '令牌由部署方在服务端用环境变量 {tokenVar} 设定，页面无法读出它的值：自己部署的服务，去启动它的环境里找这个变量（systemd 部署看单元 EnvironmentFile 指向的文件）；别人部署的，向部署者索取。删除该变量并重启服务端即可关闭令牌鉴权。',
              { tokenVar: ENV_VARS.token },
            )}
          </p>
          <label className="text-xs text-content-tertiary" htmlFor="cairn-token-input">
            {t('访问令牌')}
          </label>
          <Input
            id="cairn-token-input"
            className="token-gate-input h-9 border-(--border) bg-(--card) px-3 py-0 text-sm text-foreground transition-[color,background-color,border-color] focus-visible:border-(--border) focus-visible:ring-0 focus-visible:[outline:2px_solid_var(--focus-ring)] focus-visible:outline-offset-2 dark:bg-(--card)"
            type="password"
            value={value}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
          />
          {rejected && (
            <p className="token-gate-error text-xs text-destructive" role="alert">
              {t('令牌无效，请重试。')}
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
