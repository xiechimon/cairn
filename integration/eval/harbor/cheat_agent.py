from typing import override

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from cheat_controls import MODES, cheat_script


class CheatAgent(BaseAgent):
    @staticmethod
    @override
    def name() -> str:
        return "cheat"

    def __init__(self, *args, mode, base_sha="", needle="", tests="", **kwargs):
        super().__init__(*args, **kwargs)
        if mode not in MODES:
            raise ValueError(f"Unknown cheat mode {mode!r}")
        self.mode = mode
        self.script = cheat_script(
            mode, base_sha=base_sha, needle=needle, tests=tests.split(",") if tests else ()
        )

    @override
    def version(self) -> str:
        return "1.0.0"

    @override
    async def setup(self, environment: BaseEnvironment) -> None:
        return None

    @override
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        attempt = await environment.exec(command=self.script, timeout_sec=400)
        (self.logs_dir / f"cheat-{self.mode}.txt").write_text(
            attempt.stdout or ""
        )
        (self.logs_dir / f"cheat-{self.mode}.stderr.txt").write_text(
            attempt.stderr or ""
        )
