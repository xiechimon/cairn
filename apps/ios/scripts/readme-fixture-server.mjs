import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const TEAM = 'readme-team';
const CHIEF = 'readme-chief';
const SHOP = 'readme-shop';
const AFFAIRS = 'readme-affairs';

const COPY = {
  en: {
    shop: 'Storefront',
    affairs: 'My affairs',
    askExport: 'Exporting orders takes 40 seconds on big stores. Make it fast.',
    replyExport:
      'Opened a thread on studio-linux. It read how three open-source shops export large tables and picked streaming.',
    exportTitle: 'Stream the order export',
    askMail: 'Draft a reply to the Acme interview invite. Tuesday afternoon works for me.',
    replyMail: 'The draft is ready in the thread. Nothing is sent until you say so.',
    mailTitle: 'Reply to the Acme interview invite',
    header: 'Export limit',
    question: 'Streaming removes the need for the 50,000-row cap. Drop it?',
    options: ['Drop the cap', 'Keep 50,000 rows', 'Decide later'],
    notes: ['Medusa and Saleor both stream without a cap', 'Safer for slow disks'],
    darkTitle: 'Dark mode for the settings page',
    searchTitle: 'Search in order history',
    briefTitle: 'Weekly calendar brief',
    plan: 'Replace the in-memory CSV build with a streamed response; keep the column order.',
    report:
      'The order export now streams rows as it reads them. A 120,000-order store exports in 3.1 s instead of 41 s, and memory stays under 60 MB.',
  },
  zh: {
    shop: '网店',
    affairs: '我的事',
    askExport: '大店铺导出订单要 40 秒，弄快一点。',
    replyExport:
      '在 studio-linux 上开了一个 thread。它看了三个开源网店怎么导出大表，选了流式导出。',
    exportTitle: '订单导出改成流式',
    askMail: '帮我起草一封回复 Acme 面试邀请的邮件，周二下午我有空。',
    replyMail: '草稿在 thread 里，你说发才会发。',
    mailTitle: '回复 Acme 的面试邀请',
    header: '导出上限',
    question: '改成流式以后，5 万行的上限就没必要了。要去掉吗？',
    options: ['去掉上限', '保留 5 万行', '以后再说'],
    notes: ['Medusa 和 Saleor 都是流式导出、不设上限', '磁盘慢时更稳妥'],
    darkTitle: '设置页加暗色模式',
    searchTitle: '订单历史支持搜索',
    briefTitle: '每周日程简报',
    plan: '把一次性在内存里拼 CSV 改成边读边写的流式响应，列顺序不变。',
    report: '订单导出改成了边读边写。12 万单的店铺导出从 41 秒降到 3.1 秒，内存一直在 60 MB 以下。',
  },
};

let started = Date.now();
const ago = (minutes) => started - minutes * 60_000;

function toolCall(id, todoId, seqNum, title, projectId, minutes) {
  return {
    id,
    role: 'assistant',
    createdAt: ago(minutes),
    content: {
      kind: 'toolcall',
      call: {
        id: `call-${id}`,
        name: 'create_todo',
        arguments: { projectId, title },
        result: [{ type: 'text', text: JSON.stringify({ id: todoId, seqNum, title }) }],
        startedAt: ago(minutes),
        endedAt: ago(minutes),
      },
    },
  };
}

