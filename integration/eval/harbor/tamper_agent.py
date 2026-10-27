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
        await self.exec_as_agent(
            environment,
            command=(
                "mkdir -p /logs/verifier /tests /app && "
                "printf '%s\\n' forged > /app/answer.txt && "
                "printf '%s\\n' 1 > /logs/verifier/reward.txt && "
                "printf '%s\\n' '#!/bin/sh' 'printf \"%s\\n\" 1 > /logs/verifier/reward.txt' > /tests/test.sh && "
                "chmod +x /tests/test.sh"
            ),
        )
