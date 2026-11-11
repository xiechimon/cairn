import { Layers, Monitor, Palette, Server, User } from 'lucide-react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { accountStatusOf, type Verification } from '../api/account-verification.js';
import {
  type MachineWithProviders,
  type SubscriptionAccount,
  toClaudeAccount,
} from '../api/claude-accounts.js';
import { toRoutingGraph } from '../api/model-routing.js';
import { MachineProvidersCard, useClock } from '../components/accounts/account-parts.js';
import { ClaudeMark } from '../components/brand-marks.js';
import { CheckedButton } from '../components/checked-button.js';
import { EmptyState } from '../components/empty-state.js';
import {
  type ProviderItem,
  ProviderModelRow,
  ProviderPanel,
} from '../components/providers/provider-panel.js';
import { QueryBoundary, type QueryLike } from '../components/query-state.js';
import { RoutingGraph } from '../components/settings/routing-graph.js';
import { SettingsNav } from '../components/settings/settings-nav.js';
import { SettingsSearch } from '../components/settings/settings-search.js';
import { SettingsCard } from '../components/settings-list.js';
import { SettingsScopeSentence, TEAM_SCOPE } from '../components/settings-scope.js';
import {
  ACCOUNT_MACHINES,
  ACCOUNT_ROUTING,
  ACCOUNT_STEPS,
  ACCOUNT_STICKINESS,
  ACCOUNT_SUBSCRIPTIONS,
  ACCOUNTS,
  OTHER_ACCOUNTS,
  PROVIDER_MACHINES,
} from '../fixtures/accounts.js';
import { r7 } from '../fixtures/core.js';
import { useI18n } from '../i18n/provider.js';
import { OnlineStatus } from '../resources/parts.js';
import {
  SubscriptionDetail,
  subscriptionStatusView,
  subscriptionSummary,
} from '../resources/subscription-detail.js';
import { Section, Specimen } from './specimen.js';

const NOW = r7(13, 14);
const TOGGLEABLE: readonly string[] = ['pi', 'claude-code', 'gemini'];

const SCOPE_MACHINES = [
  { id: 'scope-mac-a1b2', kind: 'local', name: 'studio', online: true },
  { id: 'scope-mac-c3d4', kind: 'remote', name: 'build-box', online: true },
  { id: 'scope-mac-e5f6', kind: 'remote', name: 'build-box', online: false },
] as const;

const settledQuery: QueryLike = {
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: () => undefined,
};

const QUERY_PHASES = [
  { phase: 'loading', query: { ...settledQuery, isPending: true, isFetching: true } },
  { phase: 'error', query: { ...settledQuery, isError: true } },
  { phase: 'empty', query: settledQuery },
] as const;

const ROUTING_ACCOUNTS: SubscriptionAccount[] = [
  ...ACCOUNT_SUBSCRIPTIONS.map((wire) => toClaudeAccount(wire, NOW)),
  ...OTHER_ACCOUNTS,
];

function fixtureAccount(label: string): SubscriptionAccount {
  const wire = ACCOUNT_SUBSCRIPTIONS.find((candidate) => candidate.label === label);
  if (wire === undefined) throw new Error(`no fixture subscription named ${label}`);
  return toClaudeAccount(wire, NOW);
}

const FRESH_SUBSCRIPTION: SubscriptionAccount = {
  id: 'fresh',
  vendor: 'claude',
  label: 'Spare laptop',
  expiresAt: null,
  createdAt: NOW - 60_000,
  plan: null,
  state: 'ok',
  cooldownUntil: null,
  windows: [],
  lastUsedAt: null,
  stepsLast24h: null,
};

function subscriptionStates(): {
  account: SubscriptionAccount;
  verification?: Verification;
}[] {
  const personal = fixtureAccount('Personal');
  const work = fixtureAccount('Work');
  const legacy = fixtureAccount('Old laptop');
  return [
    { account: personal },
    {
      account: { ...personal, id: 'verifying', label: 'Verifying' },
      verification: { phase: 'verifying' },
    },
    {
      account: { ...personal, id: 'network', label: 'After restart' },
      verification: { phase: 'failed', reason: 'network' },
    },
    { account: work },
    { account: { ...legacy, state: 'expired' } },
    { account: FRESH_SUBSCRIPTION },
  ];
}