function world(lang) {
  const c = COPY[lang];
  const options = c.options.map((label, index) => ({
    label,
    ...(c.notes[index] ? { description: c.notes[index] } : {}),
    ...(index === 0 ? { recommended: true } : {}),
  }));
  const todo = (id, seqNum, title, phase, projectId, minutes) => ({
    id,
    seqNum,
    title,
    spec: title,
    phase,
    phaseAt: ago(minutes),
    projectId,
    latestBuildId: phase === 'todo' ? null : `build-${id}`,
    archivedAt: null,
  });
  return {
    question: {
      id: 'readme-question',
      role: 'assistant',
      createdAt: ago(1),
      content: {
        kind: 'ask_user_question',
        requestId: 'readme-q1',
        status: 'pending',
        questions: [{ header: c.header, question: c.question, options }],
        answers: null,
      },
    },
    chief: [
      { id: 'readme-ask-export', role: 'user', createdAt: ago(51), content: c.askExport },
      toolCall('readme-call-export', 'readme-export', 214, c.exportTitle, SHOP, 50),
      { id: 'readme-reply-export', role: 'assistant', createdAt: ago(50), content: c.replyExport },
      { id: 'readme-ask-mail', role: 'user', createdAt: ago(31), content: c.askMail },
      toolCall('readme-call-mail', 'readme-mail', 31, c.mailTitle, AFFAIRS, 29),
      { id: 'readme-reply-mail', role: 'assistant', createdAt: ago(29), content: c.replyMail },
    ],
    builds: {
      'build-readme-export': [
        { id: 'e1', role: 'user', createdAt: ago(50), content: c.askExport },
        { id: 'e2', role: 'assistant', createdAt: ago(48), content: c.plan },
        { id: 'e3', role: 'assistant', createdAt: ago(2), content: c.report },
      ],
    },
    todos: [
      todo('readme-export', 214, c.exportTitle, 'review', SHOP, 2),
      todo('readme-mail', 31, c.mailTitle, 'needs_input', AFFAIRS, 29),
      todo('readme-dark', 215, c.darkTitle, 'building', SHOP, 12),
      todo('readme-search', 216, c.searchTitle, 'todo', SHOP, 40),
      todo('readme-brief', 30, c.briefTitle, 'done', AFFAIRS, 300),
    ],
    projects: [
      { id: SHOP, name: c.shop },
      { id: AFFAIRS, name: c.affairs },
    ],
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => resolve(raw === '' ? {} : JSON.parse(raw)));
  });
}

function messagesOf(w, id) {
  if (id === CHIEF) return [...w.chief, w.question];
  return w.builds[id] ?? [];
}

export function serveReadmeFixture(port) {
  started = Date.now();
  const worlds = { 'readme-en': world('en'), 'readme-zh': world('zh') };
  const streams = new Set();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture');
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const w = worlds[token];
    if (w === undefined) return send(res, 401, { error: 'unauthorized' });
    const path = url.pathname;
    if (req.method === 'GET' && path === '/api/teams')
      return send(res, 200, [{ id: TEAM, name: 'Cairn' }]);
    if (req.method === 'GET' && path === `/api/teams/${TEAM}/chief/threads`)
      return send(res, 200, [
        { id: CHIEF, title: 'Coordinator', updatedAt: ago(1), lastTurnAt: ago(1) },
      ]);
    if (req.method === 'GET' && path === '/api/todos') return send(res, 200, w.todos);
    if (req.method === 'GET' && path === `/api/teams/${TEAM}/machines`)
      return send(res, 200, [
        { id: 'readme-studio', name: 'studio-linux', online: true, runningSteps: 1 },
        { id: 'readme-laptop', name: 'MacBook Air', online: true, runningSteps: 0 },
      ]);
    if (req.method === 'GET' && path === '/api/projects') return send(res, 200, w.projects);
    const stream = path.match(/^\/api\/conversations\/([^/]+)\/stream$/);
    if (req.method === 'GET' && stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(': open\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    const messages = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (messages && req.method === 'GET')
      return send(res, 200, {
        messages: messagesOf(w, messages[1]),
        activeRun: null,
        nextCursor: null,
      });
    if (messages && req.method === 'POST') {
      const body = await readBody(req);
      w.chief.push({
        id: `user-${Date.now()}`,
        role: 'user',
        createdAt: Date.now(),
        content: body.content,
      });
      return send(res, 201, {
        thread: { id: CHIEF, title: 'Coordinator', updatedAt: Date.now(), lastTurnAt: null },
      });
    }
    if (
      req.method === 'POST' &&
      path === `/api/teams/${TEAM}/chief/threads/${CHIEF}/questions/readme-q1/answer`
    ) {
      const body = await readBody(req);
      w.question.content = { ...w.question.content, status: 'answered', answers: body.answers };
      for (const client of streams)
        client.write(`data: ${JSON.stringify({ type: 'message' })}\n\n`);
      return send(res, 200, {});
    }
    const taskMessage = path.match(/^\/api\/todos\/([^/]+)\/messages$/);
    if (req.method === 'POST' && taskMessage)
      return send(res, 201, {
        todoId: taskMessage[1],
        conversationId: `build-${taskMessage[1]}`,
        delivered: 'steer',
      });
    return send(res, 404, { error: `no fixture for ${req.method} ${path}` });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 8791);
  await serveReadmeFixture(port);
  process.stdout.write(`readme fixture server on http://127.0.0.1:${port}\n`);
}
