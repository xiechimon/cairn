import json
import sys


def pass_rate(rows: list[dict]) -> float:
    passed = sum(1 for r in rows if r["status"] == "passed")
    return passed / len(rows)


def main() -> None:
    rows = [json.loads(line) for line in open(sys.argv[1])]
    print(f"pass rate: {pass_rate(rows):.1%}")


if __name__ == "__main__":
    main()
