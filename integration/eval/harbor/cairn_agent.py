import shlex
from pathlib import Path, PurePosixPath
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class CairnAgent(BaseInstalledAgent):
    capabilities = BaseInstalledAgent.capabilities.model_copy(update={"atif": False})
    _REMOTE_HOME = PurePosixPath("/tmp/cairn-agent-home")
    _CLI_TGZ = PurePosixPath("/tmp/cairn-cli.tgz")
    _REQUEST_SCRIPT = PurePosixPath("/tmp/cairn-harbor-request.mjs")
    _OUTPUT_FILENAME = "cairn.log"
    _NODE_MAJOR = 22
    _NODE_PATH_PREFIX = (
        'nvm_node_bin="$(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin 2>/dev/null | sort -V | tail -n 1 || true)"; '
        'if [ -n "$nvm_node_bin" ]; then PATH="$nvm_node_bin:$PATH"; export PATH; fi; '
    )

    @staticmethod
    @override
    def name() -> str:
        return "cairn"

    @property
    @override
    def remote_session_logs_dir(self) -> PurePosixPath:
        return self._REMOTE_HOME

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        cli_tgz = (self._get_env("CAIRN_CLI_TGZ") or "").strip()
        if not cli_tgz:
            raise ValueError("CAIRN_CLI_TGZ is required")
        if not (self._get_env("CAIRN_SERVER_URL") or "").strip():
            raise ValueError("CAIRN_SERVER_URL is required")
        if not (self._get_env("CAIRN_MACHINE_TOKEN") or "").strip():
            raise ValueError("CAIRN_MACHINE_TOKEN is required")
        await self.ensure_system_dependencies(environment, ("curl", "bash", "ca_certificates"))
        await environment.upload_file(Path(cli_tgz), self._CLI_TGZ.as_posix())
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                f"{nvm_node_install_snippet(self._NODE_MAJOR)} && "
                'npm install -g "$CAIRN_CLI_TGZ" && '
                "cairn --version"
            ),
            env={
                "CAIRN_CLI_TGZ": self._CLI_TGZ.as_posix(),
                "CAIRN_SERVER_URL": self._get_env("CAIRN_SERVER_URL") or "",
                "CAIRN_MACHINE_TOKEN": self._get_env("CAIRN_MACHINE_TOKEN") or "",
            },
        )

    @override
    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        server_url = (self._get_env("CAIRN_SERVER_URL") or "").strip()
        machine_token = (self._get_env("CAIRN_MACHINE_TOKEN") or "").strip()
        agent_id = (self._get_env("CAIRN_AGENT_ID") or "").strip()
        machine_id = (self._get_env("CAIRN_MACHINE_ID") or "").strip()
        team_id = (self._get_env("CAIRN_TEAM_ID") or "").strip()
        if not server_url:
            raise ValueError("CAIRN_SERVER_URL is required")
        if not machine_token:
            raise ValueError("CAIRN_MACHINE_TOKEN is required")
        if not agent_id:
            raise ValueError("CAIRN_AGENT_ID is required")
        if not machine_id:
            raise ValueError("CAIRN_MACHINE_ID is required")
        if not team_id:
            raise ValueError("CAIRN_TEAM_ID is required")

        remote_home = shlex.quote(self._REMOTE_HOME.as_posix())
        output_dir = shlex.quote(self.environment_logs_dir.as_posix())
        instruction_path = shlex.quote((self._REMOTE_HOME / "instruction.txt").as_posix())
        pid_path = shlex.quote((self._REMOTE_HOME / "cairn.pid").as_posix())
        daemon_log = shlex.quote((self._REMOTE_HOME / self._OUTPUT_FILENAME).as_posix())
        instruction_value = shlex.quote(instruction)
        request_script = r'''import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CAIRN_SERVER_URL.replace(/\/$/, "");
const token = process.env.CAIRN_MACHINE_TOKEN;
const agentId = process.env.CAIRN_AGENT_ID;
const instructionPath = process.env.CAIRN_INSTRUCTION_PATH;
const taskPath = process.env.CAIRN_TASK_PATH;
const resultPath = process.env.CAIRN_RESULT_PATH;
const mode = process.argv[2];
const auth = { authorization: `Bearer ${token}` };
const terminalPhases = ["done", "review", "failed", "closed"];
async function request(route, init = {}) {
  const response = await fetch(`${base}${route}`, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${route}: ${response.status} ${text}`);
  return text === "" ? null : JSON.parse(text);
}
async function json(route, method, body, headers = {}) {
  return request(route, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
if (mode === "create") {
  const credentialPath = path.join(process.env.CAIRN_HOME, "machine.json");
  await fs.writeFile(credentialPath, `${JSON.stringify({
    machineId: process.env.CAIRN_MACHINE_ID,
    token,
    teamId: process.env.CAIRN_TEAM_ID,
    serverUrl: base
  }, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(credentialPath, 0o600);
  const machine = await request("/api/machine/me", { headers: auth });
  const projectId = process.env.CAIRN_PROJECT_ID || (await request(`/api/projects?teamId=${encodeURIComponent(machine.teamId)}`))[0]?.id;
  if (!projectId) throw new Error("CAIRN_PROJECT_ID is required when the team has no project");
  const instruction = await fs.readFile(instructionPath, "utf8");
  const todo = await json(`/api/projects/${projectId}/todos`, "POST", { title: "Harbor evaluation task", spec: instruction });
  const builds = await json(`/api/projects/${projectId}/builds`, "POST", { todoIds: [todo.id], assignment: { plan: null, build: { agentId }, review: null, verify: null }, withPlan: false });
  const task = { todoId: todo.id, buildId: builds.builds[0].id };
  await fs.writeFile(taskPath, JSON.stringify(task));
  const taskWorkdir = process.env.CAIRN_TASK_WORKDIR || "/app";
  await fs.mkdir(taskWorkdir, { recursive: true });
  await fs.mkdir(process.env.CAIRN_WORKSPACES_DIR, { recursive: true });
  await fs.symlink(taskWorkdir, path.join(process.env.CAIRN_WORKSPACES_DIR, task.buildId), "dir");
} else if (mode === "poll") {
  const task = JSON.parse(await fs.readFile(taskPath, "utf8"));
  const deadline = Date.now() + 25 * 60 * 1000;
  let todo;
  while (Date.now() < deadline) {
    todo = await request(`/api/todos/${task.todoId}`);
    if (terminalPhases.includes(todo.phase)) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  const build = await request(`/api/builds/${task.buildId}`);
  const messages = await request(`/api/conversations/${task.buildId}/messages`);
  await fs.writeFile(resultPath, JSON.stringify({ todo, build, messages, timedOut: Date.now() >= deadline && !terminalPhases.includes(todo?.phase) }, null, 2));
  if (!["done", "review"].includes(todo?.phase)) process.exitCode = 1;
} else {
  throw new Error("mode must be create or poll");
}
'''
        script_path = shlex.quote(self._REQUEST_SCRIPT.as_posix())
        await self.exec_as_agent(
            environment,
            command=f"cat > {script_path} <<'NODE'\n{request_script}NODE",
        )
        common_env = {
            "CAIRN_SERVER_URL": server_url,
            "CAIRN_MACHINE_TOKEN": machine_token,
            "CAIRN_AGENT_ID": agent_id,
            "CAIRN_MACHINE_ID": machine_id,
            "CAIRN_TEAM_ID": team_id,
            "CAIRN_HOME": self._REMOTE_HOME.as_posix(),
            "CAIRN_WORKSPACES_DIR": (self._get_env("CAIRN_WORKSPACES_DIR") or (self._REMOTE_HOME / "workspaces").as_posix()),
            "CAIRN_TASK_WORKDIR": (self._get_env("CAIRN_TASK_WORKDIR") or "/app"),
            "CAIRN_INSTRUCTION_PATH": (self._REMOTE_HOME / "instruction.txt").as_posix(),
            "CAIRN_TASK_PATH": (self._REMOTE_HOME / "task.json").as_posix(),
            "CAIRN_RESULT_PATH": (self.environment_logs_dir / "result.json").as_posix(),
        }
        await self.exec_as_agent(
            environment,
            command=(
                f"mkdir -p {remote_home} {output_dir}; "
                f"printf '%s' {instruction_value} > {instruction_path}; "
                f"{self._NODE_PATH_PREFIX}node {script_path} create"
            ),
            env=common_env,
        )
        daemon_env = {
            **common_env,
            "CAIRN_SERVER": server_url,
        }
        try:
            await self.exec_as_agent(
                environment,
                command=(
                    f"set -euo pipefail; "
                    f"{self._NODE_PATH_PREFIX}"
                    f"cairn start --foreground > {daemon_log} 2>&1 & "
                    f"echo $! > {pid_path}"
                ),
                env=daemon_env,
            )
            await self.exec_as_agent(
                environment,
                command=f"{self._NODE_PATH_PREFIX}node {script_path} poll",
                env=common_env,
            )
        finally:
            await self.exec_as_agent(
                environment,
                command=f"if test -s {pid_path}; then kill \"$(cat {pid_path})\" 2>/dev/null || true; fi",
                env=daemon_env,
            )
            await self.exec_as_agent(
                environment,
                command=(
                    f"rm -f {shlex.quote((self._REMOTE_HOME / 'machine.json').as_posix())}; "
                    f"mkdir -p {output_dir}; "
                    f"if test -f {daemon_log}; then cp {daemon_log} {output_dir}/; fi; "
                    f"if test -f {shlex.quote((self._REMOTE_HOME / 'task.json').as_posix())}; then "
                    f"cp {shlex.quote((self._REMOTE_HOME / 'task.json').as_posix())} {output_dir}/; fi"
                ),
            )
