import json
from pathlib import Path

import pytest

from cairn_harbor.subset import sample_task_names

PUBLIC_DIR = Path(__file__).resolve().parent.parent
SUBSET_FILE = PUBLIC_DIR / "subset-1792.json"
DATASET_INDEX_FILE = PUBLIC_DIR / "dataset-index.json"


def test_sample_task_names_is_deterministic(tmp_path: Path) -> None:
    dataset = tmp_path / "tasks"
    for name in ["z-tasks", "a-tasks", "m-tasks", "b-tasks", "c-tasks", "d-tasks"]:
        (dataset / name).mkdir(parents=True)
    first = sample_task_names(dataset, 3, seed=42)
    second = sample_task_names(dataset, 3, seed=42)
    assert first == second
    assert len(first) == 3
    assert set(first).issubset({p.name for p in dataset.iterdir() if p.is_dir()})


def test_sample_task_names_respects_seed(tmp_path: Path) -> None:
    dataset = tmp_path / "tasks"
    for index in range(10):
        (dataset / f"task-{index:02d}").mkdir(parents=True)
    from_seed_1 = sample_task_names(dataset, 6, seed=1)
    from_seed_2 = sample_task_names(dataset, 6, seed=2)
    assert from_seed_1 != from_seed_2


def test_sample_task_names_rejects_overlarge_sample(tmp_path: Path) -> None:
    dataset = tmp_path / "tasks"
    (dataset / "only-one").mkdir(parents=True)
    with pytest.raises(ValueError):
        sample_task_names(dataset, 2, seed=7)


def test_sample_task_names_returns_sorted_unique_names(tmp_path: Path) -> None:
    dataset = tmp_path / "tasks"
    for name in ["b-task", "a-task", "c-task"]:
        (dataset / name).mkdir(parents=True)
    picked = sample_task_names(dataset, 3, seed=0)
    assert picked == sorted(set(picked))


def test_committed_subset_records_seed_and_twenty_tasks_each() -> None:
    payload = json.loads(SUBSET_FILE.read_text())
    assert payload["seed"] == 1792
    assert len(payload["swebench-verified"]) == 20
    assert len(payload["terminal-bench-2-1"]) == 20


def test_committed_subset_ids_exist_in_the_pinned_dataset_index() -> None:
    payload = json.loads(SUBSET_FILE.read_text())
    index = json.loads(DATASET_INDEX_FILE.read_text())
    for dataset in ("swebench-verified", "terminal-bench-2-1"):
        task_ids = payload[dataset]
        assert len(task_ids) == len(set(task_ids))
        for task_id in task_ids:
            assert task_id in index[dataset], task_id


def test_pinned_dataset_index_counts_match_the_datasets() -> None:
    index = json.loads(DATASET_INDEX_FILE.read_text())
    assert len(index["swebench-verified"]) == 500
    assert len(index["terminal-bench-2-1"]) == 89
    assert index["swebench-verified"] == sorted(index["swebench-verified"])
    assert index["terminal-bench-2-1"] == sorted(index["terminal-bench-2-1"])


def test_missing_dataset_has_a_clear_diagnostic(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="dataset directory"):
        sample_task_names(tmp_path / "missing", 1, 0)


def test_empty_dataset_is_rejected_even_for_zero_count(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="no tasks"):
        sample_task_names(tmp_path, 0, 0)
