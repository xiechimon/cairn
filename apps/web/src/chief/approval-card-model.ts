export interface ApprovalField {
  label: string;
  value: string;
}

export type ApprovalKind = 'mail' | 'send' | 'shell' | 'app' | 'secret' | 'other';

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
const APPROVAL_CHOICE_LABELS: Record<string, string> = {
  批准执行: '批准执行',
  不执行: '不执行',
  以后都允许: '以后都允许',
  发送: '发送',
  不发: '不发',
};

export function approvalChoiceLabel(label: string, t: Translate): string {
  const key = APPROVAL_CHOICE_LABELS[label];
  return key === undefined ? label : t(key);
}
const GENERIC_HEADER = '审批';
const OUTBOUND_OPEN = '对外发送：';
const OUTBOUND_NOTE = '只会按上面的内容发出，发出后无法收回。';
const OUTBOUND_FIELD_TEMPLATES: Record<string, string> = {
  抄送: '抄送：{value}',
  密送: '密送：{value}',
  标题: '标题：{value}',
  网址: '网址：{value}',
  命令: '命令：{value}',
};
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
const DELETE_TODO_SENTENCE =
  /^删除 (\d+) 个任务：([\s\S]+?)。它们的构建、对话和定时会一起删除，无法恢复。$/;
const DELETE_PROJECT_SENTENCE =
  /^删除项目「([\s\S]+?)」：它的任务、构建、对话和定时会一起删除，正在运行的工作会被移除，删除后无法恢复。$/;
const EXTERNAL_SEND_SENTENCE = /^对外发送到「([\s\S]+?)」，发出后无法收回。$/;
const EXTERNAL_SUBMIT_SENTENCE = /^对外提交到「([\s\S]+?)」，发出后无法收回。$/;
const WEBSITE_SECRET_SENTENCE =
  /^允许在 (\S+) 代填机密 ([\s\S]+?)？仅限电脑 ([^；]+)；之后在这台电脑的同一网站自动可用，密码不会交给模型。换网站、电脑或密码后会重新询问。$/;
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
  const rawNote = noteAt < 0 ? null : text.slice(noteAt + 2).trim() || null;
  const note = rawNote === OUTBOUND_NOTE ? t('只会按上面的内容发出，发出后无法收回。') : rawNote;
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
      .map((field) => {
        if (field.label === SUBJECT_LABEL) return t('主题「{subject}」', { subject: field.value });
        if (field.label === '') return field.value;
        const template = OUTBOUND_FIELD_TEMPLATES[field.label];
        return template === undefined
          ? `${field.label} ${field.value}`
          : t(template, { value: field.value });
      }),
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
  const deleteTodos = DELETE_TODO_SENTENCE.exec(text);
  if (deleteTodos !== null)
    return {
      kind: 'other',
      title: t('删除 {count} 个任务', { count: Number(deleteTodos[1]) }),
      context: deleteTodos[2] ?? null,
      preview: null,
      mono: false,
      note: t('它们的构建、对话和定时会一起删除，无法恢复。'),
      details: [],
    };
  const deleteProject = DELETE_PROJECT_SENTENCE.exec(text);
  if (deleteProject !== null)
    return {
      kind: 'other',
      title: t('删除项目「{name}」', { name: deleteProject[1] ?? '' }),
      context: null,
      preview: null,
      mono: false,
      note: t('它的任务、构建、对话和定时会一起删除，正在运行的工作会被移除，删除后无法恢复。'),
      details: [],
    };
  const externalSend = EXTERNAL_SEND_SENTENCE.exec(text);
  if (externalSend !== null)
    return {
      kind: 'send',
      title: t('对外发送到「{target}」', { target: externalSend[1] ?? '' }),
      context: null,
      preview: null,
      mono: false,
      note: t('发出后无法收回。'),
      details: [],
    };
  const externalSubmit = EXTERNAL_SUBMIT_SENTENCE.exec(text);
  if (externalSubmit !== null)
    return {
      kind: 'send',
      title: t('对外提交到「{target}」', { target: externalSubmit[1] ?? '' }),
      context: null,
      preview: null,
      mono: false,
      note: t('发出后无法收回。'),
      details: [],
    };
  const websiteSecret = WEBSITE_SECRET_SENTENCE.exec(text);
  if (websiteSecret !== null)
    return {
      kind: 'secret',
      title: t('允许在 {origin} 代填 {name}', {
        origin: websiteSecret[1] ?? '',
        name: websiteSecret[2] ?? '',
      }),
      context: t('仅限电脑 {computer}', { computer: websiteSecret[3] ?? '' }),
      preview: null,
      mono: false,
      note: t(
        '之后在这台电脑的同一网站自动可用，密码不会交给模型。换网站、电脑或密码后会重新询问。',
      ),
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
