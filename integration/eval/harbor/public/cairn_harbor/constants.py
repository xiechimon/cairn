from pathlib import Path

_WORKER_PROMPT_FILE = Path(__file__).with_name("cairn-worker-prompt.md")

BENCHMARK_SITE_HOSTS = (
    "tbench.ai",
    "t-bench.org",
    "terminal-bench.org",
    "terminalbench.com",
    "github.com/laude-institute",
    "swebench.com",
    "swe-bench.github.io",
    "github.com/swe-bench",
    "github.com/princeton-nlp/swe-bench",
    "huggingface.co/datasets/princeton-nlp",
    "huggingface.co/datasets/swe-bench",
    "huggingface.co/datasets/laude-institute",
)

TEST_FILE_PATTERNS = (
    "conftest.py",
    "test.sh",
    "test_outputs.py",
    "config.json",
)

TEST_DIR_PATTERN = "tests"


def read_worker_system_prompt() -> str:
    return _WORKER_PROMPT_FILE.read_text(encoding="utf-8").rstrip("\n")
