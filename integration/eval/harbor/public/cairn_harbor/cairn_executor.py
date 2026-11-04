import json
import shlex
from pathlib import PurePosixPath
from typing import override

from harbor.agents.installed.pi import Pi
from harbor.environments.base import BaseEnvironment

from cairn_harbor.constants import SKILLS_DIR, read_worker_system_prompt
from cairn_harbor.executor_record import (
    RECORD_FILE_NAME,
    build_executor_record,
    load_skills,
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
        self._write_executor_record(system_prompt)
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

    def _write_executor_record(self, system_prompt: str) -> None:
        record = build_executor_record(
            backend="pi",
            model=self.model_name or "",
            effort=self.options.reasoning_effort,
            system_prompt=system_prompt,
            skills=load_skills(SKILLS_DIR),
            tools=[],
        )
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        (self.logs_dir / RECORD_FILE_NAME).write_text(
            json.dumps(record.to_json(), indent=2) + "\n"
        )
