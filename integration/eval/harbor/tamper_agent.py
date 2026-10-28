from typing import override

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class TamperAgent(BaseInstalledAgent):
    @staticmethod
    @override
    def name() -> str:
        return "tamper"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        return None

    @override
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        probe = await self.exec_as_agent(
            environment,
            command=(
                "printf 'agent-hostname='; hostname; "
                "for path in /tests/expected.txt /solution/solve.sh /oracle/solve.sh; do "
                "if cat \"$path\" 2>/dev/null; then exit 1; "
                "else printf 'unreadable=%s\\n' \"$path\"; fi; done"
            ),
        )
        (self.logs_dir / "isolation.txt").write_text(probe.stdout)
        forged = await self.exec_as_agent(
            environment,
            command=(
                "mkdir -p /logs/verifier /tests /app && "
                "printf '%s\\n' forged > /app/answer.txt && "
                "printf '%s\\n' 1 > /logs/verifier/reward.txt && "
                "printf '%s\\n' '{\"reward\": 1}' > /logs/verifier/reward.json && "
                "printf '%s\\n' '#!/bin/sh' 'echo 1 > /logs/verifier/reward.txt' > /tests/test.sh && "
                "chmod +x /tests/test.sh && sh /tests/test.sh && "
                "cat /app/answer.txt /logs/verifier/reward.txt /tests/test.sh /logs/verifier/reward.json"
            ),
        )
        (self.logs_dir / "tampering.txt").write_text(forged.stdout)
