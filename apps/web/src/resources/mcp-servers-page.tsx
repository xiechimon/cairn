// MCP 服务器 route (issue #69, r7 09; spec 13/#368 本地 config 只读制):
// one card row per server — 20px orange plug tile, name + type label on
// the title line, endpoint url below, relative modification label at the
// right edge. 数据源 = server 本机 ~/.claude.json mcpServers 段投影
// (GET mcp-servers；密钥值永不上接口，record 只带 hasCredential/
// credentialKeys)。无新建/编辑入口——配置变更 = 直接编辑该文件；空态文案
// 即配置指引（更多菜单 ink 随管理面一并撤除，行改纯只读）。
import { useSearchParams } from 'react-router';
import { useMcpServers } from '../api/hooks.js';
import { mapMcpServers } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { Network } from '../icons/index.js';
import { PageShell } from '../pages/shell.js';
import {
  EmptyState,
  RowAgo,
  RowCard,
  RowDesc,
  RowKind,
  RowLine,
  RowText,
  RowTitle,
  Tile,
} from './parts.js';

export const MCP_HREF = '/app/resources/mcp-servers';

export function McpServersPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  // M5 live：GET mcp-servers（spec 13 起 = 本地 config 投影，record 保形）。
  const { live, teamId } = useLiveData();
  const mcpQ = useMcpServers(teamId, live);
  const servers = live
    ? mapMcpServers(mcpQ.data ?? [], Date.now())
    : (fixture.resources?.mcpServers ?? []);

  return (
    <PageShell route={MCP_HREF} title={t('MCP 服务器')} selected={MCP_HREF} fixture={fixture}>
      {servers.length === 0 ? (
        <EmptyState
          Icon={Network}
          title="尚无 MCP 服务器。"
          description="读取 server 本机 ~/.claude.json 的 mcpServers 段：在该文件添加配置并刷新，即出现在这里。MCP 服务器为 Agent 提供额外工具；授权在每个 Agent 的页面上单独进行。"
        />
      ) : (
        servers.map((server) => (
          <RowCard mcp key={server.name}>
            <Tile Icon={Network} size="sm" tone="orange" />
            <RowText>
              <RowLine>
                <RowTitle>{server.name}</RowTitle>
                <RowKind>{t(server.kind)}</RowKind>
              </RowLine>
              <RowDesc>{server.url}</RowDesc>
            </RowText>
            <RowAgo>{t(server.ago)}</RowAgo>
          </RowCard>
        ))
      )}
    </PageShell>
  );
}
