import type { RemoteToolDef } from './chief-tools.js';
import { COMPUTER_REMOTE_TOOLS } from './computer-tools.js';

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
      'Run a shell command in your own Debian computer (not the owner Mac). Use it for downloads, scripts and data work. Work under your task folder.',
    parameters: {
      type: 'object',
      properties: {
        command: str('Shell command.'),
        cwd: str('Working directory; defaults to the computer home.'),
      },
      required: ['command'],
    },
  },
  {
    name: 'list_files',
    description: 'List a folder in your own computer.',
    parameters: { type: 'object', properties: { path: str('Folder path.') } },
    replaySafe: true,
  },
  {
    name: 'read_file',
    description: 'Read a text file in your own computer.',
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

export const INFO_CARD_TOOLS: readonly RemoteToolDef[] = [
  ...INFO_FILE_TOOLS,
  ...COMPUTER_REMOTE_TOOLS.map((def) => ({
    ...def,
    description: def.description.replaceAll('Coordinator computer', 'computer'),
  })),
  INFO_SUBMIT_REPORT_DEF,
];

export function infoCardBrief(conversationId: string, hasRepo: boolean): string {
  const dir = infoTaskDir(conversationId);
  return [
    '## 信息卡工作方式',
    `你在自己的电脑（一台 Debian 虚拟机）里工作，不是主人的 Mac。工作目录是 ${dir}/ ，所有文件放在这里。`,
    ...(hasRepo ? [`项目默认分支的只读快照在 ${dir}/${INFO_REPO_DIR}/ ，只读它，不要改。`] : []),
    `本步的交付物是一份 markdown 报告：把完整报告写成 ${dir}/report.md （报告长时分段写：每次几千字，第一段用 write_file 写入，后面每段用 write_file 加 append: true 追加，一次写太长会被截断），然后调用 \`${INFO_SUBMIT_REPORT_TOOL}\` 工具并传入该路径。报告不超过 512 KiB。工具报错时按原因修正后再交。没有成功交出报告就结束，本步会失败。`,
    `可选：本步如果做出了网页或 PPT，在调用 ${INFO_SUBMIT_REPORT_TOOL} 之前，把网页（.html）放进 ${dir}/deliverables/pages/ ，把 PPT（.pptx 或 .pdf）放进 ${dir}/deliverables/slides/ ；文件直接放在这两个文件夹里，不要再分子文件夹，最多 5 个文件，网页每个不超过 2 MiB，PPT 每个不超过 20 MiB。`,
    '任务的输入在任务正文里：主人的原话，加上「Coordinator briefing」里它已经查到的链接、名称和结果。任务文件夹一开始是空的是正常的；先读正文，别因为文件夹空就说没有输入。正文确实没给你要的东西时，用提问工具问主人，不要猜。',
    '网页用 browser_navigate / browser_snapshot / browser_act。主人登录过的网站（招聘站、社交平台、各类后台，例如 zhipin.com）的登录状态在隐身浏览器里，不在默认浏览器里：打开这类网站时在 browser_navigate、browser_snapshot、browser_act 上都传 stealth: true，同一个页面上保持同样的值；默认浏览器里看到未登录，不代表主人没登录。网站拦下自动操作时也改用 stealth: true。需要主人登录、验证码时用 request_takeover。',
  ].join('\n');
}
