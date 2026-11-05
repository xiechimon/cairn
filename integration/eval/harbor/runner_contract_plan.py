import hashlib
import re
from pathlib import PurePosixPath

URL_PATTERN = re.compile(r"https?://[^\s`'\"<>]+")
BUILD_MODE_PATTERN = re.compile(r"--mode\s+([A-Za-z0-9_-]+)")
REUSE_SERVER_PATTERN = re.compile(r"reuseExistingServer\s*:\s*true")


def plan_runner_contract(contract):
    blockers = []
    pins = contract.get("pins") or {}
    for key in (
        "workspace",
        "packageManager",
        "playwright",
        "configSha256",
        "instructionSha256",
        "labelSha256",
    ):
        expected = pins.get(key)
        actual = contract.get(key)
        if expected is not None and expected != actual:
            blockers.append(f"{key} pin {expected} does not match {actual}")

    config_text = contract.get("configText") or ""
    if contract.get("configSha256"):
        actual_config = hashlib.sha256(config_text.encode()).hexdigest()
        if contract["configSha256"] != actual_config:
            blockers.append("configSha256 does not match the original config text")

    browser = list(contract.get("changedBrowserSpecPaths") or [])
    unit = list(contract.get("changedUnitRegressionPaths") or [])
    integration = list(contract.get("changedIntegrationPaths") or [])
    helpers = list(contract.get("changedTestHelperOrAssetPaths") or [])
    for path in browser:
        if "/e2e/" not in path or not path.endswith(".spec.ts"):
            blockers.append(f"ambiguous browser path: {path}")
    present = set(browser) | set(unit) | set(integration) | set(helpers)
    for path in contract.get("requiredPaths") or []:
        if path not in present:
            blockers.append(f"required path missing: {path}")

    digests = contract.get("trustedDigests") or {}
    trusted = []
    for path in helpers:
        role = "asset" if "snapshots" in path or path.endswith((".png", ".jpg", ".webp")) else "helper"
        sha = digests.get(path)
        if not sha:
            blockers.append(f"missing digest for trusted input: {path}")
        trusted.append({"path": path, "role": role, "sha256": sha or ""})
    if contract.get("configSha256"):
        trusted.append(
            {
                "path": "apps/web/playwright.config.ts",
                "role": "config",
                "sha256": contract["configSha256"],
            }
        )

    trusted_paths = {item["path"] for item in trusted} | set(browser) | set(unit) | set(integration)
    claimed = list(contract.get("claimedProductPaths") or [])
    leaked = [path for path in claimed if path in trusted_paths]
    if leaked:
        blockers.append(
            "product paths include trusted grading inputs: " + ", ".join(leaked)
        )
    product = [path for path in claimed if path not in leaked]

    commands = _commands(contract.get("workspace"), browser, unit, integration)
    runtime = contract.get("runtime") or {}
    if not runtime:
        failure_kind = "unverified"
    elif (
        runtime.get("browserAvailable") is False
        or runtime.get("dependenciesAvailable") is False
        or runtime.get("testsCollected") == 0
        or runtime.get("timedOut") is True
    ):
        failure_kind = "infrastructure"
    else:
        failure_kind = "unverified"

    blocked = bool(blockers)
    return {
        "pr": contract.get("pr"),
        "blocked": blocked,
        "blockers": blockers,
        "commands": [] if blocked else commands,
        "trustedInputs": trusted,
        "productPaths": product,
        "verified": False,
        "qualificationCredit": 0,
        "qualifiedTask": False,
        "failureKind": failure_kind,
        "runtimeRequirements": {
            "reuseExistingServer": REUSE_SERVER_PATTERN.search(config_text) is not None,
            "portGuard": _port_guard(config_text),
            "isolatedTrialRequired": True,
            "configText": config_text,
            "buildMode": _build_mode(config_text),
            "browserLaunchVerified": False,
            "dependenciesProvisioned": False,
            "packageManager": contract.get("packageManager"),
            "workspace": contract.get("workspace"),
            "playwright": contract.get("playwright"),
        },
        "observations": {
            "egressProven": False,
            "urlExpressions": URL_PATTERN.findall(config_text),
        },
    }


def _commands(workspace, browser, unit, integration):
    commands = [
        {
            "category": "browser",
            "framework": "playwright",
            "cwd": "repository root",
            "argv": _browser_argv(workspace, browser) if browser else None,
            "paths": list(browser),
            "executed": False,
        }
    ]
    if unit:
        commands.append(_vitest("unit", unit))
    if integration:
        commands.append(_vitest("integration", integration))
    return commands


def _browser_argv(workspace, browser):
    relative = [path.removeprefix("apps/web/") for path in browser]
    return ["pnpm", "--filter", workspace, "exec", "playwright", "test", *relative]


def _vitest(category, paths):
    return {
        "category": category,
        "framework": "vitest",
        "cwd": "repository root",
        "argv": ["pnpm", "exec", "vitest", "run", *paths],
        "paths": list(paths),
        "executed": False,
    }


def _port_guard(config_text):
    if "globalSetup" in config_text:
        return "globalSetup"
    if "E2E_PORT" in config_text:
        return "E2E_PORT"
    return None


def _build_mode(config_text):
    match = BUILD_MODE_PATTERN.search(config_text)
    if match is None:
        return None
    return match.group(1)


