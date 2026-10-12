// 任务元信息块（#476，#473 决策候选 A + C 尾注）：右栏方案空态的 meta 面——
// agent 产出方案之前的整个执行期，文档槽没有内容职责，由任务元信息承接。
// 字段序（#473 决策记录）：来源 issue（标题 + 链接）→ 分支 / PR → 机器 →
// 模型 → 创建时间 → 尾注引导句；字段缺省整行不渲染、不占空行。
// 几何：顶对齐右栏 head 下 16px inset（与 pane body 顶部内衬等值），
// 行距 = 中列 chat-row 的 18px 律；不引入新滚动区（字段数有界）。
// 数据 live 面供数（fixture 面无来源/机器/模型数据源——SourceIssueLine
// 同律），fixture 空态维持居中「暂无方案」字节不变。

import type { ReactNode } from 'react';
import { relativeTime } from '../board/rel-time.js';
import { useI18n } from '../i18n/provider.js';

export interface TaskMetaFields {
  /** 来源 issue（sourceRef 反解成功才有值）：#N + 标题，链接去 GitHub。
   *  标题 = issue 侧真值（echo，ADR 0006 D5），拉不到退本地标题。 */
  sourceIssue: { number: number; title: string; url: string } | null;
  /** conv 分支名（conversationBranch(buildId) 派生）；无 build = null。 */
  branch: string | null;
  /** PR（build.prUrl/prNumber；托管 repo / 未创建 = null）。 */
  pr: { number: number; url: string } | null;
  /** 执行机器名（steps.machineId × machines 读面）；未派发但 build 钉了
   *  机器（#682）= 钉选机器名（步等待该机认领）。 */
  machine: string | null;
  /** 机器行等待标注（#682）：build 钉了机器、步未领、且该机离线 = true——
   *  机器行尾注「（等待机器上线）」。钉选语义 = 步只等它，不自动改派。 */
  machineWaiting: boolean;
  /** 模型 id（指派 agent 的 members actor.modelId，退 usage 首行 model）。 */
  model: string | null;
  /** 创建时间 = 首轮运行 createdAt（todo 表无创建列，buildHistory 首条目
   *  是最早可得时点）；无运行且 build 未在飞 = null。 */
  createdAt: number | null;
}

// #945（detail.css 清零）：meta 面皮肤迁 token utilities。行距 = 中列
// chat-row 的 18px 律——老 `.task-meta-row + .task-meta-row` 相邻选择器改由
// 渲染序派生（首行不挂 mt，其后逐行 mt-[18px]，与 DOM 相邻语义等价：行集
// 顺序渲染、中间无其它兄弟）。label 列定宽对齐；墨色比 dlg-token-row 安静
// 半档（label tertiary，value secondary——meta 是衬底信息，#476 决策记录）。
function Row({ label, first, children }: { label: string; first?: boolean; children: ReactNode }) {
  return (
    <div
      className={`flex items-baseline text-xs leading-[18px]${first === true ? '' : ' mt-[18px]'}`}
    >
      <span className="w-[68px] flex-none text-(--text-tertiary)">{label}</span>
      <span className="min-w-0 flex-1 text-(--text-secondary) [overflow-wrap:anywhere]">
        {children}
      </span>
    </div>
  );
}

export function TaskMetaBlock({ meta, now }: { meta: TaskMetaFields; now: number }) {
  const { t } = useI18n();
  // 行集按字段在场派生（字段缺省整行不渲染、不占空行），首行判定随之走
  // 渲染序——与老 CSS 的 `+` 相邻选择器同一效果。
  const rows: Array<{ label: string; content: ReactNode }> = [];
  if (meta.sourceIssue != null) {
    rows.push({
      label: t('来源 issue'),
      content: (
        <a
          className="text-(--chip-plan-fg) no-underline hover:underline"
          href={meta.sourceIssue.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          #{meta.sourceIssue.number} {meta.sourceIssue.title}
        </a>
      ),
    });
  }
  if (meta.branch != null || meta.pr != null) {
    rows.push({
      label: t('分支 / PR'),
      content: (
        <>
          {meta.branch != null && <code className="font-mono text-[11px]">{meta.branch}</code>}
          {meta.pr != null && (
            <a
              // 老 `.task-meta-code + .task-meta-link` 相邻律：branch code 在
              // 场时链接让 8px；无 branch 时链接行首无 margin。
              className={`text-(--chip-plan-fg) no-underline hover:underline${
                meta.branch != null ? ' ml-2' : ''
              }`}
              href={meta.pr.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              #{meta.pr.number}
            </a>
          )}
        </>
      ),
    });
  }
  if (meta.machine != null) {
    rows.push({
      label: t('机器'),
      content: (
        <>
          {meta.machine}
          {meta.machineWaiting && (
            <span className="text-(--text-tertiary)">{t('（等待机器上线）')}</span>
          )}
        </>
      ),
    });
  }
  if (meta.model != null) {
    rows.push({
      label: t('模型'),
      content: <code className="font-mono text-[11px]">{meta.model}</code>,
    });
  }
  if (meta.createdAt != null) {
    rows.push({ label: t('创建时间'), content: relativeTime(meta.createdAt, now, t) });
  }
  return (
    <div data-testid="task-meta">
      {rows.map((row, i) => (
        <Row key={row.label} label={row.label} first={i === 0}>
          {row.content}
        </Row>
      ))}
      <div className="mt-6 text-xs leading-4 text-(--text-tertiary)">{t('方案产出后显示于此')}</div>
    </div>
  );
}
