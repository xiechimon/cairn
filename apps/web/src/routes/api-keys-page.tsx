// API-keys route (issue #70): the empty state per r2 19 (icon +
// canon copy + 新建密钥; the captured 查看文档 link is gone — #307
// wontfix, local-first 无文档站, #149 schedules 同律), and with a created key in the
// fixture the r3 §6 display rules — list row masked `pacman_afe07565…`
// (r3 样例原形前缀 tds_ 随品牌槽切换，#109)
// plus the one-time plaintext block carrying the 02 §8 canon
// 「请立即复制密钥，它仅显示一次。」. Row and one-time block shapes are
// [推断] (no capture: r2 §9-12, r3 §6 图失); mask and copy are observed.
// #947 per-face 清零：secondary.css 退役。
// Paper 页面模式：空态走 components/empty-state.tsx；一次性明文块是
// --radius-card 卡，密钥列表是一张设置卡（settings-list.tsx）的 52px 行，
// 行不可点（无详情面），所以不带 chevron。data-testid="keys-empty" 二级载体保留。
import { cn } from 'cn';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiKeys, useApiMutations, useTodos } from '../api/hooks.js';
import { mapApiKeys, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { CARD_RADIUS_CLS, SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { Key } from '../icons/index.js';
import { PageShell } from '../pages/shell.js';
import { ApiKeyCreateDialog } from './api-key-create-dialog.js';

export function ApiKeysPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  // M5 live：列表 = GET api-keys（只读掩码，02 §8）；新建 = POST 直发默认
  // 权限位（已建屏无 r3 §6 表单弹窗面——名称/白名单归后票 [设计]），一次性
  // 明文块 = 创建响应 plaintext（仅显示一次 canon）。
  const { live, teamId } = useLiveData();
  const keysQ = useApiKeys(teamId, live);
  const todosQ = useTodos(teamId, live);
  const mutations = useApiMutations(teamId);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  // W4 #287：新建走权限位表单弹窗（不再默认直发）；fixture 面按钮保持无操作。
  const [createOpen, setCreateOpen] = useState(false);
  const keys = live
    ? [
        ...mapApiKeys(keysQ.data ?? []),
        ...(plaintext !== null
          ? [{ id: 'once', name: null, masked: '', gitAccess: false, mcpAccess: false, plaintext }]
          : []),
      ]
    : (fixture.apiKeys?.keys ?? []);
  const listed = keys.filter((key) => key.name != null || key.masked !== '');
  return (
    <PageShell
      route="api-keys"
      fixture={live ? { ...fixture, todos: (todosQ.data ?? []).map(toDisplayTodo) } : fixture}
      selected="none"
      title={t('API 密钥')}
    >
      {keys.length === 0 ? (
        <EmptyState
          testId="keys-empty"
          className="mt-6"
          icon={Key}
          title={t('尚无 API 密钥。')}
          description={t('API 密钥用于从命令行接入机器，也让 MCP 客户端能访问你的工作台。')}
          action={{ label: t('新建密钥'), onClick: live ? () => setCreateOpen(true) : undefined }}
        />
      ) : (
        <>
          {keys
            .filter((key) => key.plaintext != null)
            .map((key) => (
              <Card
                key={`once-${key.id}`}
                className={cn('mt-6 gap-2 px-4 py-3 shadow-none ring-border', CARD_RADIUS_CLS)}
              >
                <div className="flex items-center gap-3">
                  <code className="min-w-0 flex-1 font-mono text-ui break-all text-foreground">
                    {key.plaintext}
                  </code>
                  <Button
                    variant="outline"
                    className={DIALOG_PRIMARY_BUTTON}
                    onClick={
                      live
                        ? () => void navigator.clipboard?.writeText(key.plaintext ?? '')
                        : undefined
                    }
                  >
                    {t('复制')}
                  </Button>
                </div>
                <p className="m-0 text-meta text-content-tertiary">
                  {t('请立即复制密钥，它仅显示一次。')}
                </p>
              </Card>
            ))}
          {listed.length > 0 && (
            <SettingsCard className="mt-4">
              {listed.map((key) => (
                <div key={key.id} className={SETTINGS_ROW_CLS}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-ui text-foreground">
                      {key.name ?? key.masked}
                    </span>
                    {key.name != null && (
                      <span className="truncate font-mono text-meta text-content-tertiary">
                        {key.masked}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </SettingsCard>
          )}
        </>
      )}
      <ApiKeyCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(body) =>
          mutations.createApiKey.mutate(body, {
            onSuccess: (res) => {
              if (typeof res.plaintext === 'string') setPlaintext(res.plaintext);
            },
            // #638：弹窗提交即自关（dialog submit 律），失败 = 密钥没建上、
            // 明文块也不出现，此前零解释。
            onError: (error) => toastError(t('新建 API 密钥失败，请重试。'), error),
          })
        }
      />
    </PageShell>
  );
}
