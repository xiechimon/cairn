// 模型服务 route（#356，spec 11 §A1-A4/A7）：runtime tablist（pi / Claude
// Code），tab 状态同步 ?runtime= search param（刷新/分享/深链回定位）。
// cairn 是 local-first，自身不提供远程模型服务——页面 = 各 runtime
// 的模型来源直读：pi 段 = 用户经「添加服务商」配置的 custom provider 的
// models[] 投影；claude-code 段 = 各执行机 daemon 读本机
// ~/.claude/settings.json 经 presence/enroll 上报、server 按机器聚合
// （#707；缺失/解析失败 → header 转「未安装」指引态，不空报不崩）。
// 每 tab = header（runtime 名 + 一行说明 +
// 安装态，卡上方的头部）+ 一张模型行卡（显示名 + 模型 id，槽位在右）；
// claude-code tab 按机器分段（每台机器一个头部 + 模型行卡）；「Cairn（内置）」facade 行与
// 38 项 preset 列表行已除（数据层全留，preset 仅在添加服务商 picker
// dialog 内出现，A5/A6）。A7 行可点感收编：模型行纯展示无 handler，
// 不渲染 chevron/三点装饰。
// #231 OAuth 着陆面：callback 302 回跳带 ?oauth=connected|error——error
// 自动重开添加弹窗并把 reason 文案喂进 connectError 行；connected 静默。
// #243：reason 三路 = denied（用户取消）/ exchange（交换失败）/ state
// （state 缺或过期——原裸 400 JSON 面退役，同律 302 着陆）。
import { MODEL_SOURCE_RUNTIMES, type ModelSource, type ModelSourceRuntime } from '@cairn/shared';
import { cn } from 'cn';
import { CircleAlert, CircleCheck, Cpu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useModelSources } from '../api/hooks.js';
import { RUNTIME_LABELS } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { ClaudeMark, PiMark } from '../components/brand-marks.js';
import { EmptyState } from '../components/empty-state.js';
import { SegmentedTabs } from '../components/segmented.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { oauthReasonCopy } from '../i18n/oauth-reason.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { CreateProviderDialog } from './create-provider-dialog.js';
import {
  ResourceList,
  ResourceNewButton,
  ResourceRow,
  RowDesc,
  RowMeta,
  RowText,
  RowTitle,
} from './parts.js';

export const PROVIDERS_HREF = '/app/resources/providers';

// tab 文案 = RUNTIME_LABELS（api/mappers.ts 单源，spec 11 §A1：无「内置」
// 字样；品牌/runtime 名不译，chief 压缩模型选择器同源消费）。

/** runtime 一行说明（A2 header 卡）；词表闭包 = MODEL_SOURCE_RUNTIMES。 */
const RUNTIME_DESCRIPTIONS: Record<ModelSourceRuntime, string> = {
  pi: 'cairn 自有运行时。模型来自你添加的服务商。',
  'claude-code': '执行机 Claude Code 配置（~/.claude/settings.json）的模型槽。',
};

/** runtime → 官方品牌 mark（components/brand-marks.tsx 单源，机器行
 * RUNTIME_MARKS 同源消费）。键集钉 ModelSourceRuntime：词表扩项时此处
 * 编译期报错，不会静默退化成无 mark 的 tab。 */
const RUNTIME_MARKS: Record<ModelSourceRuntime, typeof PiMark> = {
  pi: PiMark,
  'claude-code': ClaudeMark,
};

/** Needs-you ink (未安装 / 未登录): the accent, DESIGN.md 颜色. */
const NEEDS_YOU_INK = 'text-(--card-button)';

const isRuntime = (value: string | null): value is ModelSourceRuntime =>
  value !== null && (MODEL_SOURCE_RUNTIMES as readonly string[]).includes(value);

/** ?runtime= 解析：缺省/未知值一律落 pi（A1 默认 tab）。 */
function parseRuntime(searchParams: URLSearchParams): ModelSourceRuntime {
  const raw = searchParams.get('runtime');
  return isRuntime(raw) ? raw : 'pi';
}

/** A2 header 卡：runtime 名 + 一行说明 + 可用性。**主句**由「二进制在不在」
 *  优先决定，配置文件在不在次之；**细字行**报二进制的路径/版本与凭据角标
 *  （#1050）。两件事分开，不压平：配置文件在而二进制缺失（原来是假绿）现在
 *  说「未安装」；二进制在而没写配置说「已安装，未配置模型槽」（补法也不同）。
 *  二进制三态（别压平）：对象 = 探到了；`null` = 探过了没有；缺席 = 没探过
 *  （老 daemon）——那一路退回「只看 installed」的旧行为，且不写「未知」。
 *  Paper 设置列表：头部在模型行卡上方，不是卡；需要你处理的状态（未安装 /
 *  未登录）走赭红 + 图标。
 *  data-testid="runtime-head" = #910 二级结构载体（头部无 role，几何与
 *  安装态断言的锚；data-runtime 继续做 runtime 维度筛选）；data-auth 承载
 *  凭据态供 e2e 断言。 */
