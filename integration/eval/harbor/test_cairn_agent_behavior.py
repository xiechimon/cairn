import asyncio
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from unittest import mock


class Capabilities:
    def model_copy(self, update):
        return self


class BaseInstalledAgent:
    capabilities = Capabilities()

    def _get_env(self, name):
        return os.environ.get(name)

    async def exec_as_agent(self, environment, command, env=None, cwd=None, timeout_sec=None):
        result = await environment.exec(command, env=env, cwd=cwd, timeout_sec=timeout_sec)
        if result.return_code != 0:
            raise RuntimeError(result.stderr or result.stdout)
        return result

    async def ensure_system_dependencies(self, environment, names):
        return None


class BaseEnvironment:
    pass


class AgentContext:
    pass


def with_prompt_template(function):
    return function


harbor_module = types.ModuleType("harbor")
agents_module = types.ModuleType("harbor.agents")
installed_module = types.ModuleType("harbor.agents.installed")
base_agent_module = types.ModuleType("harbor.agents.installed.base")
base_agent_module.BaseInstalledAgent = BaseInstalledAgent
base_agent_module.with_prompt_template = with_prompt_template
node_install_module = types.ModuleType("harbor.agents.installed.node_install")
node_install_module.nvm_node_install_snippet = lambda node_major=22: "true"
environment_module = types.ModuleType("harbor.environments")
base_environment_module = types.ModuleType("harbor.environments.base")
base_environment_module.BaseEnvironment = BaseEnvironment
models_module = types.ModuleType("harbor.models")
agent_models_module = types.ModuleType("harbor.models.agent")
context_module = types.ModuleType("harbor.models.agent.context")
context_module.AgentContext = AgentContext
sys.modules.update(
    {
        "harbor": harbor_module,
        "harbor.agents": agents_module,
        "harbor.agents.installed": installed_module,
        "harbor.agents.installed.base": base_agent_module,
        "harbor.agents.installed.node_install": node_install_module,
        "harbor.environments": environment_module,
        "harbor.environments.base": base_environment_module,
        "harbor.models": models_module,
        "harbor.models.agent": agent_models_module,
        "harbor.models.agent.context": context_module,
    }
)
sys.path.insert(0, str(Path(__file__).parent))

from cairn_agent import CairnAgent


class ExecResult:
    def __init__(self, return_code, stdout, stderr):
        self.return_code = return_code
        self.stdout = stdout
        self.stderr = stderr


class LocalEnvironment(BaseEnvironment):
    def __init__(self, root, executable_dir):
        self.root = root
        self.executable_dir = executable_dir
        self.default_user = None
        self.commands = []

    async def upload_file(self, source_path, target_path):
        shutil.copyfile(source_path, target_path)

    async def exec(self, command, cwd=None, env=None, timeout_sec=None, user=None):
        self.commands.append(command)
        process_env = {
            "HOME": str(self.root),
            "LANG": "C",
            "PATH": f"{self.executable_dir}:{os.environ['PATH']}",
        }
        process_env.update(env or {})
        process = await asyncio.create_subprocess_exec(
            "bash",
            "-c",
            command,
            cwd=cwd or self.root,
            env=process_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=2)
        except TimeoutError:
            process.kill()
            await process.wait()
            raise
        return ExecResult(process.returncode, stdout.decode(), stderr.decode())


class CairnHandler(BaseHTTPRequestHandler):
    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/machine/me":
            self.send_json({"teamId": "team-harbor"})
        elif self.path.startswith("/api/projects?"):
            self.send_json([{"id": "project-harbor"}])
        elif self.path == "/api/todos/todo-harbor":
            deadline = time.monotonic() + 1
            check_path = Path(self.server.daemon_check_path)
            while not check_path.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.send_json({"id": "todo-harbor", "phase": self.server.todo_phase})
        elif self.path == "/api/builds/build-harbor":
            self.send_json({"id": "build-harbor", "todoId": "todo-harbor"})
        elif self.path == "/api/conversations/build-harbor/messages":
            self.send_json({"messages": []})
        else:
            self.send_json({"error": self.path}, 404)

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        self.rfile.read(length)
        if self.path == "/api/projects/project-harbor/todos":
            self.send_json({"id": "todo-harbor"}, 201)
        elif self.path == "/api/projects/project-harbor/builds":
            self.send_json({"builds": [{"id": "build-harbor"}]}, 201)
        else:
            self.send_json({"error": self.path}, 404)

    def log_message(self, format, *args):
        return


class CairnAgentBehaviorTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.logs = self.root / "logs"
        self.logs.mkdir()
        self.task_workdir = self.root / "task-workdir"
        self.task_workdir.mkdir()
        self.workspaces = self.root / "workspaces"
        self.executable_dir = self.root / "bin"
        self.executable_dir.mkdir()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), CairnHandler)
        self.server.todo_phase = "done"
        self.server.daemon_check_path = self.home / "daemon-check.json"
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.server_url = f"http://127.0.0.1:{self.server.server_port}"
        executable = self.executable_dir / "cairn"
        check_script = r'''const fs = require("node:fs");
const path = require("node:path");
let machine = null;
try {
  machine = JSON.parse(fs.readFileSync(path.join(process.env.CAIRN_HOME, "machine.json"), "utf8"));
} catch {}
const task = JSON.parse(fs.readFileSync(path.join(process.env.CAIRN_HOME, "task.json"), "utf8"));
let workspaceLinked = false;
try {
  workspaceLinked = fs.realpathSync(path.join(process.env.CAIRN_WORKSPACES_DIR, task.buildId)) === fs.realpathSync(process.env.CAIRN_TASK_WORKDIR);
} catch {}
const credentialPath = path.join(process.env.CAIRN_HOME, "machine.json");
let credentialMode = null;
try {
  credentialMode = fs.statSync(credentialPath).mode & 0o777;
} catch {}
fs.writeFileSync(path.join(process.env.CAIRN_HOME, "daemon-check.json"), JSON.stringify({
  machineEnrolled: machine?.machineId === "machine-harbor" && machine?.teamId === "team-harbor" && machine?.token === "token-harbor" && machine?.serverUrl === process.env.CAIRN_SERVER,
  serverConfigured: process.env.CAIRN_SERVER === process.env.CAIRN_SERVER_URL,
  credentialMode,
  workspaceLinked
}));
'''
        executable.write_text(
            "#!/bin/bash\n"
            f"node -e {shlex.quote(check_script)}\n"
            "while true; do sleep 1; done\n"
        )
        executable.chmod(0o755)
        self.environment_patch = mock.patch.dict(
            os.environ,
            {
                "CAIRN_SERVER_URL": self.server_url,
                "CAIRN_MACHINE_TOKEN": "token-harbor",
                "CAIRN_MACHINE_ID": "machine-harbor",
                "CAIRN_TEAM_ID": "team-harbor",
                "CAIRN_AGENT_ID": "agent-harbor",
                "CAIRN_PROJECT_ID": "project-harbor",
                "CAIRN_TASK_WORKDIR": str(self.task_workdir),
                "CAIRN_WORKSPACES_DIR": str(self.workspaces),
            },
        )
        self.environment_patch.start()

    def tearDown(self):
        self.environment_patch.stop()
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join()
        self.temporary_directory.cleanup()

    def run_agent(self):
        agent = CairnAgent()
        agent._REMOTE_HOME = PurePosixPath(self.home.as_posix())
        agent._REQUEST_SCRIPT = PurePosixPath((self.root / "request.mjs").as_posix())
        agent.environment_logs_dir = PurePosixPath(self.logs.as_posix())
        environment = LocalEnvironment(self.root, self.executable_dir)
        self.environment = environment
        asyncio.run(agent.run("Create hello.txt", environment, AgentContext()))

    def test_install_skips_distro_node_packages(self):
        cli_tgz = self.root / "cli.tgz"
        cli_tgz.write_bytes(b"tarball")
        install_bin = self.root / "install-bin"
        install_bin.mkdir()
        for name in ("npm", "cairn"):
            stub = install_bin / name
            stub.write_text("#!/bin/bash\nexit 0\n")
            stub.chmod(0o755)
        environment = LocalEnvironment(self.root, install_bin)
        uploaded_tgz = self.root / "uploaded-cli.tgz"
        agent = CairnAgent()
        agent._REMOTE_HOME = PurePosixPath(self.home.as_posix())
        agent._CLI_TGZ = PurePosixPath(uploaded_tgz.as_posix())
        with (
            mock.patch.dict(os.environ, {"CAIRN_CLI_TGZ": str(cli_tgz)}),
            mock.patch.object(
                CairnAgent,
                "ensure_system_dependencies",
                side_effect=lambda environment, names: None,
            ) as ensure,
        ):
            asyncio.run(agent.install(environment))
        self.assertEqual(ensure.call_args.args[1], ("curl", "bash", "ca_certificates"))
        self.assertTrue(uploaded_tgz.exists())
        self.assertTrue(any("npm install -g" in command for command in environment.commands))

    def test_node_invocations_resolve_the_nvm_node_bin(self):
        self.run_agent()
        node_commands = [
            command
            for command in self.environment.commands
            if "request.mjs create" in command or "request.mjs poll" in command or "cairn start" in command
        ]
        self.assertEqual(len(node_commands), 3)
        self.assertTrue(all("versions/node/*/bin" in command for command in node_commands))

    def test_daemon_receives_enrollment_and_task_workspace(self):
        self.run_agent()
        check = json.loads((self.home / "daemon-check.json").read_text())
        self.assertEqual(
            check,
            {
                "machineEnrolled": True,
                "serverConfigured": True,
                "credentialMode": 0o600,
                "workspaceLinked": True,
            },
        )

    def test_review_phase_returns_control_to_harbor(self):
        self.server.todo_phase = "review"
        self.run_agent()
        result = json.loads((self.logs / "result.json").read_text())
        self.assertEqual(result["todo"]["phase"], "review")
        self.assertFalse(result["timedOut"])

    def test_log_collection_excludes_private_runtime_state(self):
        (self.home / "private.key").write_text("private")
        self.run_agent()
        self.assertFalse((self.logs / "private.key").exists())
        self.assertFalse((self.logs / "machine.json").exists())
        self.assertTrue((self.logs / "cairn.log").exists())
        self.assertTrue((self.logs / "task.json").exists())


if __name__ == "__main__":
    unittest.main()
