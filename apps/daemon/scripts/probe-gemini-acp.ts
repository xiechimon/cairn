import { createGeminiBackend } from '../src/backend/acp.js';

const backend = createGeminiBackend();
const opts = {
  provider: { kind: 'api_key' as const, providerId: 'gemini' },
  modelId: process.env.GEMINI_MODEL ?? 'gemini-2.5-pro',
  cwd: process.cwd(),
  readOnly: true,
  prompt:
    'Read package.json using your file-reading tool. Report only its package name. Do not modify files.',
};
let sessionId: string | undefined;
for (const turn of [1, 2]) {
  const handle = sessionId
    ? await backend.continueSession(sessionId, opts)
    : await backend.createSession(opts);
  sessionId = handle.sessionId;
  let messages = 0;
  let tools = 0;
  let completed = false;
  for await (const event of handle.events) {
    process.stdout.write(`${JSON.stringify({ turn, sessionId, event })}\n`);
    if (event.type === 'message_end') messages += 1;
    if (event.type === 'toolcall_end') tools += 1;
    if (event.type === 'done') completed = true;
    if (event.type === 'error') throw new Error(event.error.message);
  }
  if (messages !== 1 || tools === 0 || !completed) {
    throw new Error(
      `ACP probe failed: turn=${turn}, messages=${messages}, tools=${tools}, completed=${completed}`,
    );
  }
}
