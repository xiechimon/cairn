import type { BuildRecord, TodoRecord } from '@cairn/shared';

export interface HarborTask {
  todoId: string;
  buildId: string;
}

export class HarborSubmission {
  readonly created: Partial<HarborTask> = {};
  readonly outcomes: { method: string; route: string; status: number }[] = [];
  private readonly base: string;
  readonly #serverToken: string;
  readonly #machineToken: string;
  private readonly projectId: string;
  private readonly teamId: string;
  private readonly machineId: string;
  private readonly agentId: string;
  private readonly fetcher: typeof fetch;

  constructor(env: NodeJS.ProcessEnv, fetcher: typeof fetch = fetch) {
    const required = (name: string): string => {
      const value = env[name]?.trim();
      if (!value) throw new Error(`${name} is required`);
      return value;
    };
    this.#serverToken = required('CAIRN_SERVER_TOKEN');
    this.#machineToken = required('CAIRN_MACHINE_TOKEN');
    this.projectId = required('CAIRN_PROJECT_ID');
    this.teamId = required('CAIRN_TEAM_ID');
    this.machineId = required('CAIRN_MACHINE_ID');
    this.agentId = required('CAIRN_AGENT_ID');
    const url = new URL(required('CAIRN_SERVER_URL'));
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error('CAIRN_SERVER_URL must be an HTTP origin without credentials');
    }
    if (url.pathname !== '/') throw new Error('CAIRN_SERVER_URL must be an HTTP origin');
    this.base = url.origin;
    this.fetcher = fetcher;
  }

  private async request<T>(route: string, body?: unknown, machineAuth = false): Promise<T> {
    const method = body === undefined ? 'GET' : 'POST';
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${route}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${machineAuth ? this.#machineToken : this.#serverToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error(`Harbor ${method} request failed`);
    }
    this.outcomes.push({ method, route, status: response.status });
    if (!response.ok) throw new Error(`Harbor ${method}: HTTP ${response.status}`);
    try {
      return (await response.json()) as T;
    } catch {
      throw new Error('Harbor response is not JSON');
    }
  }

  async submit(instruction: string): Promise<HarborTask> {
    const machine = await this.request<{ id: string; teamId: string }>(
      '/api/machine/me',
      undefined,
      true,
    );
    if (machine.id !== this.machineId || machine.teamId !== this.teamId) {
      throw new Error('Configured machine identity does not match its credential');
    }
    const projects = await this.request<{ id: string; teamId: string }[]>(
      `/api/projects?teamId=${encodeURIComponent(this.teamId)}`,
    );
    if (
      !projects.some((project) => project.id === this.projectId && project.teamId === this.teamId)
    ) {
      throw new Error('CAIRN_PROJECT_ID must identify a project in the authenticated machine team');
    }
    const route = `/api/projects/${encodeURIComponent(this.projectId)}`;
    const todo = await this.request<TodoRecord>(`${route}/todos`, {
      title: 'Harbor evaluation task',
      spec: instruction,
    });
    this.created.todoId = todo.id;
    const result = await this.request<{ builds: BuildRecord[] }>(`${route}/builds`, {
      todoIds: [todo.id],
      assignment: { plan: null, build: { agentId: this.agentId }, review: null, verify: null },
      withPlan: false,
    });
    const build = result.builds[0];
    if (!build) throw new Error('Harbor submission returned no build');
    this.created.buildId = build.id;
    return { todoId: todo.id, buildId: build.id };
  }

  async poll(task: HarborTask, options: { timeoutMs?: number; intervalMs?: number } = {}) {
    const timeoutMs = options.timeoutMs ?? 25 * 60 * 1000;
    const intervalMs = options.intervalMs ?? 5000;
    if (
      !Number.isFinite(timeoutMs) ||
      timeoutMs < 0 ||
      !Number.isFinite(intervalMs) ||
      intervalMs <= 0
    ) {
      throw new Error('Invalid Harbor polling timing');
    }
    const deadline = Date.now() + timeoutMs;
    const terminal = new Set(['done', 'review', 'failed', 'closed']);
    let todo: TodoRecord;
    for (;;) {
      todo = await this.request<TodoRecord>(`/api/todos/${encodeURIComponent(task.todoId)}`);
      if (terminal.has(todo.phase) || Date.now() >= deadline) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))),
      );
    }
    const build = await this.request<BuildRecord>(
      `/api/builds/${encodeURIComponent(task.buildId)}`,
    );
    const messages = await this.request<{ messages: unknown[] }>(
      `/api/conversations/${encodeURIComponent(task.buildId)}/messages`,
    );
    const result = { todo, build, messages, timedOut: !terminal.has(todo.phase) };
    let serialized = JSON.stringify(result);
    for (const token of [this.#serverToken, this.#machineToken]) {
      serialized = serialized.split(JSON.stringify(token).slice(1, -1)).join('[REDACTED]');
    }
    return JSON.parse(serialized) as typeof result;
  }
}
