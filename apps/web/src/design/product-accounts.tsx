import type { ModelSourceModel, ProviderRecord } from '@cairn/shared';
import { Layers, Monitor, Palette, Server, User } from 'lucide-react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import type { Verification } from '../api/account-verification.js';
import type { MachineWithProviders, SubscriptionAccount } from '../api/claude-accounts.js';
import { MachineProvidersCard, useClock } from '../components/accounts/account-parts.js';
import { ClaudeMark } from '../components/brand-marks.js';
import { EmptyState } from '../components/empty-state.js';
import { type ProviderItem, ProviderPanel } from '../components/providers/provider-panel.js';
import { QueryBoundary, type QueryLike } from '../components/query-state.js';
import { SettingsNav } from '../components/settings/settings-nav.js';
import { SettingsSearch } from '../components/settings/settings-search.js';
import { ACCOUNT_SUBSCRIPTIONS, PROVIDER_MACHINES } from '../fixtures/accounts.js';
import { r7 } from '../fixtures/core.js';
import { useI18n } from '../i18n/provider.js';
import { OnlineStatus } from '../resources/parts.js';
import { TeamProviderEditor } from '../resources/provider-editors.js';
import {
  SubscriptionDetail,
  subscriptionRowTone,
  subscriptionStatusView,
  subscriptionSummary,
} from '../resources/subscription-detail.js';
import { Section, Specimen } from './specimen.js';

const NOW = r7(13, 14);

const SPECIMEN_SUBSCRIPTION_MODELS: ModelSourceModel[] = [
  { id: 'claude-opus-5-5', name: 'claude-opus-5-5', slot: 'default' },
  { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', slot: 'sonnet' },
  { id: 'claude-haiku-5-5', name: 'claude-haiku-5-5', slot: 'haiku' },
];

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

function fixtureAccount(label: string): SubscriptionAccount {
  const account = ACCOUNT_SUBSCRIPTIONS.find((candidate) => candidate.label === label);
  if (account === undefined) throw new Error(`no fixture subscription named ${label}`);
  return account;
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
      verification: { phase: 'not-run', cause: 'network' },
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
    view: subscriptionStatusView(account, NOW, t, clock),
  }));
  const items: ProviderItem[] = [
    ...views.map(({ account, view }) => ({
      id: account.id,
      name: account.label,
      Mark: ClaudeMark,
      status: subscriptionSummary(account, view, SPECIMEN_SUBSCRIPTION_MODELS, NOW, t),
      tone: subscriptionRowTone(view, SPECIMEN_SUBSCRIPTION_MODELS),
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
          models={SPECIMEN_SUBSCRIPTION_MODELS}
          fallback
          now={NOW}
          view={current.view}
          verification={current.verification}
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
  const view = subscriptionStatusView(account, NOW, t, clock);
  return (
    <div data-state={state} className="flex flex-col gap-6">
      <SubscriptionDetail
        account={account}
        models={SPECIMEN_SUBSCRIPTION_MODELS}
        fallback
        now={NOW}
        view={view}
        verification={undefined}
        actions={{
          onVerify: () => undefined,
          onRename: () => undefined,
          onRemove: () => undefined,
        }}
      />
    </div>
  );
}

const SPECIMEN_PROVIDER: ProviderRecord = {
  kind: 'custom',
  id: 'prov-specimen',
  providerId: 'gateway',
  label: 'Gateway',
  baseUrl: 'https://gateway.example.invalid/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: {},
  models: [
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
  ],
  createdBy: 'u1',
  createdAt: NOW,
  updatedAt: NOW,
};

function ProviderPanelSpecimen() {
  const [selected, setSelected] = useState('anthropic');
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
      tone: 'warn',
    },
  ];
  return (
    <ProviderPanel
      items={items}
      selectedId={selected}
      onSelect={setSelected}
      header={<h2 className="m-0 text-card-title font-semibold text-foreground">Providers</h2>}
    >
      <TeamProviderEditor
        record={SPECIMEN_PROVIDER}
        deadModels={new Set(['claude-opus-4-5'])}
        actions={{}}
      />
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
                  label: 'Runners',
                  Icon: Server,
                  note: '4 of 5 Runners online',
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
  const machine: MachineWithProviders | undefined = PROVIDER_MACHINES[0];
  return (
    <Section
      id="accounts"
      title="Accounts"
      lede="Subscriptions live in the Providers list next to API keys, the way T3 Code's Providers page lists Codex and Claude: one row per account with kind and one status, the account's quota and usage in its detail. The routing page keeps only the graph."
    >
      <Specimen
        id="subscription-provider-list"
        title="Subscriptions in the provider list"
        note="a subscription is one provider row beside API keys: kind, plan, one status, last use. States: available, verifying, failed with its reason, cooling, expired, never used. The detail shows status with Retry, quota, last use, 24 hour steps and Remove"
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
        note="status, last use and 24 hour steps, then one bar per quota window"
        stage="sheet"
        code={`<SubscriptionDetail account={account} now={now} view={view} verifying={false} actions={actions} />`}
      >
        <div className="flex w-full max-w-160 flex-col gap-6">
          <SubscriptionDetailSpecimen state="ok" />
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
              loadingLabel={t('正在加载执行机')}
              errorTitle={t('执行机没能加载')}
              skeletonRows={2}
              empty={
                <EmptyState
                  testId="resource-empty"
                  icon={Monitor}
                  title={t('尚无执行机')}
                  description={t('在要执行任务的执行机上运行注册命令，它就会出现在这里。')}
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
        code={`<MachineProvidersCard machine={machine} online={<OnlineStatus on />} />`}
      >
        {machine !== undefined && (
          <div className="w-full">
            <MachineProvidersCard machine={machine} online={<OnlineStatus on={machine.online} />} />
          </div>
        )}
      </Specimen>
    </Section>
  );
}
