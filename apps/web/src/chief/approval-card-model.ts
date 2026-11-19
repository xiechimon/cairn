export interface ApprovalField {
  label: string;
  value: string;
  mono?: boolean;
}

export interface ApprovalCardModel {
  title: string;
  summary: string | null;
  fields: ApprovalField[];
  details: ApprovalField[];
  note: string | null;
}

interface ApprovalQuestion {
  header: string;
  question: string;
}

type Translate = (key: string) => string;

const APPROVAL_REQUEST_PREFIX = 'approval-';
const GENERIC_HEADER = '审批';
const OUTBOUND_OPEN = '对外发送：';
const PARAMETER_LABEL = '参数';
const LABELLED_LINE = /^([^>：\n]{1,60})：(.*)$/;
const SHELL_SENTENCE = /^Coordinator 想在 (.+?) 上以你的身份运行这条命令：([\s\S]+)$/;
const APP_SENTENCE = /^Coordinator 想在 (.+?) 上读取和操作 ([\s\S]+?)。$/;

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
  if (tool !== '') details.push({ label: t('连接器动作'), value: tool, mono: true });
  const mail = /mail/i.test(tool) && /send/i.test(tool);
  return {
    title: mail ? t('发送邮件') : t('对外发送'),
    summary: null,
    fields,
    details,
    note,
  };
}

export function approvalCardOf(question: ApprovalQuestion, t: Translate): ApprovalCardModel {
  const text = question.question;
  if (text.startsWith(OUTBOUND_OPEN) && text.includes('\n')) return outboundCard(text, t);
  const header = question.header.trim();
  const title = header === '' || header === GENERIC_HEADER ? t('需要你批准') : header;
  const shell = SHELL_SENTENCE.exec(text);
  if (shell !== null)
    return {
      title,
      summary: null,
      fields: [
        { label: t('所在电脑'), value: shell[1] ?? '' },
        { label: t('要运行的命令'), value: (shell[2] ?? '').trim(), mono: true },
      ],
      details: [],
      note: null,
    };
  const app = APP_SENTENCE.exec(text);
  if (app !== null)
    return {
      title,
      summary: null,
      fields: [
        { label: t('所在电脑'), value: app[1] ?? '' },
        { label: t('要操作的应用'), value: app[2] ?? '' },
      ],
      details: [],
      note: null,
    };
  return { title, summary: text, fields: [], details: [], note: null };
}
