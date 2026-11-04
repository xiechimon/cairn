import { Network } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useMcpServers } from '../api/hooks.js';
import { mapMcpServers } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import {
  ResourceList,
  ResourceRow,
  RowDesc,
  RowLine,
  RowMeta,
  RowText,
  RowTitle,
} from './parts.js';

export const MCP_HREF = '/app/resources/mcp-servers';

export function McpServersPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const mcpQ = useMcpServers(teamId, live);
  const servers = live
    ? mapMcpServers(mcpQ.data ?? [], Date.now())
    : (fixture.resources?.mcpServers ?? []);

  return (
    <PageShell route={MCP_HREF} title={t('MCP 服务器')} selected={MCP_HREF} fixture={fixture}>
      {servers.length === 0 ? (
        <EmptyState
          testId="resource-empty"
          className="mt-6"
          icon={Network}
          title={t('尚无 MCP 服务器。')}
          description={t(
            '读取 server 本机 ~/.claude.json 的 mcpServers 段：在该文件添加配置并刷新，即出现在这里。MCP 服务器为 Agent 提供额外工具；授权在每个 Agent 的页面上单独进行。',
          )}
        />
      ) : (
        <ResourceList>
          {servers.map((server) => (
            <ResourceRow mcp key={server.name}>
              <RowText>
                <RowLine>
                  <RowTitle>{server.name}</RowTitle>
                  <RowMeta>{t(server.kind)}</RowMeta>
                </RowLine>
                <RowDesc>{server.url}</RowDesc>
              </RowText>
              <RowMeta>{t(server.ago)}</RowMeta>
            </ResourceRow>
          ))}
        </ResourceList>
      )}
    </PageShell>
  );
}
