export interface ApprovalField {
  label: string;
  value: string;
}

export type ApprovalKind = 'mail' | 'send' | 'install' | 'shell' | 'app' | 'secret' | 'other';

export interface ApprovalCardModel {
  kind: ApprovalKind;
  title: string;
  context: string | null;
  preview: string | null;
  mono: boolean;
  note: string | null;
  details: ApprovalField[];
}

interface ApprovalQuestion {
  header: string;
  question: string;
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const APPROVAL_REQUEST_PREFIX = 'approval-';
const GENERIC_HEADER = '审批';
const OUTBOUND_OPEN = '对外发送：';
const PARAMETER_LABEL = '参数';
const RECIPIENT_LABEL = '收件人';
const SUBJECT_LABEL = '主题';
const BODY_LABELS = ['正文', '内容'];
const SENDER_KEY = 'from';
const LABELLED_LINE = /^([^>：\n]{1,60})：(.*)$/;
const SHELL_SENTENCE = /^Coordinator 想在 (.+?) 上以你的身份运行这条命令：([\s\S]+)$/;
const UNSANDBOXED_SHELL_WITH_CWD_SENTENCE =
  /^Coordinator 想在 ([^\n：]+) 上不经沙箱运行这条命令\n目录：([^\n]+)\n命令：([\s\S]+)$/;
const UNSANDBOXED_SHELL_SENTENCE =
  /^Coordinator 想在 ([^\n：]+) 上不经沙箱运行这条命令：([\s\S]+)$/;
const APP_SENTENCE = /^Coordinator 想在 (.+?) 上读取和操作 ([\s\S]+?)。$/;
const LEAD_CLAUSE = /^([^：。\n]{1,40})：([\s\S]+)$/;
const CONTEXT_JOIN = ' · ';

export function isApprovalRequest(requestId: string): boolean {
  return requestId.startsWith(APPROVAL_REQUEST_PREFIX);
}

function unquote(line: string): string {
  return line.replace(/^> ?/, '');
}

function outboundCard(text: string, t: Translate): ApprovalCardModel {
  const noteAt = text.lastIndexOf('\n\n');
  const head = noteAt < 0 ? text : text.slice(0, noteAt);
  const note = noteAt < 0 ? null : text.slice(noteAt + 2).trim() || null;
  const [first = '', ...lines] = head.split('\n');
  const tool = first.slice(OUTBOUND_OPEN.length).trim();
  const fields: ApprovalField[] = [];
  const details: ApprovalField[] = [];
  let at = 0;
  const takeQuoted = (): string[] => {
    const taken: string[] = [];
    while (at < lines.length && (lines[at] ?? '').startsWith('>')) {
      taken.push(unquote(lines[at] ?? ''));
      at += 1;
    }
    return taken;
  };
  while (at < lines.length) {
    const line = lines[at] ?? '';
    at += 1;
    const labelled = LABELLED_LINE.exec(line);
    if (labelled === null) {
      if (line.trim() !== '') fields.push({ label: '', value: unquote(line) });
      continue;
    }
    const [, label = '', inline = ''] = labelled;
    if (label === PARAMETER_LABEL && inline === '') {
      const [entry = '', ...rest] = takeQuoted();
      const split = entry.indexOf('：');
      details.push({
        label: split < 0 ? entry : entry.slice(0, split),
        value: [split < 0 ? '' : entry.slice(split + 1), ...rest].join('\n'),
      });
      continue;
    }
    fields.push({ label, value: inline === '' ? takeQuoted().join('\n') : inline });
  }
  if (tool !== '') details.push({ label: t('连接器动作'), value: tool });
  const mail = /mail/i.test(tool) && /send/i.test(tool);
  const recipient = fields.find((field) => field.label === RECIPIENT_LABEL)?.value ?? null;
  const body = fields.find((field) => BODY_LABELS.includes(field.label)) ?? null;
  const sender = details.find((field) => field.label === SENDER_KEY)?.value ?? null;
  const context = [
    ...(sender === null ? [] : [t('从 {from} 发出', { from: sender })]),
    ...fields
      .filter((field) => field.label !== RECIPIENT_LABEL && field !== body)
      .map((field) =>
        field.label === SUBJECT_LABEL
          ? t('主题「{subject}」', { subject: field.value })
          : field.label === ''
            ? field.value
            : `${field.label} ${field.value}`,
      ),
  ];
  return {
    kind: mail ? 'mail' : 'send',
    title:
      recipient === null
        ? mail
          ? t('发送邮件')
          : t('对外发送')
        : mail
          ? t('发送邮件给 {to}', { to: recipient })
          : t('对外发送给 {to}', { to: recipient }),
    context: context.length === 0 ? null : context.join(CONTEXT_JOIN),
    preview: body?.value ?? null,
    mono: false,
    note,
    details,
  };
}

export function approvalCardOf(question: ApprovalQuestion, t: Translate): ApprovalCardModel {
  const text = question.question;
  if (text.startsWith(OUTBOUND_OPEN) && text.includes('\n')) return outboundCard(text, t);
  const unsandboxedWithCwd = UNSANDBOXED_SHELL_WITH_CWD_SENTENCE.exec(text);
  if (unsandboxedWithCwd !== null)
    return {
      kind: 'shell',
      title: t('在 {computer} 上不经沙箱运行一条命令', { computer: unsandboxedWithCwd[1] ?? '' }),
      context: t('目录：{cwd}', { cwd: unsandboxedWithCwd[2] ?? '' }),
      preview: (unsandboxedWithCwd[3] ?? '').trim(),
      mono: true,
      note: t('不经沙箱运行，仅对这一条命令生效'),
      details: [],
    };
  const unsandboxedShell = UNSANDBOXED_SHELL_SENTENCE.exec(text);
  if (unsandboxedShell !== null)
    return {
      kind: 'shell',
      title: t('在 {computer} 上不经沙箱运行一条命令', { computer: unsandboxedShell[1] ?? '' }),
      context: null,
      preview: (unsandboxedShell[2] ?? '').trim(),
      mono: true,
      note: t('不经沙箱运行，仅对这一条命令生效'),
      details: [],
    };
  const shell = SHELL_SENTENCE.exec(text);
  if (shell !== null)
    return {
      kind: 'shell',
      title: t('在 {computer} 上以你的身份运行一条命令', { computer: shell[1] ?? '' }),
      context: null,
      preview: (shell[2] ?? '').trim(),
      mono: true,
      note: t('以你的身份运行，能读写你的文件'),
      details: [],
    };
  const app = APP_SENTENCE.exec(text);
  if (app !== null)
    return {
      kind: 'app',
      title: t('在 {computer} 上读取和操作 {app}', {
        computer: app[1] ?? '',
        app: app[2] ?? '',
      }),
      context: null,
      preview: null,
      mono: false,
      note: t('以你的身份操作这个应用'),
      details: [],
    };
  const lead = LEAD_CLAUSE.exec(text);
  if (lead !== null)
    return {
      kind: 'other',
      title: lead[1] ?? '',
      context: (lead[2] ?? '').trim(),
      preview: null,
      mono: false,
      note: null,
      details: [],
    };
  const header = question.header.trim();
  return {
    kind: 'other',
    title: header === '' || header === GENERIC_HEADER ? t('需要你批准') : header,
    context: text,
    preview: null,
    mono: false,
    note: null,
    details: [],
  };
}

export function installCardOf(
  packages: readonly string[],
  t: Translate,
  list: (items: readonly string[]) => string,
): ApprovalCardModel {
  return {
    kind: 'install',
    title: t('在 Coordinator 的电脑上安装 {packages}', { packages: list(packages) }),
    context: t('批准后以 root 装进它的电脑，电脑更新或恢复后会自动重装。'),
    preview: packages.join('\n'),
    mono: true,
    note: t('以 root 安装'),
    details: [],
  };
}
