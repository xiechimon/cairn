import json

import pytest

import control_probe as probe


RESULT = {
    "exception_info": None,
    "verifier_result": {"rewards": {"reward": 1}},
    "environment_setup": {
        "started_at": "2026-11-04T10:00:00Z",
        "finished_at": "2026-11-04T10:02:30.500000Z",
    },
    "agent_execution": {
        "started_at": "2026-11-04T10:02:31Z",
        "finished_at": "2026-11-04T10:02:41Z",
    },
    "verifier": {
        "started_at": "2026-11-04T10:02:42Z",
        "finished_at": "2026-11-04T10:03:12Z",
    },
}


def test_timing_separates_lock_wait_image_build_and_harbor_wall():
    timing = probe.timing_record(
        lock_requested=100.0,
        lock_acquired=160.0,
        harbor_finished=400.0,
        result=RESULT,
        cpu_seconds=12.5,
    )
    assert timing == {
        "lockWaitSeconds": 60.0,
        "harborWallSeconds": 240.0,
        "imageBuildSeconds": 150.5,
        "agentSeconds": 10.0,
        "verifierSeconds": 30.0,
        "cpuSeconds": 12.5,
    }


def test_timing_marks_missing_phases_as_null_instead_of_zero():
    timing = probe.timing_record(1.0, 1.0, 2.0, {}, 0.0)
    assert timing["imageBuildSeconds"] is None
    assert timing["agentSeconds"] is None
    assert timing["verifierSeconds"] is None


def test_cpu_stat_parses_microseconds():
    assert probe.cpu_seconds("usage_usec 2500000\nuser_usec 1\nsystem_usec 2\n") == 2.5
    assert probe.cpu_seconds("") is None


def test_sampler_keeps_peak_usage_and_first_network_mode_per_container():
    state = probe.ContainerState()
    state.observe("abc", "trial-main-1", "none", 1_000_000)
    state.observe("abc", "trial-main-1", "none", 3_000_000)
    state.observe("abc", "trial-main-1", "none", 2_000_000)
    state.observe("def", "trial-verifier-1", "none", None)
    assert state.cpu_seconds() == 3.0
    assert state.isolation() == [
        {"id": "abc", "name": "trial-main-1", "networkMode": "none"},
        {"id": "def", "name": "trial-verifier-1", "networkMode": "none"},
    ]


def test_isolation_requires_every_container_to_have_no_network():
    state = probe.ContainerState()
    state.observe("abc", "a", "none", 0)
    state.observe("def", "b", "bridge", 0)
    with pytest.raises(ValueError, match="bridge"):
        probe.require_isolated(state.isolation())
    with pytest.raises(ValueError, match="no containers"):
        probe.require_isolated([])


def test_agent_directory_must_not_hold_outcome_files(tmp_path):
    (tmp_path / "agent").mkdir()
    (tmp_path / "agent" / "nop.txt").write_text("noop")
    assert probe.agent_wrote_outcome(tmp_path) is False
    (tmp_path / "agent" / "reward.txt").write_text("1")
    assert probe.agent_wrote_outcome(tmp_path) is True


def record(**overrides):
    base = dict(
        oracle={"status": "pass"},
        nop={"status": "fail", "failureKind": "assertion"},
        isolation=[{"id": "a", "name": "n", "networkMode": "none"}],
        agent_wrote_outcome=False,
    )
    return probe.probe_verdict(**(base | overrides))


def test_probe_passes_only_with_oracle_pass_nop_assertion_and_isolation():
    assert record() == {"passed": True, "reasons": []}


@pytest.mark.parametrize(
    "overrides,reason",
    [
        ({"oracle": {"status": "infrastructure"}}, "oracle did not pass"),
        ({"nop": {"status": "infrastructure"}}, "nop did not fail on an assertion"),
        ({"nop": {"status": "pass"}}, "nop did not fail on an assertion"),
        (
            {"isolation": [{"id": "a", "name": "n", "networkMode": "bridge"}]},
            "container network is not none",
        ),
        ({"isolation": []}, "container network is not none"),
        ({"agent_wrote_outcome": True}, "agent container wrote an outcome file"),
    ],
)
def test_probe_fails_for_each_failure_mode(overrides, reason):
    verdict = record(**overrides)
    assert verdict["passed"] is False
    assert reason in verdict["reasons"]


def test_outcome_is_written_by_the_parent_with_its_pid(tmp_path):
    path = probe.write_outcome(tmp_path, "nop", {"status": "fail"}, pid=4242)
    assert json.loads(path.read_text()) == {
        "agent": "nop",
        "status": "fail",
        "writer": "host-parent-process",
        "writerPid": 4242,
    }
