import hashlib
import re

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
