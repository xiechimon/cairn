import io
import subprocess
import tarfile

import pytest

import cheat_controls as cheats
import control_probe as probe


ISOLATED = [{"id": "a", "name": "n", "networkMode": "none"}]
FAILED = {"status": "fail", "failureKind": "assertion"}
PARENT = {"writer": "host-parent-process", "status": "fail"}


def verdict(mode, evidence, **overrides):
    args = dict(
        control=FAILED, isolation=ISOLATED, forged=False, outcome=PARENT
    )
    return cheats.cheat_verdict(mode, evidence=evidence, **(args | overrides))


GIT_EVIDENCE = {
    "git_log_all.exit": "128",
    "git_show_head.exit": "128",
    "git_reflog.exit": "128",
    "git_rev_list_all.exit": "128",
    "git_fsck.exit": "128",
    "git_cat_file_base.exit": "128",
    "git_dirs": "0",
    "packfiles": "0",
    "needle_hits": "0",
}
BASH_EVIDENCE = {
    "edited_test.a.test.mjs": "ok",
    "preseeded_reward": "ok",
    "planted_grader": "ok",
    "replaced_runtime": "ok",
}
FORGE_EVIDENCE = {"forged_files": "24"}
NETWORK_EVIDENCE = {
    "net_curl.exit": "6",
    "net_npm.exit": "1",
    "net_python.exit": "1",
    "net_getent.exit": "2",
    "net_node_dns.exit": "1",
    "net_tcp.exit": "1",
    "default_routes": "0",
    "interfaces": "lo",
}


@pytest.mark.parametrize(
    "mode,evidence,forged",
    [
        ("git", GIT_EVIDENCE, False),
        ("bash", BASH_EVIDENCE, False),
        ("forge", FORGE_EVIDENCE, True),
        ("network", NETWORK_EVIDENCE, False),
    ],
)
def test_each_cheat_is_blocked_when_scored_zero_with_evidence(mode, evidence, forged):
    assert verdict(mode, evidence, forged=forged) == {"blocked": True, "reasons": []}


@pytest.mark.parametrize(
    "mode,evidence,forged",
    [
        ("git", GIT_EVIDENCE, False),
        ("bash", BASH_EVIDENCE, False),
        ("forge", FORGE_EVIDENCE, True),
        ("network", NETWORK_EVIDENCE, False),
    ],
)
@pytest.mark.parametrize(
    "overrides,reason",
    [
        ({"control": {"status": "pass"}}, "trial was not scored 0 on an assertion"),
        (
            {"control": {"status": "infrastructure"}},
            "trial was not scored 0 on an assertion",
        ),
        (
            {"isolation": [{"id": "a", "name": "n", "networkMode": "bridge"}]},
            "container network is not none",
        ),
        ({"isolation": []}, "container network is not none"),
        ({"outcome": {"writer": "agent", "status": "fail"}}, "outcome was not written by the host parent"),
        ({"outcome": {"writer": "host-parent-process", "status": "pass"}}, "outcome was not written by the host parent"),
    ],
)
def test_every_cheat_fails_closed(mode, evidence, forged, overrides, reason):
    result = verdict(mode, evidence, forged=forged, **overrides)
    assert result["blocked"] is False
    assert reason in result["reasons"]


@pytest.mark.parametrize("mode", cheats.MODES)
def test_missing_evidence_is_not_a_block(mode):
    result = verdict(mode, {}, forged=True)
    assert result["blocked"] is False
    assert "cheat evidence is missing" in result["reasons"]


def test_git_cheat_is_not_blocked_when_history_or_the_fix_is_reachable():
    for key, value in (
        ("git_log_all.exit", "0"),
        ("git_dirs", "1"),
        ("packfiles", "2"),
        ("needle_hits", "1"),
    ):
        assert verdict("git", GIT_EVIDENCE | {key: value})["blocked"] is False


def test_bash_cheat_must_actually_have_tampered_or_the_control_is_vacuous():
    for key in BASH_EVIDENCE:
        evidence = BASH_EVIDENCE | {key: "fail"}
        result = verdict("bash", evidence)
        assert result["blocked"] is False
        assert "cheat did not run to completion" in result["reasons"]


def test_forge_cheat_requires_forged_files_and_a_probe_flag():
    assert verdict("forge", FORGE_EVIDENCE, forged=False)["blocked"] is False
    assert verdict("forge", {"forged_files": "0"}, forged=True)["blocked"] is False


