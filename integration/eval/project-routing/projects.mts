import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface RoutingProject {
  name: string;
  description: string;
  aliases: string[];
  seedDir: string;
}

export const DEFAULT_PROJECT_NAME = 'eval-project';

export const ROUTING_PROJECTS: readonly RoutingProject[] = [
  {
    name: DEFAULT_PROJECT_NAME,
    description: '团队内部的 Agent 编排服务：Hono 服务端、React 看板前端、执行守护进程',
    aliases: ['编排服务'],
    seedDir: join(HERE, '../chief-dispatch/repo-seed'),
  },
  {
    name: 'docs-site',
    description: 'Cairn 的产品官网与文档站（Astro 静态站点）',
    aliases: ['官网', '文档站'],
    seedDir: join(HERE, 'seeds/docs-site'),
  },
  {
    name: 'digest-bot',
    description: '每日信息雷达：抓 RSS 和 X 帖子，生成中文摘要推送到飞书（Python）',
    aliases: ['信息雷达'],
    seedDir: join(HERE, 'seeds/digest-bot'),
  },
  {
    name: 'bench',
    description:
      '公开基准评测：用 Harbor 在 SWE-bench / Terminal-Bench 上跑 Cairn 并出通过率报告（Python）',
    aliases: ['基准评测'],
    seedDir: join(HERE, 'seeds/bench'),
  },
];
