import { cn } from 'cn';
import type { SVGProps } from 'react';
import { CARD_RADIUS_CLS } from '../components/settings-list.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { TeamAgentCard } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { TeamAgentsEmpty } from './team-agent-grid.js';

function CrownGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M7 17V13C3.5 13 3 10 5 8 5 5 8 3 12 3s7 2 7 5c2 2 1.5 5-2 5v4" />
      <rect x="7" y="17" width="10" height="3" rx=".75" />
    </svg>
  );
}

function ProviderGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M2 2h15v10h-5V7H2ZM2 7h5v5h5v5H7v5H2ZM17 12h5v10h-5Z" />
    </svg>
  );
}

const NODE_CLS = cn(
  'flex h-14 w-55 items-center gap-2 bg-card px-2.5 shadow-(--panel-shadow)',
  CARD_RADIUS_CLS,
);

function ChartNode({ agent, crown }: { agent: TeamAgentCard; crown?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={NODE_CLS} data-testid="team-chart-node">
      <span className="flex size-8 flex-none overflow-hidden rounded-full bg-card ring-1 ring-border [&_img]:size-8">
        <SeededAvatar
          className="size-8"
          name={agent.displayName}
          src={agent.avatarUrl}
          fallback="/avatar-robot-1.svg"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex h-4.5 min-w-0 items-center gap-1">
          <span
            className="truncate text-ui font-medium text-foreground"
            data-testid="team-chart-name"
          >
            {agent.displayName}
          </span>
          {crown && (
            <span
              className="flex size-4.5 flex-none items-center justify-center rounded-full bg-spot-soft text-(--card-button)"
              data-testid="team-chart-crown"
            >
              <CrownGlyph />
            </span>
          )}
        </span>
        <span className="flex h-4.5 min-w-0 items-center gap-1">
          {agent.provider ? (
            <span
              className="flex size-4.5 flex-none items-center justify-center rounded-full bg-muted text-foreground"
              data-testid="team-chart-provider"
            >
              <ProviderGlyph />
            </span>
          ) : null}
          <span className="truncate text-meta text-content-tertiary" data-testid="team-chart-model">
            {agent.model}
            {agent.isDefault ? t(' · 默认') : ''}
          </span>
        </span>
      </span>
    </div>
  );
}

export function TeamChart({
  agents,
  chiefAgentId,
}: {
  agents: TeamAgentCard[];
  chiefAgentId: string | null;
}) {
  const root = agents.find((a) => a.id === chiefAgentId) ?? agents[0];
  if (!root) return <TeamAgentsEmpty />;
  const subordinates = agents.filter((a) => a.id !== root.id);
  return (
    <div className="flex items-center">
      <ChartNode agent={root} crown />
      {subordinates.length > 0 && (
        <>
          <div className="h-px w-11 flex-none bg-input" data-testid="team-chart-link" />
          <div className="flex" data-testid="team-chart-children">
            {subordinates.length > 1 && (
              <div className="relative w-7 flex-none">
                <div
                  className="absolute top-7 bottom-7 left-0 w-7 rounded-l-md border border-r-0 border-input"
                  data-testid="team-chart-bracket"
                />
              </div>
            )}
            <div className="flex flex-col gap-2" data-testid="team-chart-nodes">
              {subordinates.map((a) => (
                <ChartNode key={a.id} agent={a} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
