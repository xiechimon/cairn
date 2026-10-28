import random
from pathlib import Path


def sample_task_names(dataset_dir: Path, count: int, seed: int) -> list[str]:
    if not dataset_dir.is_dir():
        raise ValueError(f"missing dataset directory: {dataset_dir}")
    names = sorted(
        entry.name for entry in dataset_dir.iterdir() if entry.is_dir()
    )
    if not names:
        raise ValueError(f"dataset directory has no tasks: {dataset_dir}")
    if count < 0:
        raise ValueError("task count must be nonnegative")
    if count > len(names):
        raise ValueError(
            f"asked for {count} tasks but the dataset has {len(names)}"
        )
    rng = random.Random(seed)
    return sorted(rng.sample(names, count))