E2E_REJECTION = "Contains Playwright or e2e tests"


def selection_after_plan(reason, paths, contract, reason_without_e2e):
    plan = (
        plan_runner_contract(contract)
        if isinstance(contract, dict)
        else {
            "blocked": True,
            "commands": [],
            "trustedInputs": [],
            "blockers": ["runner contract required"],
        }
    )
    decision = {
        "reason": reason,
        "qualifiedTask": False,
        "qualificationCredit": 0,
        "verified": False,
        "conversionAllowed": False,
        "missingPaths": [],
        "plan": plan,
    }
    if reason != E2E_REJECTION:
        return decision
    if reason_without_e2e:
        decision["reason"] = reason_without_e2e
        return decision
    missing = [path for path in paths if _grading_path(path) and path not in _covered_paths(plan)]
    decision["missingPaths"] = missing
    if plan.get("blocked") or missing:
        return decision
    decision["reason"] = None
    decision["conversionAllowed"] = True
    return decision


def _grading_path(path):
    return (
        "/e2e/" in f"/{path}"
        or "e2e.test." in path
        or path.endswith((".test.ts", ".test.tsx", ".test.js", ".spec.ts", ".spec.tsx"))
        or "snapshots" in path
        or path.endswith((".png", ".jpg", ".webp"))
    )


def unverified_partition(paths, plan):
    record = {
        "blocked": True,
        "blockers": ["runner plan is blocked"],
        "productPaths": [],
        "graderPaths": [],
        "commands": [],
        "trustedInputs": [],
        "complete": False,
        "qualifiedTask": False,
        "qualificationCredit": 0,
        "verified": False,
    }
    if not isinstance(plan, dict) or plan.get("blocked"):
        return record
    trusted = {
        item["path"]: item
        for item in plan.get("trustedInputs") or []
        if item.get("role") in ("helper", "asset", "config")
    }
    command_paths = []
    for command in plan.get("commands") or []:
        command_paths.extend(command.get("paths") or [])
    command_set = set(command_paths)
    blockers = []
    grader = []
    product = []
    for path in paths:
        if path in trusted or path in command_set:
            grader.append(path)
        elif _looks_like_grading_material(path):
            blockers.append(f"unclassified grading path: {path}")
        else:
            product.append(path)
    for path in command_paths:
        if path not in grader:
            blockers.append(f"command path missing from grader inputs: {path}")
    if blockers:
        record["blockers"] = blockers
        return record
    record.update(
        blocked=False,
        blockers=[],
        productPaths=product,
        graderPaths=grader,
        commands=list(plan.get("commands") or []),
        trustedInputs=[
            item
            for item in plan.get("trustedInputs") or []
            if item.get("role") in ("helper", "asset", "config")
        ],
    )
    return record


def _looks_like_grading_material(path):
    if _grading_path(path):
        return True
    parts = PurePosixPath(path).parts
    return any(part in ("test", "tests", "__tests__", "e2e", "fixtures") for part in parts)


def bind_frozen_issue(partition, issue):
    blank = {
        "blocked": True,
        "blockers": ["unverified partition is blocked"],
        "instruction": "",
        "issueBody": "",
        "productPaths": [],
        "graderPaths": [],
        "commands": [],
        "trustedInputs": [],
        "complete": False,
        "qualifiedTask": False,
        "qualificationCredit": 0,
        "verified": False,
        "labelSha256": "",
    }
    if not isinstance(partition, dict) or partition.get("blocked"):
        return blank
    if not isinstance(issue, dict) or "latestBody" in issue:
        blank["blockers"] = ["latest issue text is not a frozen snapshot"]
        return blank
    body = issue.get("body")
    if not isinstance(body, str):
        blank["blockers"] = ["frozen issue body is missing"]
        return blank
    if hashlib.sha256(body.encode()).hexdigest() != issue.get("bodySha256"):
        blank["blockers"] = ["issue body does not match the frozen snapshot"]
        return blank
    if not _sha256_text(issue.get("labelSha256")):
        blank["blockers"] = ["frozen label binding is missing"]
        return blank
    instruction = (
        f"# Issue {issue.get('number')}\n\n"
        f"Base revision: `{issue.get('baseSha')}`\n\n"
        + (body if body.endswith("\n") else body + "\n")
    )
    if hashlib.sha256(instruction.encode()).hexdigest() != issue.get("promptSha256"):
        blank["blockers"] = ["prompt does not match the frozen issue snapshot"]
        return blank
    blank.update(
        blocked=False,
        blockers=[],
        instruction=instruction,
        issueBody=body,
        productPaths=list(partition.get("productPaths") or []),
        graderPaths=list(partition.get("graderPaths") or []),
        commands=list(partition.get("commands") or []),
        trustedInputs=list(partition.get("trustedInputs") or []),
        labelSha256=issue["labelSha256"],
    )
    return blank


def _sha256_text(value):
    return isinstance(value, str) and len(value) == 64 and all(
        character in "0123456789abcdef" for character in value
    )


def _covered_paths(plan):
    covered = set()
    for command in plan.get("commands") or []:
        covered.update(command.get("paths") or [])
    for item in plan.get("trustedInputs") or []:
        if item.get("role") in ("helper", "asset"):
            covered.add(item["path"])
    return covered
