import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "runner_contract_plan", Path(__file__).with_name("runner_contract_plan.py")
)
planner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(planner)

BROWSER_SPECS = [
    "apps/web/e2e/board-shell.spec.ts",
    "apps/web/e2e/chief-draft-persist.spec.ts",
    "apps/web/e2e/collapse-family.spec.ts",
    "apps/web/e2e/mobile-narrow.spec.ts",
    "apps/web/e2e/paper-sidebar.spec.ts",
    "apps/web/e2e/shell-consistency.spec.ts",
    "apps/web/e2e/sidebar-focus-ring.spec.ts",
    "apps/web/e2e/sidebar-nav.spec.ts",
    "apps/web/e2e/sidebar-visual.spec.ts",
]
UNIT_SUITES = [
    "apps/web/test/i18n-coverage.test.ts",
    "apps/web/test/i18n-scan.test.ts",
]
HELPER = "apps/web/test/i18n-scan.ts"
SNAPSHOT = "apps/web/e2e/example.spec.ts-snapshots/example-chromium-linux.png"
CONFIG_TEXT = """
const PORT = Number(process.env.E2E_PORT ?? 8399);
globalSetup: './e2e/port-holder-guard.ts',
reuseExistingServer: true,
command: `pnpm exec vite build --mode fixture && pnpm exec vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
baseURL: `http://127.0.0.1:${PORT}`,
note: "https://example.invalid/not-egress-proof",
"""


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def contract(**overrides):
    config_sha = digest(CONFIG_TEXT)
    body = {
        "pr": 2437,
        "headSha": "c" * 40,
        "firstParentSha": "d" * 40,
        "workspace": "@cairn/web",
        "packageManager": "pnpm@12.5.1",
        "playwright": "1.63.0",
        "configText": CONFIG_TEXT,
        "configSha256": config_sha,
        "changedBrowserSpecPaths": list(BROWSER_SPECS),
        "changedUnitRegressionPaths": list(UNIT_SUITES),
        "changedIntegrationPaths": [],
        "changedTestHelperOrAssetPaths": [HELPER, SNAPSHOT],
        "requiredPaths": [*BROWSER_SPECS, *UNIT_SUITES, HELPER, SNAPSHOT],
        "trustedDigests": {
            HELPER: "a" * 64,
            SNAPSHOT: "b" * 64,
            "apps/web/playwright.config.ts": config_sha,
        },
        "pins": {
            "workspace": "@cairn/web",
            "packageManager": "pnpm@12.5.1",
            "playwright": "1.63.0",
            "configSha256": config_sha,
            "instructionSha256": "e" * 64,
            "labelSha256": "f" * 64,
        },
        "instructionSha256": "e" * 64,
        "labelSha256": "f" * 64,
        "claimedProductPaths": ["apps/web/src/board.tsx"],
    }
    body.update(overrides)
    return body


def categories(plan):
    return {command["category"]: command for command in plan["commands"]}


def test_browser_spec_keeps_a_playwright_command():
    plan = planner.plan_runner_contract(
        contract(
            pr=155,
            workspace="@pacman/web",
            changedBrowserSpecPaths=["apps/web/e2e/skills-add-import.spec.ts"],
            changedUnitRegressionPaths=[],
            changedIntegrationPaths=[],
            changedTestHelperOrAssetPaths=[],
            requiredPaths=["apps/web/e2e/skills-add-import.spec.ts"],
            pins={
                **contract()["pins"],
                "workspace": "@pacman/web",
            },
        )
    )
    browser = categories(plan)["browser"]
    assert browser["argv"][:6] == [
        "pnpm",
        "--filter",
        "@pacman/web",
        "exec",
        "playwright",
        "test",
    ]
    assert browser["argv"][-1] == "e2e/skills-add-import.spec.ts"
    assert "unit" not in categories(plan)
    assert "No runnable test file" not in json.dumps(plan)


