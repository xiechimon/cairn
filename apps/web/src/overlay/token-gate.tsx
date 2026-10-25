import { ACCESS_TOKEN_FILE_NAME, BRAND, ENV_VARS } from '@cairn/shared';
import { type FormEvent, useEffect, useState } from 'react';
import {
  beginGateProbe,
  consumeLoginFragment,
  passGate,
  probeToken,
  rejectGate,
  useAuth,
} from '../api/auth.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

export function TokenGate() {
  const { t } = useI18n();
  const auth = useAuth();
  const [value, setValue] = useState('');
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    void consumeLoginFragment();
  }, []);

  useEffect(() => {
    if (!auth.gateOpen) return;
    setValue('');
    (document.getElementById('cairn-token-input') as HTMLInputElement | null)?.focus();
  }, [auth.gateOpen]);

  if (!auth.gateOpen) return null;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const candidate = value.trim();
    if (candidate === '' || probing) return;
    setProbing(true);
    beginGateProbe();
    void probeToken(candidate).then((accepted) => {
      if (accepted) {
        passGate(candidate);
      } else {
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
              '令牌从哪来：在运行服务端的机器上执行 `cairn token` 查看当前令牌（`cairn token --rotate` 换发新令牌；令牌存于服务端 {tokenFile} 文件，设了 {tokenVar} 环境变量则以环境变量为准）。本地自行部署时，服务端启动日志还会打印一次性登录链接；容器/托管部署（{requireTokenVar}）的日志是共享的，不会打印令牌值和登录链接，请向部署者索取。删除环境变量或令牌文件并重启服务端即可关闭令牌鉴权。',
              {
                tokenVar: ENV_VARS.token,
                requireTokenVar: `${ENV_VARS.requireToken}=1`,
                tokenFile: `~/${BRAND.homeDirName}/${ACCESS_TOKEN_FILE_NAME}`,
              },
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
          {auth.rejected && (
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