type HeadState = 'installed' | 'no-config' | 'bin-missing' | 'unknown';

function headState(source: ModelSource): HeadState {
  const bin = source.bin;
  if (typeof bin === 'object' && bin !== null) return source.installed ? 'installed' : 'no-config';
  // 探过了、没有：二进制说话——配置在也算没装（这正是要消的那类假绿）。
  if (bin === null) return 'bin-missing';
  return source.installed ? 'installed' : 'unknown';
}

function RuntimeHead({ source }: { source: ModelSource }) {
  const { t } = useI18n();
  const bin = source.bin;
  const state = headState(source);
  const binFound = typeof bin === 'object' && bin !== null;
  const notLoggedIn = source.auth?.state === 'not-logged-in';
  const guidance =
    state === 'no-config'
      ? t(
          '在该机器上写 ~/.claude/settings.json 的 env.ANTHROPIC_*_MODEL 槽后，此处自动展示其模型槽。',
        )
      : state === 'bin-missing' || state === 'unknown'
        ? t('安装 Claude Code 并完成一次登录后，此处自动展示其模型槽。')
        : null;
  const needsYou = state === 'bin-missing' || state === 'unknown';
  const StateIcon = needsYou ? CircleAlert : CircleCheck;
  return (
    <div
      data-testid="runtime-head"
      data-runtime={source.runtime}
      data-auth={source.auth?.state}
      data-state={state}
      className="mt-6 flex flex-col gap-0.5 px-1"
    >
      <div className="flex items-center gap-2">
        <span className="text-ui font-medium text-foreground">
          {RUNTIME_LABELS[source.runtime]}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 text-meta',
            needsYou ? NEEDS_YOU_INK : 'text-content-tertiary',
          )}
        >
          <StateIcon aria-hidden strokeWidth={1.75} className="size-3.5" />
          {state === 'installed'
            ? t('已安装在 {hostname}', { hostname: source.hostname })
            : state === 'no-config'
              ? t('已安装，未配置模型槽')
              : t('未安装')}
        </span>
      </div>
      {binFound && (
        <p data-testid="runtime-bin" className="m-0 text-meta text-content-tertiary">
          {`claude${bin.version !== null ? ` ${bin.version}` : ''} · ${bin.path}`}
          {notLoggedIn && <span className={NEEDS_YOU_INK}>{` · ${t('未登录')}`}</span>}
        </p>
      )}
      <p className="m-0 text-meta text-content-tertiary">
        {t(RUNTIME_DESCRIPTIONS[source.runtime])}
      </p>
      {guidance !== null && <p className="m-0 text-meta text-content-tertiary">{guidance}</p>}
    </div>
  );
}