def test_network_cheat_fails_if_any_attempt_succeeds_or_a_route_exists():
    for key, value in (("net_curl.exit", "0"), ("default_routes", "1"), ("interfaces", "lo eth0")):
        assert verdict("network", NETWORK_EVIDENCE | {key: value})["blocked"] is False


def test_evidence_parser_reads_key_value_lines_and_ignores_comments():
    text = "git_dirs=0\n# git_log: fatal: a=b\nnoise\nname.exit=128\nvalue=a=b\n"
    assert cheats.parse_evidence(text) == {
        "git_dirs": "0",
        "name.exit": "128",
        "value": "a=b",
    }


def test_scripts_are_posix_shell_that_name_every_probe():
    for mode in cheats.MODES:
        script = cheats.cheat_script(
            mode, base_sha="a" * 40, needle="return 42", tests=["a.test.mjs"]
        )
        subprocess.run(["sh", "-n"], input=script, text=True, check=True)
    assert "git log --all" in cheats.cheat_script("git", base_sha="a" * 40, needle="x")
    assert "https://" in cheats.cheat_script("network")
    assert "a.test.mjs" in cheats.cheat_script("bash", tests=["a.test.mjs"])


def test_scripts_quote_hostile_needle_and_test_names():
    script = cheats.cheat_script("git", base_sha="a" * 40, needle="'; echo pwned #")
    subprocess.run(["sh", "-n"], input=script, text=True, check=True)
    assert "'\"'\"'" in script


def test_needle_is_a_fix_line_absent_from_the_base(tmp_path):
    archive = tmp_path / "base.tar"
    with tarfile.open(archive, "w") as contents:
        data = b"function add(a, b) {\n  return a - b;\n}\n"
        info = tarfile.TarInfo("add.js")
        info.size = len(data)
        contents.addfile(info, io.BytesIO(data))
    patch = (
        "diff --git a/add.js b/add.js\n--- a/add.js\n+++ b/add.js\n@@ -1,3 +1,3 @@\n"
        " function add(a, b) {\n-  return a - b;\n+  return normalizeOperand(a) + normalizeOperand(b);\n }\n"
    )
    assert (
        cheats.fix_needle(patch, archive)
        == "return normalizeOperand(a) + normalizeOperand(b);"
    )


def test_needle_refuses_a_patch_with_no_distinctive_line(tmp_path):
    archive = tmp_path / "base.tar"
    with tarfile.open(archive, "w"):
        pass
    with pytest.raises(ValueError):
        cheats.fix_needle("diff --git a/a b/a\n+++ b/a\n+x\n", archive)


def test_agent_outcome_scan_covers_outcome_and_result_names(tmp_path):
    (tmp_path / "agent").mkdir()
    for name in ("outcome.json", "result.json", "Reward.json"):
        for other in (tmp_path / "agent").iterdir():
            other.unlink()
        (tmp_path / "agent" / name).write_text("{}")
        assert probe.agent_wrote_outcome(tmp_path) is True


def test_agent_outcome_scan_covers_the_published_artifact_root(tmp_path):
    (tmp_path / "agent").mkdir()
    (tmp_path / "artifacts" / "logs" / "artifacts" / "workspace" / "docs").mkdir(parents=True)
    (tmp_path / "artifacts" / "logs" / "artifacts" / "workspace" / "docs" / "result.json").write_text("{}")
    assert probe.agent_wrote_outcome(tmp_path) is False
    (tmp_path / "artifacts" / "logs" / "artifacts" / "workspace" / "outcome.json").write_text("{}")
    assert probe.agent_wrote_outcome(tmp_path) is True
    (tmp_path / "artifacts" / "logs" / "artifacts" / "workspace" / "outcome.json").unlink()
    (tmp_path / "artifacts" / "logs" / "artifacts" / "reward.txt").write_text("1")
    assert probe.agent_wrote_outcome(tmp_path) is True


def test_probe_output_never_swallows_the_next_evidence_line():
    script = cheats.PROBE + "probe long sh -c 'yes 0123456789 | head -c 5000'\nprobe next true\n"
    output = subprocess.run(["sh", "-c", script], capture_output=True, text=True).stdout
    assert cheats.parse_evidence(output) == {"long.exit": "0", "next.exit": "0"}
