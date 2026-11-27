import type { RemoteToolDef } from './chief-tools.js';
import { COMPUTER_REMOTE_TOOLS, SHELL_TOOL_PARAMETERS } from './computer-tools.js';

export const INFO_SUBMIT_REPORT_TOOL = 'submit_report';
export const INFO_TASK_ROOT = '/home/agent/tasks';
export const INFO_REPO_DIR = 'repo';

export const INFO_CARD_COMPUTER_TOOL_NAMES = [
  'shell',
  'list_files',
  'read_file',
  'write_file',
] as const;

export function isInfoCardComputerTool(name: string): boolean {
  return (INFO_CARD_COMPUTER_TOOL_NAMES as readonly string[]).includes(name);
}

export function infoTaskDir(conversationId: string): string {
  return `${INFO_TASK_ROOT}/${conversationId}`;
}

const str = (description: string) => ({ type: 'string', description });

const INFO_FILE_TOOLS: readonly RemoteToolDef[] = [
  {
    name: 'shell',
    description:
      'Run a shell command in the assigned task directory. Use it for downloads, scripts and data work. Work under your task folder.',
    parameters: SHELL_TOOL_PARAMETERS,
  },
  {
    name: 'list_files',
    description: 'List a folder in your own computer.',
    parameters: { type: 'object', properties: { path: str('Folder path.') } },
    replaySafe: true,
  },
  {
    name: 'read_file',
    description: 'Read a text or image file in your own computer.',
    parameters: { type: 'object', properties: { path: str('File path.') }, required: ['path'] },
    replaySafe: true,
  },
  {
    name: 'write_file',
    description:
      'Write a text file in your own computer, replacing it when it exists. Set append to true to add content to the end of the file instead (up to 48000 characters per call); write long files in parts of a few thousand characters: the first part without append, every later part with append true.',
    parameters: {
      type: 'object',
      properties: {
        path: str('File path.'),
        content: str('File content, or the next part when append is true.'),
        append: {
          type: 'boolean',
          description: 'Append to the end of the file instead of replacing it.',
        },
      },
      required: ['path', 'content'],
    },
  },
];

export const INFO_SUBMIT_REPORT_DEF: RemoteToolDef = {
  name: INFO_SUBMIT_REPORT_TOOL,
  description:
    'Hand in your finished report. Write the full report as a markdown file in your task folder first, then call this with its path. The call fails with the reason when the file is missing, empty or too large; fix it and call again. Ending without an accepted report fails the task.',
  parameters: {
    type: 'object',
    properties: { path: str('Path of the report file in your computer.') },
    required: ['path'],
  },
};

export const INFO_HOST_SUBMIT_REPORT_DEF: RemoteToolDef = {
  name: INFO_SUBMIT_REPORT_TOOL,
  description:
    'Hand in your finished Markdown report directly in content (up to 512 KiB). The call fails with the reason when content is empty or too large; fix it and call again. Ending without an accepted report fails the task.',
  parameters: {
    type: 'object',
    properties: { content: str('The complete Markdown report text (up to 512 KiB).') },
    required: ['content'],
  },
};

export const INFO_CARD_TOOLS: readonly RemoteToolDef[] = [
  ...INFO_FILE_TOOLS,
  ...COMPUTER_REMOTE_TOOLS.map((def) => ({
    ...def,
    description: def.description.replaceAll('Coordinator computer', 'computer'),
  })),
  INFO_SUBMIT_REPORT_DEF,
];

export function infoCardHostBrief(hasRepo: boolean): string {
  return [
    '## 信息卡工作方式',
    '当前 Runner 没有 Linux 电脑容器，请直接使用你自带的工作区、Shell 与文件工具完成调研与整理。若任务要求只读，只读取所需文件，不要修改仓库或提交代码。',
    ...(hasRepo
      ? ['本项目已提供代码仓库只读上下文，请直接查看默认分支或当前工作区中的代码，不要改动源码。']
      : []),
    `本步的交付物是一份 markdown 报告：完成调研后，直接调用 \`${INFO_SUBMIT_REPORT_TOOL}\` 工具，在 \`content\` 参数中传入完整报告正文（不超过 512 KiB）。工具报错时按原因修正后再交；没有成功交出报告就结束，本步会失败。`,
    '真实验收（提交前必做）：调用 submit_report 前，先亲自逐段通读并核对传入 `content` 的完整 Markdown 报告正文（以及有文件/命令工具时生成或导出的交付产物，如报告文件、导出图表或数据结果等），确认内容完整无截断、无占位符、结论与已读出处一致后再提交；确实无法核实的外部/付费来源允许在报告中明确标为缺口，切勿对未读未查的报告或交付物直接交差。',
    '报告只写主人要的内容：发现、来源、没查到的缺口。和这次运行本身有关的事（更正上一轮的结论、核对上一轮、记忆更新、归档或停掉别的任务、重试经过）一律写进你最后的回复，不要写进报告。任务正文里若有这类安排，照做，但只在最后的回复里说明。',
    '任务的输入在任务正文里：主人的原话，加上「Coordinator briefing」里它已经查到的链接、名称和结果。先读正文，正文确实没给你要的东西、或关键工具/环境阻断了产物生成与交付物核对时，调用 `ask_user` 问主人，不要猜，也不要交出未验收的空结果。',
  ].join('\n');
}