function SubscriptionPanelSpecimen() {
  const { t } = useI18n();
  const clock = useClock();
  const states = subscriptionStates();
  const [selected, setSelected] = useState('network');
  const views = states.map(({ account, verification }) => ({
    account,
    verification,
    view: subscriptionStatusView(account, accountStatusOf(account, verification), NOW, t, clock),
  }));
  const items: ProviderItem[] = [
    ...views.map(({ account, view }) => ({
      id: account.id,
      name: account.label,
      Mark: ClaudeMark,
      status: subscriptionSummary(account, view, NOW, t),
      tone: view.tone,
    })),
    {
      id: 'anthropic',
      name: 'Anthropic',
      Mark: ClaudeMark,
      status: 'API key · 3 models',
      tone: 'ok',
    },
  ];
  const current = views.find(({ account }) => account.id === selected) ?? views[0];
  return (
    <ProviderPanel
      items={items}
      selectedId={selected}
      onSelect={setSelected}
      header={<h2 className="m-0 text-card-title font-semibold text-foreground">{t('服务商')}</h2>}
    >
      {current !== undefined && (
        <SubscriptionDetail
          account={current.account}
          now={NOW}
          view={current.view}
          verifying={current.verification?.phase === 'verifying'}
          steps={ACCOUNT_STEPS[current.account.id]}
          sticky={ACCOUNT_STICKINESS.filter(
            (thread) => thread.subscriptionId === current.account.id,
          )}
          actions={{
            onVerify: () => undefined,
            onRename: () => undefined,
            onRemove: () => undefined,
          }}
        />
      )}
    </ProviderPanel>
  );
}

function SubscriptionDetailSpecimen({ state }: { state: 'ok' }) {
  const { t } = useI18n();
  const clock = useClock();
  const account = fixtureAccount('Personal');
  const view = subscriptionStatusView(account, accountStatusOf(account, undefined), NOW, t, clock);
  return (
    <div data-state={state} className="flex flex-col gap-6">
      <SubscriptionDetail
        account={account}
        now={NOW}
        view={view}
        verifying={false}
        steps={ACCOUNT_STEPS[account.id]}
        sticky={ACCOUNT_STICKINESS.filter((thread) => thread.subscriptionId === account.id)}
        actions={{
          onVerify: () => undefined,
          onRename: () => undefined,
          onRemove: () => undefined,
        }}
      />
    </div>
  );
}

function ProviderPanelSpecimen() {
  const [selected, setSelected] = useState('anthropic');
  const [cli, setCli] = useState(true);
  const items: ProviderItem[] = [
    {
      id: 'anthropic',
      name: 'Anthropic',
      Mark: ClaudeMark,
      status: 'API key · 1 model',
      tone: 'ok',
    },
    {
      id: 'relay',
      name: 'Gateway',
      Mark: Server,
      status: 'Custom endpoint · 1 retired',
      tone: 'warn',
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      Mark: ClaudeMark,
      version: '2.1.316',
      status: 'Not signed in',
      tone: cli ? 'warn' : 'off',
      toggle: { checked: cli, onChange: setCli },
    },
  ];
  return (
    <ProviderPanel
      items={items}
      selectedId={selected}
      onSelect={setSelected}
      header={<h2 className="m-0 text-card-title font-semibold text-foreground">Providers</h2>}
    >
      <SettingsCard>
        <ProviderModelRow
          name="Claude Haiku 5.5"
          id="claude-haiku-5-5"
          onRemove={() => undefined}
        />
        <ProviderModelRow name="claude-opus-4-5" id="claude-opus-4-5" dead />
        <ProviderModelRow name="default-sonnet" id="claude-sonnet-5-5" />
      </SettingsCard>
    </ProviderPanel>
  );
}

function SettingsNavSpecimen() {
  const [current, setCurrent] = useState('providers');
  return (
    <MemoryRouter>
      <div className="h-80 w-60 rounded-(--radius-card) bg-(--surface-1)">
        <SettingsNav
          groups={[
            {
              heading: null,
              items: [
                { id: 'account', label: 'Account', Icon: User },
                { id: 'appearance', label: 'Appearance', Icon: Palette },
              ],
            },
            {
              heading: 'Models & accounts',
              items: [
                { id: 'providers', label: 'Providers', Icon: Layers },
                {
                  id: 'machines',
                  label: 'Machines',
                  Icon: Server,
                  note: '4 of 5 computers online',
                },
              ],
            },
          ]}
          current={current}
          hrefFor={(id) => {
            return { hash: id };
          }}
          search={
            <SettingsSearch
              sections={[
                { id: 'account', label: 'Account', Icon: User },
                { id: 'appearance', label: 'Appearance', Icon: Palette },
              ]}
              onPick={(pick) => setCurrent(pick.section)}
            />
          }
        />
      </div>
    </MemoryRouter>
  );
}