def test_mixed_contract_keeps_every_browser_unit_and_helper_path():
    plan = planner.plan_runner_contract(contract())
    commands = categories(plan)
    assert commands["browser"]["argv"][2] == "@cairn/web"
    assert commands["browser"]["paths"] == BROWSER_SPECS
    assert commands["unit"]["paths"] == UNIT_SUITES
    assert commands["unit"]["argv"][:4] == ["pnpm", "exec", "vitest", "run"]
    trusted = {item["path"]: item for item in plan["trustedInputs"]}
    assert trusted[HELPER]["role"] == "helper"
    assert trusted[HELPER]["sha256"] == "a" * 64
    assert trusted[SNAPSHOT]["role"] == "asset"
    assert HELPER not in plan["productPaths"]
    assert SNAPSHOT not in plan["productPaths"]
    assert plan["productPaths"] == ["apps/web/src/board.tsx"]


def test_removing_any_required_path_blocks_the_plan():
    for dropped in (BROWSER_SPECS[0], UNIT_SUITES[0], HELPER):
        specs = [path for path in BROWSER_SPECS if path != dropped]
        units = [path for path in UNIT_SUITES if path != dropped]
        helpers = [path for path in (HELPER, SNAPSHOT) if path != dropped]
        plan = planner.plan_runner_contract(
            contract(
                changedBrowserSpecPaths=specs,
                changedUnitRegressionPaths=units,
                changedTestHelperOrAssetPaths=helpers,
            )
        )
        assert plan["blocked"] is True
        assert plan["commands"] == []
        assert any(dropped in blocker for blocker in plan["blockers"])


def test_integration_contract_does_not_invent_a_browser_command():
    unit = "apps/server/test/m4b-memory.test.ts"
    integration = "integration/test/m4b-memory-e2e.test.ts"
    plan = planner.plan_runner_contract(
        contract(
            pr=1498,
            workspace="@pacman/web",
            changedBrowserSpecPaths=[],
            changedUnitRegressionPaths=[unit],
            changedIntegrationPaths=[integration],
            changedTestHelperOrAssetPaths=[],
            requiredPaths=[unit, integration],
            pins={**contract()["pins"], "workspace": "@pacman/web"},
        )
    )
    commands = categories(plan)
    assert commands["browser"]["argv"] is None
    assert commands["browser"]["paths"] == []
    assert commands["unit"]["paths"] == [unit]
    assert commands["integration"]["paths"] == [integration]
    assert "playwright" not in json.dumps(commands["unit"]["argv"])
    assert "playwright" not in json.dumps(commands["integration"]["argv"])


def test_helper_and_snapshot_stay_out_of_the_product_patch():
    plan = planner.plan_runner_contract(
        contract(claimedProductPaths=["apps/web/src/board.tsx", HELPER, SNAPSHOT])
    )
    assert plan["blocked"] is True
    assert plan["commands"] == []
    assert HELPER not in plan["productPaths"]
    assert SNAPSHOT not in plan["productPaths"]


def test_pin_drift_blocks_planning():
    plan = planner.plan_runner_contract(
        contract(pins={**contract()["pins"], "workspace": "@pacman/web"})
    )
    assert plan["blocked"] is True
    assert plan["commands"] == []
    assert any("workspace" in blocker for blocker in plan["blockers"])


def test_missing_runtime_is_infrastructure_and_grants_no_credit():
    plan = planner.plan_runner_contract(
        contract(
            runtime={
                "browserAvailable": False,
                "dependenciesAvailable": False,
                "testsCollected": 0,
                "timedOut": True,
                "assertionFailure": True,
            }
        )
    )
    assert plan["failureKind"] == "infrastructure"
    assert plan["qualificationCredit"] == 0
    assert plan["qualifiedTask"] is False
    assert plan["verified"] is False


def test_metadata_and_a_claimed_pass_do_not_qualify_the_task():
    plan = planner.plan_runner_contract(
        contract(
            runtime={
                "browserAvailable": True,
                "dependenciesAvailable": True,
                "testsCollected": 4,
                "timedOut": False,
                "assertionFailure": False,
                "oraclePassed": True,
                "nullFailed": True,
            }
        )
    )
    assert plan["verified"] is False
    assert plan["qualificationCredit"] == 0
    assert plan["qualifiedTask"] is False
    assert plan["failureKind"] == "unverified"