export function infoCardBrief(conversationId: string, hasRepo: boolean, relayOnly = true): string {
  const dir = infoTaskDir(conversationId);
  return [
    '## 信息卡工作方式',
    ...(relayOnly
      ? [`你的任务工作目录是 ${dir}/ ，所有文件放在这里。`]
      : [
          `你有两套工具。你自带的工具（读写文件、执行命令）只用来读写本地草稿，不要碰任务目录以外的东西。名为 shell、list_files、read_file、write_file、browser_*、${INFO_SUBMIT_REPORT_TOOL} 的 Cairn 工具作用在任务的运行目录里。报告、网页和 PPT 必须用 Cairn 的 write_file 写进 ${dir}/ ，不能写在你自带工具的目录里，否则交不出去。`,
        ]),
    ...(hasRepo ? [`项目默认分支的只读快照在 ${dir}/${INFO_REPO_DIR}/ ，只读它，不要改。`] : []),
    `本步的交付物是一份 markdown 报告：把完整报告写成 ${dir}/report.md （报告长时分段写：每次几千字，第一段用 write_file 写入，后面每段用 write_file 加 append: true 追加，一次写太长会被截断），然后调用 \`${INFO_SUBMIT_REPORT_TOOL}\` 工具并传入该路径。报告不超过 512 KiB。工具报错时按原因修正后再交。没有成功交出报告就结束，本步会失败。`,
    '报告只写主人要的内容：发现、来源、没查到的缺口。和这次运行本身有关的事（更正上一轮的结论、核对上一轮、记忆更新、归档或停掉别的任务、重试经过）一律写进你最后的回复，不要写进报告。任务正文里若有这类安排，照做，但只在最后的回复里说明。',
    '真实验收（提交前必做）：先用 read_file 或 shell 命令亲自打开并核对你生成或导出的交付产物（report.md、导出的页面/PPT/图片/数据文件），确认内容完整无截断、无占位符、结论与已读出处一致后再调用 submit_report；确实无法核实的外部/付费来源在报告中如实列为缺口即可，切勿对已产出的交付物未打开核对就交差。',
    `可选：本步如果做出了网页、PPT 或导出图片，在调用 ${INFO_SUBMIT_REPORT_TOOL} 之前，把网页（.html）放进 ${dir}/deliverables/pages/ ，把 PPT（.pptx 或 .pdf）放进 ${dir}/deliverables/slides/ ，把图片或截图（.png、.jpg、.jpeg、.gif、.webp）放进 ${dir}/deliverables/images/ ；文件直接放在这些文件夹里，不要再分子文件夹，最多 5 个文件，网页每个不超过 2 MiB，图片每个不超过 10 MiB，PPT 每个不超过 20 MiB。生成了图片或视觉成图时，调用 ${INFO_SUBMIT_REPORT_TOOL} 之前先用 read_file 读取成图亲自目视检查排版与清晰度，确认无误再提交。`,
    '任务的输入在任务正文里：主人的原话，加上「Coordinator briefing」里它已经查到的链接、名称和结果。任务文件夹一开始是空的是正常的；先读正文，别因为文件夹空就说没有输入。正文确实没给你要的东西、或关键工具/环境阻断了产物生成与交付物核对时，调用 `ask_user` 问主人，不要猜，也不要交出未验收的空结果。',
    '网页用 browser_navigate / browser_snapshot / browser_act。主人登录过的网站（招聘站、社交平台、各类后台，例如 zhipin.com）的登录状态在隐身浏览器里，不在默认浏览器里：打开这类网站时在 browser_navigate、browser_snapshot、browser_act 上都传 stealth: true，同一个页面上保持同样的值；默认浏览器里看到未登录，不代表主人没登录。网站拦下自动操作时也改用 stealth: true。需要主人登录、验证码时用 request_takeover。',
  ].join('\n');
}
