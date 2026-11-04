import json
from pathlib import Path

from cairn_harbor.scan import is_test_path


def ingest_session_file_edit(session_path: Path) -> str | None:
    _TOOL_NAMES = {"edit", "write"}
    if not session_path.is_file():
        return None
    for line in session_path.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped.startswith("{"):
            continue
        try:
            event = json.loads(stripped)
        except ValueError:
            continue
        message = event.get("message") if isinstance(event, dict) else None
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "toolCall":
                continue
            if block.get("name") not in _TOOL_NAMES:
                continue
            arguments = block.get("arguments")
            if not isinstance(arguments, dict):
                continue
            for key in ("filePath", "path", "file_path"):
                value = arguments.get(key)
                if isinstance(value, str):
                    return value
    return None


def touches_test_file(session_path: Path) -> bool:
    edited = ingest_session_file_edit(session_path)
    return edited is not None and is_test_path(edited)