export function ProvidersPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  // live = GET model-sources 封套；fixture = scenario 资源集（canon 展示）。
  const sourcesQ = useModelSources(teamId, live);
  const sources = live
    ? (sourcesQ.data?.sources ?? [])
    : (fixture.resources?.providerSources ?? []);
  const runtime = parseRuntime(searchParams);
  // #707：claude-code 段按机器分段——同 runtime 可多段（每台机器一段），
  // pi 恒一段。单机形态下 matching 恰一段，与旧单段渲染等价。
  const matching = sources.filter((source) => source.runtime === runtime);
  // 添加 (topbar 新建 / pi 空态引导钮) opens the picker dialog; live
  // submit = POST providers then close (invalidateAll refetches 两封套)，
  // fixture = accept 律
  const mutations = useApiMutations(teamId);
  const [createOpen, setCreateOpen] = useState(false);
  // #231：连接订阅失败 inline 行（authorize 400 原文 / 落地 reason 文案）。
  const [connectError, setConnectError] = useState<string | null>(null);

  // OAuth callback 着陆参（?oauth=connected|error&reason=…）：error 重开弹窗
  // 喂文案；读后清参，刷新不重放。只删 oauth/reason 两键——scenario/runtime
  // 等其余参保留，不翻动 fixture/live 判定与 tab 定位。
  useEffect(() => {
    const oauth = searchParams.get('oauth');
    if (oauth === null) return;
    if (oauth === 'error') {
      // #243 reason 三路分译单源 = i18n/oauth-reason.ts（#361 两着陆面共用）。
      setConnectError(oauthReasonCopy(searchParams.get('reason'), t));
      setCreateOpen(true);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('oauth');
    next.delete('reason');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t]);

  // tab 切换 = 写 ?runtime=（保留 scenario 等其余参）；历史入栈，回退键可用。
  const selectRuntime = (next: ModelSourceRuntime) => {
    const params = new URLSearchParams(searchParams);
    params.set('runtime', next);
    setSearchParams(params);
  };

  return (
    <PageShell
      route={PROVIDERS_HREF}
      title={t('模型服务')}
      selected={PROVIDERS_HREF}
      actions={<ResourceNewButton onClick={() => setCreateOpen(true)} />}
      fixture={fixture}
    >
      {/* #423：runtime tab 由 ?runtime= 驱动（#422 裁决），selectRuntime 写
          ?runtime=、历史入栈、回退键可用；每个 runtime 是独立视图，故走
          SegmentedTabs（tablist/tab）。data-runtime 句柄原样透出；品牌 mark
          aria-hidden，可访问名 = RUNTIME_LABELS。 */}
      <SegmentedTabs
        label={t('模型服务')}
        value={runtime}
        onChange={selectRuntime}
        options={MODEL_SOURCE_RUNTIMES.map((rt) => {
          const Mark = RUNTIME_MARKS[rt];
          return {
            value: rt,
            label: RUNTIME_LABELS[rt],
            icon: <Mark className="block flex-none" />,
            data: { 'data-runtime': rt },
          };
        })}
      />
      {matching.map((source, si) => (
        // 多机同 hostname 时 header 文案可撞——key 用索引兜底保唯一。
        <div key={`${source.hostname}:${si}`}>
          <RuntimeHead source={source} />
          {source.models.length > 0 ? (
            <ResourceList className="mt-3">
              {source.models.map((model, i) => (
                <ResourceRow
                  // pi 段跨 provider 平铺，模型 id 偶发撞名——索引兜底保唯一。
                  key={`${model.id}:${i}`}
                  // #1288：dead 模型置灰（不隐藏）。
                  className={cn(model.liveness === 'dead' && 'opacity-50')}
                  data-runtime={source.runtime}
                  data-model-id={model.id}
                  data-liveness={model.liveness ?? 'unknown'}
                >
                  <RowText>
                    <RowTitle>{model.name}</RowTitle>
                    <RowDesc>{model.id}</RowDesc>
                  </RowText>
                  {(model.slot != null || model.liveness === 'dead') && (
                    <span className="flex items-center gap-3">
                      {model.liveness === 'dead' && <RowMeta>{t('已下架')}</RowMeta>}
                      {model.slot != null && <RowMeta className="font-mono">{model.slot}</RowMeta>}
                    </span>
                  )}
                </ResourceRow>
              ))}
            </ResourceList>
          ) : source.runtime === 'pi' ? (
            <EmptyState
              testId="runtime-empty"
              className="mt-3"
              icon={Cpu}
              title={t('尚未添加服务商。')}
              description={t('添加后，服务商的模型会出现在这里。')}
              action={{ label: t('添加模型服务'), onClick: () => setCreateOpen(true) }}
            />
          ) : (
            source.installed && (
              <EmptyState
                testId="runtime-empty"
                className="mt-3"
                icon={Cpu}
                title={t('settings.json 未配置模型槽。')}
              />
            )
          )}
        </div>
      ))}
      {matching.length === 0 && (
        // #707：尚无执行机上报过（旧 daemon / 未注册）——缺席不断言未安装。
        <EmptyState
          testId="runtime-empty"
          className="mt-6"
          icon={Cpu}
          title={t('尚无执行机上报模型信息。')}
        />
      )}
      <CreateProviderDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setConnectError(null);
        }}
        pending={mutations.createProvider.isPending}
        onCreate={
          live
            ? (body) =>
                mutations.createProvider.mutate(body, {
                  onSuccess: () => setCreateOpen(false),
                  // #638：失败 = 弹窗留着但零反馈（connectError 行是 OAuth
                  // 专属语义位，不复用）——toast 点名。
                  onError: (error) => toastError(t('添加模型服务失败，请重试。'), error),
                })
            : undefined
        }
        onConnect={
          live
            ? (presetId) => {
                setConnectError(null);
                mutations.startProviderOAuth.mutate(presetId, {
                  // 成功 = 同页签跳授权页;dialog 随整页导航退场。
                  onSuccess: (data) => window.location.assign(data.authorizationUrl),
                  onError: (err) => setConnectError(err.message),
                });
              }
            : undefined
        }
        connectPending={mutations.startProviderOAuth.isPending}
        connectError={connectError}
      />
    </PageShell>
  );
}
