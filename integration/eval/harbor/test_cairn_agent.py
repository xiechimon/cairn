import unittest
from pathlib import Path


SOURCE = Path(__file__).with_name("cairn_agent.py")
README = Path(__file__).with_name("README.md")


class CairnAgentSourceTest(unittest.TestCase):
    def test_adapter_declares_harbor_agent_contract(self):
        source = SOURCE.read_text()
        self.assertIn("class CairnAgent(BaseInstalledAgent):", source)
        self.assertIn("CAIRN_SERVER_URL", source)
        self.assertIn("CAIRN_MACHINE_TOKEN", source)
        self.assertIn("async def install(", source)
        self.assertIn("async def run(", source)
        self.assertIn("remote_session_logs_dir", source)

    def test_credentials_are_passed_as_exec_environment(self):
        source = SOURCE.read_text()
        self.assertIn('"CAIRN_SERVER_URL": server_url', source)
        self.assertIn('"CAIRN_MACHINE_TOKEN": machine_token', source)
        self.assertIn("env=common_env", source)
        self.assertNotIn("CAIRN_MACHINE_TOKEN={shlex.quote(machine_token)}", source)
        self.assertNotIn("--api-key {shlex.quote(machine_token)}", source)

    def test_install_uses_uploaded_local_tarball(self):
        source = SOURCE.read_text()
        self.assertIn("CAIRN_CLI_TGZ", source)
        self.assertIn("environment.upload_file", source)
        self.assertIn('npm install -g "$CAIRN_CLI_TGZ"', source)
        self.assertNotIn("@xiechimon/cairn-cli@0.2.0", source)

    def test_run_creates_and_polls_a_cairn_task(self):
        source = SOURCE.read_text()
        self.assertIn("CAIRN_AGENT_ID", source)
        self.assertIn("POST", source)
        self.assertIn("/api/projects/", source)
        self.assertIn("/api/projects/", source)
        self.assertIn("assignment", source)
        self.assertIn("poll", source)
        self.assertIn("25 * 60", source)
        self.assertIn("/api/todos/", source)
        self.assertIn("/api/conversations/", source)

    def test_daemon_is_stopped_after_task(self):
        source = SOURCE.read_text()
        self.assertIn("kill ", source)
        self.assertIn("cairn.pid", source)
        self.assertIn("finally", source)
        self.assertIn("environment_logs_dir", source)

    def test_install_provisions_node_via_nvm(self):
        source = SOURCE.read_text()
        self.assertIn("nvm_node_install_snippet", source)
        self.assertIn('ensure_system_dependencies(environment, ("curl", "bash", "ca_certificates"))', source)
        self.assertNotIn('"nodejs"', source)
        self.assertNotIn('"npm"', source)

    def test_node_invocations_resolve_the_nvm_node_bin(self):
        source = SOURCE.read_text()
        self.assertIn("versions/node/*/bin", source)
        self.assertLessEqual(source.count("versions/node/*/bin"), 1)

    def test_run_command_uses_harbor_module_import_path(self):
        readme = README.read_text()
        self.assertIn("PYTHONPATH=. uv tool run", readme)
        self.assertIn("--agent cairn_agent:CairnAgent", readme)
        self.assertNotIn(".py:CairnAgent", readme)


if __name__ == "__main__":
    unittest.main()
