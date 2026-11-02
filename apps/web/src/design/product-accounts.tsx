import { useState } from 'react';
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
import { RoutingGraph } from '../components/settings/routing-graph.js';
import { SettingsCard } from '../components/settings-list.js';
import {
  ACCOUNT_MACHINES,
  ACCOUNT_ROUTING,
  ACCOUNT_STEPS,
  ACCOUNT_STICKINESS,
  ACCOUNT_SUBSCRIPTIONS,
  ACCOUNTS,
  OTHER_ACCOUNTS,
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

export function AccountsSection() {
  const { t } = useI18n();
  const { accounts, actionsFor } = useAccounts();
  const [machine, setMachine] = useState<MachineWithProviders | undefined>(ACCOUNT_MACHINES[0]);
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
        title="Account row"
        note="ok, cooling, expired; the number matches the bar segment; ⋯ opens Rename R, Verify V, Remove D"
        stage="sheet"
        code={`<AccountRow account={account} index={0} now={now} actions={{ onRename, onVerify, onRemove }} />`}
      >
        <div className="w-full">
          <SettingsCard>
            {claude.map((account, index) => (
              <AccountRow
                key={account.id}
                account={account}
                index={index}
                now={NOW}
                actions={actionsFor(account)}
              />
            ))}
          </SettingsCard>
        </div>
      </Specimen>
      <Specimen
        title="Subscription accounts"
        note="Claude, ChatGPT · Codex and Grok; a Claude row opens to its steps and sticky threads"
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
