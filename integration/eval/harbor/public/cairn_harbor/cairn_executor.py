import shlex
from pathlib import PurePosixPath
from typing import override

from harbor.agents.installed.pi import Pi
from harbor.environments.base import BaseEnvironment

from cairn_harbor.constants import read_worker_system_prompt

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
        await self._upload_config_text(
            environment,
            content=read_worker_system_prompt(),
            remote_path=CAIRN_PROMPT_PATH.as_posix(),
            filename=CAIRN_PROMPT_PATH.name,
        )

    @override
    def build_cli_flags(self) -> str:
        base = super().build_cli_flags()
        flag = f"--append-system-prompt {shlex.quote(CAIRN_PROMPT_PATH.as_posix())}"
        return f"{base} {flag}".strip() if base else flag