def test_original_server_reuse_is_recorded_and_the_config_is_not_rewritten():
    plan = planner.plan_runner_contract(contract())
    runtime = plan["runtimeRequirements"]
    assert runtime["reuseExistingServer"] is True
    assert runtime["portGuard"] == "globalSetup"
    assert runtime["isolatedTrialRequired"] is True
    assert runtime["configText"] == CONFIG_TEXT
    assert runtime["buildMode"] == "fixture"
    assert plan["observations"]["egressProven"] is False
    assert "http://127.0.0.1:${PORT}" in plan["observations"]["urlExpressions"]
    assert "https://example.invalid/not-egress-proof" in plan["observations"]["urlExpressions"]


CONVERTER_SPEC = importlib.util.spec_from_file_location(
    "pr_to_task_selection", Path(__file__).with_name("pr-to-task.py")
)
converter = importlib.util.module_from_spec(CONVERTER_SPEC)
CONVERTER_SPEC.loader.exec_module(converter)

E2E_SPEC = "apps/web/e2e/skills-add-import.spec.ts"
E2E_REASON = "Contains Playwright or e2e tests"


def e2e_contract():
    return contract(
        pr=155,
        workspace="@pacman/web",
        changedBrowserSpecPaths=[E2E_SPEC],
        changedUnitRegressionPaths=[],
        changedIntegrationPaths=[],
        changedTestHelperOrAssetPaths=[],
        requiredPaths=[E2E_SPEC],
        pins={**contract()["pins"], "workspace": "@pacman/web"},
    )


def e2e_fields(**overrides):
    fields = dict(
        merged="2026-10-01T00:00:00Z",
        message="Closes #42",
        product_lines=30,
        paths=["apps/web/src/board.tsx", E2E_SPEC],
    )
    fields.update(overrides)
    return fields


def test_a_covering_plan_lifts_only_the_e2e_rejection_and_does_not_qualify():
    fields = e2e_fields()
    reason = converter.selection_reason(**fields)
    remaining = converter.selection_reason(**fields, ignore_e2e=True)
    assert reason == E2E_REASON
    assert remaining is None
    decision = planner.selection_after_plan(reason, fields["paths"], e2e_contract(), remaining)
    assert decision["reason"] is None
    assert decision["conversionAllowed"] is True
    assert decision["qualifiedTask"] is False
    assert decision["qualificationCredit"] == 0
    assert decision["verified"] is False


def test_a_partial_plan_keeps_the_e2e_rejection():
    fields = e2e_fields()
    reason = converter.selection_reason(**fields)
    partial = e2e_contract()
    partial["changedBrowserSpecPaths"] = []
    partial["requiredPaths"] = []
    decision = planner.selection_after_plan(reason, fields["paths"], partial, None)
    assert decision["conversionAllowed"] is False
    assert decision["reason"] == E2E_REASON
    assert decision["qualifiedTask"] is False
    assert E2E_SPEC in decision["missingPaths"]


def test_date_issue_surface_and_size_rules_survive_a_covering_plan():
    for overrides, expected in (
        (dict(product_lines=19), "Non-test diff outside 20-400 lines"),
        (dict(product_lines=401), "Non-test diff outside 20-400 lines"),
        (dict(message="Closes #42\nCloses #43"), "Requires exactly one closes #N issue reference"),
        (dict(merged="2026-06-30T00:00:00Z"), "Not merged on or after 2026-07-01"),
        (
            dict(paths=["integration/eval/a.ts", "a.test.ts", E2E_SPEC]),
            "Touches the evaluation surface",
        ),
    ):
        fields = e2e_fields(**overrides)
        reason = converter.selection_reason(**fields)
        remaining = converter.selection_reason(**fields, ignore_e2e=True)
        decision = planner.selection_after_plan(
            reason, fields["paths"], e2e_contract(), remaining
        )
        assert decision["conversionAllowed"] is False
        assert decision["qualifiedTask"] is False
        assert decision["qualificationCredit"] == 0
        assert expected in (decision["reason"], remaining)


