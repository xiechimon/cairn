import { Layers, Palette, Server, User } from 'lucide-react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import {
  type MachineWithProviders,
  type SubscriptionAccount,
  toClaudeAccount,
} from '../api/claude-accounts.js';
import { toRoutingGraph } from '../api/model-routing.js';
import {
  AccountRow,
  MachineProvidersCard,
  PoolWindowCard,
} from '../components/accounts/account-parts.js';
import { ClaudeMark } from '../components/brand-marks.js';
import {
  type ProviderItem,
  ProviderModelRow,
  ProviderPanel,
} from '../components/providers/provider-panel.js';
import { RoutingGraph } from '../components/settings/routing-graph.js';
import { SettingsNav } from '../components/settings/settings-nav.js';
import { SettingsCard } from '../components/settings-list.js';
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
import { SubscriptionAccounts } from '../resources/accounts-view.js';
import { OnlineStatus } from '../resources/parts.js';
import { Section, Specimen } from './specimen.js';

const NOW = r7(13, 14);
const TOGGLEABLE: readonly string[] = ['pi', 'claude-code', 'gemini'];

function useAccounts() {
  const [accounts, setAccounts] = useState<SubscriptionAccount[]>(() => [
    ...ACCOUNT_SUBSCRIPTIONS.map((wire) => toClaudeAccount(wire, NOW)),
    ...OTHER_ACCOUNTS,
  ]);
  const actionsFor = (account: SubscriptionAccount) => ({
    onRename: (label: string) =>
      setAccounts((rows) => rows.map((row) => (row.id === account.id ? { ...row, label } : row))),
    onVerify: () => undefined,
    onRemove: () => setAccounts((rows) => rows.filter((row) => row.id !== account.id)),
  });
  return { accounts, actionsFor };
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
      onAdd={() => undefined}
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
  const [query, setQuery] = useState('');
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
                { id: 'machines', label: 'Machines', Icon: Server, badge: '4/5' },
              ],
            },
          ]}
          current={current}
          hrefFor={(id) => {
            return { hash: id };
          }}
          query={query}
          onQuery={(next) => {
            setQuery(next);
            if (next === '') setCurrent('providers');
          }}
        />
      </div>
    </MemoryRouter>
  );
}

export function AccountsSection() {
  const { t } = useI18n();
  const { accounts, actionsFor } = useAccounts();
  const [machine, setMachine] = useState<MachineWithProviders | undefined>(PROVIDER_MACHINES[0]);
  const claude = accounts.filter((a) => a.vendor === 'claude');
  const graph = toRoutingGraph(ACCOUNT_ROUTING, {
    accounts,
    providers: ACCOUNTS.providers,
    machineNames: new Map(ACCOUNT_MACHINES.map((m) => [m.id, m.name])),
    t,
  });
  return (
    <Section
      id="accounts"
      title="Accounts"
      lede="Subscription accounts per vendor, pooled the way T3 Code's Usage → Limits does: one card per quota window, one bar segment per account, the number is what is left. They sit on top of the model routing page, above the graph."
    >
      <Specimen
        id="pooled-window"
        title="Pooled window"
        note="5-hour window over three Claude accounts: one over its limit, one never reported (dashed)"
        stage="sheet"
        code={`<PoolWindowCard name="five_hour" accounts={claudeAccounts} now={now} />`}
      >
        <div className="w-full">
          <PoolWindowCard name="five_hour" accounts={claude} now={NOW} />
        </div>
      </Specimen>
      <Specimen
        id="account-row"
        title="Account row"
        note="ok, cooling, expired; the number matches the bar segment; ⋯ opens Rename R, Verify V, Remove D"
        stage="sheet"
        code={`<AccountRow account={account} now={now} actions={{ onRename, onVerify, onRemove }} />`}
      >
        <div className="w-full">
          <SettingsCard>
            {claude.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                now={NOW}
                actions={actionsFor(account)}
              />
            ))}
          </SettingsCard>
        </div>
      </Specimen>
      <Specimen
        id="subscription-accounts"
        title="Subscription accounts"
        note="one vendor at a time through SegmentedTabs (icon + count); Add account follows the selected vendor; a Claude row opens to its steps and sticky threads"
        stage="sheet"
      >
        <div className="w-full">
          <SubscriptionAccounts
            accounts={accounts}
            stepsByAccount={ACCOUNT_STEPS}
            stickiness={ACCOUNT_STICKINESS}
            now={NOW}
            actionsFor={actionsFor}
            onAdd={() => undefined}
          />
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
        code={`<ProviderPanel items={items} selectedId={id} onSelect={select} onAdd={add}>{editor}</ProviderPanel>`}
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
