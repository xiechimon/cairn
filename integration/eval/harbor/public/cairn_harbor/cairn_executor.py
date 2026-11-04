import json
import shlex
from pathlib import PurePosixPath
from typing import override

from harbor.agents.installed.pi import Pi
from harbor.environments.base import BaseEnvironment

from cairn_harbor.constants import read_worker_system_prompt
from cairn_harbor.executor_record import (
    RECORD_FILE_NAME,
    build_executor_record,
)

_CAIRN_CONFIG_DIR = PurePosixPath("/tmp/harbor-pi-agent")
CAIRN_PROMPT_PATH = _CAIRN_CONFIG_DIR / "cairn-worker-prompt.txt"


class CairnExecutor(Pi):
    @staticmethod
    @override
    def name() -> str:
        return "cairn"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await super().install(environment)
        await self._ensure_config_dir(environment)
        system_prompt = read_worker_system_prompt()
        skills = []
        if self.skills_dir:
            script = """const fs = require("node:fs");
const path = require("node:path");
const skills = [];
function visit(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.name === "SKILL.md") skills.push({
            name: path.basename(dir), content: fs.readFileSync(file, "utf8")
        });
    }
}
visit(process.argv[1]);
process.stdout.write(JSON.stringify(skills));"""
            result = await self.exec_as_agent(
                environment,
                command=(
                    'if [ -f "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi; '
                    f"node -e {shlex.quote(script)} {shlex.quote(self.skills_dir)}"
                ),
            )
            if result.return_code != 0:
                raise RuntimeError("Cannot read injected skills for executor record")
            skills = json.loads(result.stdout)
        self._write_executor_record(system_prompt, skills)
        await self._upload_config_text(
            environment,
            content=system_prompt,
            remote_path=CAIRN_PROMPT_PATH.as_posix(),
            filename=CAIRN_PROMPT_PATH.name,
        )

    @override
    def build_cli_flags(self) -> str:
        base = super().build_cli_flags()
        flag = f"--append-system-prompt {shlex.quote(CAIRN_PROMPT_PATH.as_posix())}"
        return f"{base} {flag}".strip() if base else flag

    def _write_executor_record(self, system_prompt: str, skills: list[dict]) -> None:
        record = build_executor_record(
            backend="pi",
            model=self.model_name or "",
            effort=self.options.reasoning_effort,
            system_prompt=system_prompt,
            skills=skills,
            tools=[],
        )
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        (self.logs_dir / RECORD_FILE_NAME).write_text(
            json.dumps(record.to_json(), indent=2) + "\n"
        )