def mixed_paths():
    return [*BROWSER_SPECS, *UNIT_SUITES, HELPER, SNAPSHOT, "apps/web/src/board.tsx"]


def test_helpers_and_snapshots_stay_out_of_the_product_patch():
    assert converter.is_test(SNAPSHOT) is False
    plan = planner.plan_runner_contract(contract())
    record = planner.unverified_partition(mixed_paths(), plan)
    assert record["blocked"] is False
    assert record["productPaths"] == ["apps/web/src/board.tsx"]
    trusted = {item["path"]: item for item in record["trustedInputs"]}
    assert trusted[HELPER]["role"] == "helper"
    assert trusted[SNAPSHOT]["role"] == "asset"
    assert HELPER in record["graderPaths"]
    assert SNAPSHOT in record["graderPaths"]
    assert BROWSER_SPECS[0] in record["graderPaths"]
    assert UNIT_SUITES[0] in record["graderPaths"]
    assert record["complete"] is False
    assert record["qualifiedTask"] is False
    assert record["qualificationCredit"] == 0
    assert record["verified"] is False
    categories = {command["category"]: command for command in record["commands"]}
    assert categories["browser"]["paths"] == BROWSER_SPECS
    assert categories["unit"]["paths"] == UNIT_SUITES


def test_an_unlisted_test_directory_file_does_not_become_product():
    plan = planner.plan_runner_contract(contract())
    paths = mixed_paths() + ["apps/web/test/i18n-extra.ts"]
    record = planner.unverified_partition(paths, plan)
    assert record["blocked"] is True
    assert record["productPaths"] == []
    assert record["graderPaths"] == []
    assert record["qualifiedTask"] is False
    assert record["complete"] is False
    assert "apps/web/test/i18n-extra.ts" in record["blockers"][0]


def test_supported_test_suffixes_outside_test_directories_do_not_become_product():
    plan = planner.plan_runner_contract(contract())
    for extra in (
        "apps/web/src/board.test.mjs",
        "apps/web/src/board.test.cjs",
        "apps/web/src/board.test.jsx",
        "apps/web/src/board.spec.js",
    ):
        record = planner.unverified_partition([*mixed_paths(), extra], plan)
        assert record["blocked"] is True
        assert record["productPaths"] == []
        assert extra in record["blockers"][0]


def test_integration_files_stay_grader_inputs_without_a_browser_command():
    unit = "apps/server/test/m4b-memory.test.ts"
    integration = "integration/test/m4b-memory-e2e.test.ts"
    plan = planner.plan_runner_contract(
        contract(
            pr=1498,
            workspace="@pacman/web",
            changedBrowserSpecPaths=[],
            changedUnitRegressionPaths=[unit],
            changedIntegrationPaths=[integration],
            changedTestHelperOrAssetPaths=[],
            requiredPaths=[unit, integration],
            pins={**contract()["pins"], "workspace": "@pacman/web"},
        )
    )
    record = planner.unverified_partition(
        [unit, integration, "apps/server/src/memory.ts"], plan
    )
    categories = {command["category"]: command for command in record["commands"]}
    assert record["blocked"] is False
    assert categories["browser"]["argv"] is None
    assert record["graderPaths"] == [unit, integration]
    assert record["productPaths"] == ["apps/server/src/memory.ts"]
    assert record["complete"] is False
    assert record["qualificationCredit"] == 0


def test_a_blocked_plan_emits_no_product_or_grader_paths():
    record = planner.unverified_partition(
        mixed_paths(), {"blocked": True, "commands": [], "trustedInputs": []}
    )
    assert record["blocked"] is True
    assert record["productPaths"] == []
    assert record["graderPaths"] == []
    assert record["complete"] is False
    assert record["qualifiedTask"] is False


def test_plan_is_deterministic_and_does_not_execute_the_config(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    first = planner.plan_runner_contract(contract())
    second = planner.plan_runner_contract(contract())
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert list(tmp_path.iterdir()) == []
    source = Path(planner.__file__).read_text()
    assert "importlib" not in source
    assert "subprocess" not in source
    assert "exec(" not in source
    assert "eval(" not in source
