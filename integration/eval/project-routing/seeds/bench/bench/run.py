import argparse
import subprocess


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--suite", required=True)
    args = parser.parse_args()
    subprocess.run(["harbor", "run", "--agent", "pi", "--dataset", args.suite], check=True)


if __name__ == "__main__":
    main()