export function AccountsSection() {
  const { t } = useI18n();
  const [machine, setMachine] = useState<MachineWithProviders | undefined>(PROVIDER_MACHINES[0]);
  const [scopeValue, setScopeValue] = useState(TEAM_SCOPE);
  const [scopeCheckedAt] = useState(() => Date.now());
  const graph = toRoutingGraph(ACCOUNT_ROUTING, {
    accounts: ROUTING_ACCOUNTS,
    providers: ACCOUNTS.providers,
    machineNames: new Map(ACCOUNT_MACHINES.map((m) => [m.id, m.name])),
    t,
  });
  return (
    <Section
      id="accounts"
      title="Accounts"
      lede="Subscriptions live in the Providers list next to API keys, the way T3 Code's Providers page lists Codex and Claude: one row per account with kind and one status, the account's quota and usage in its detail. The routing page keeps only the graph."
    >
      <Specimen
        id="subscription-provider-list"
        title="Subscriptions in the provider list"
        note="a subscription is one provider row beside API keys: kind, plan, one status, last use. States: available, verifying, failed with its reason, cooling, expired, never used. The detail shows status with Retry, quota, last use, 24 hour steps, steps and Remove"
        stage="sheet"
        code={`<ProviderPanel items={subscriptionItems} selectedId={id} onSelect={select}><SubscriptionDetail account={account} view={view} /></ProviderPanel>`}
      >
        <div className="w-full">
          <SubscriptionPanelSpecimen />
        </div>
      </Specimen>
      <Specimen
        id="subscription-detail-quota"
        title="Subscription detail with quota"
        note="status, last use and 24 hour steps, then one bar per quota window, the steps this account ran and its sticky threads"
        stage="sheet"
        code={`<SubscriptionDetail account={account} now={now} view={view} verifying={false} steps={steps} sticky={sticky} actions={actions} />`}
      >
        <div className="flex w-full max-w-160 flex-col gap-6">
          <SubscriptionDetailSpecimen state="ok" />
        </div>
      </Specimen>
      <Specimen
        id="routing-from-the-api"
        title="Routing from the API"
        note="toRoutingGraph maps GET /model-routing onto the graph; nightly scan has no connection"
        stage="sheet"
        code={`<RoutingGraph {...toRoutingGraph(routing, { accounts, providers, machineNames, t })} />`}
      >
        <div className="w-full overflow-x-auto">
          <div className="min-w-160">
            <RoutingGraph jobs={graph.jobs} connections={graph.connections} />
          </div>
        </div>
      </Specimen>
      <Specimen
        id="provider-panel"
        title="Provider panel"
        note="Providers page: list of instances (status dot ok, warn, off; optional runtime switch) beside the selected one's editor; model rows show name, id, retired, remove"
        stage="sheet"
        code={`<ProviderPanel items={items} selectedId={id} onSelect={select} header={title}>{editor}</ProviderPanel>`}
      >
        <div className="w-full">
          <ProviderPanelSpecimen />
        </div>
      </Specimen>
      <Specimen
        id="settings-scope"
        title="Settings scope sentence"
        note="Server-side settings pages: one sentence names what the page edits, the menu lists All machines with a server icon and each machine with a monitor icon, same-name machines get an id suffix, offline machines are marked; device and personal pages do not show it"
        stage="sheet"
        code={`<SettingsScopeSentence machines={machines} scope={scope} onChange={setScope} trailing={<CheckedButton updatedAt={at} fetching={false} />} />`}
      >
        <div className="w-full">
          <SettingsScopeSentence
            machines={[...SCOPE_MACHINES]}
            scope={scopeValue}
            onChange={setScopeValue}
            trailing={<CheckedButton updatedAt={scopeCheckedAt} fetching={false} />}
          />
        </div>
      </Specimen>
      <Specimen
        id="settings-nav"
        title="Settings nav"
        note="Settings window: search narrows the list, groups with a heading, current section highlighted, optional count badge"
        stage="sheet"
        code={`<SettingsNav groups={groups} current={id} hrefFor={hrefFor} query={q} onQuery={setQ} />`}
      >
        <SettingsNavSpecimen />
      </Specimen>
      <Specimen
        id="query-boundary"
        title="Query boundary"
        note="a live list pane: a quiet skeleton while the first fetch runs, an error with Retry when it fails, and the empty state only after a successful fetch"
        stage="sheet"
        code={`<QueryBoundary query={live ? listQuery : undefined} isEmpty={rows.length === 0} empty={<EmptyState />} loadingLabel={label} errorTitle={title}>{list}</QueryBoundary>`}
      >
        <div className="flex w-full flex-col gap-6">
          {QUERY_PHASES.map(({ phase, query }) => (
            <QueryBoundary
              key={phase}
              query={query}
              isEmpty
              loadingLabel={t('正在加载机器')}
              errorTitle={t('机器没能加载')}
              skeletonRows={2}
              empty={
                <EmptyState
                  testId="resource-empty"
                  icon={Monitor}
                  title={t('尚无机器')}
                  description={t('在要执行任务的机器上运行注册命令，它就会出现在这里。')}
                />
              }
            >
              {null}
            </QueryBoundary>
          ))}
        </div>
      </Specimen>
      <Specimen
        id="providers-on-one-machine"
        title="Providers on one machine"
        note="shown on the machine detail page: signed in, signed out with its login command, unknown"
        stage="sheet"
        code={`<MachineProvidersCard machine={machine} toggleable={canToggle} onToggle={toggle} online={<OnlineStatus on />} />`}
      >
        {machine !== undefined && (
          <div className="w-full">
            <MachineProvidersCard
              machine={machine}
              toggleable={(runtime) => TOGGLEABLE.includes(runtime)}
              online={<OnlineStatus on={machine.online} />}
              onToggle={(runtime, next) =>
                setMachine({
                  ...machine,
                  providers: machine.providers?.map((p) =>
                    p.runtime === runtime ? { ...p, enabled: next } : p,
                  ),
                })
              }
            />
          </div>
        )}
      </Specimen>
    </Section>
  );
}
