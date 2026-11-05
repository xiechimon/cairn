import importlib.util
import json
from pathlib import Path
import subprocess

import pytest


SCRIPT = Path(__file__).with_name("task-interface.mjs")


def extract(source, names):
    result = subprocess.run(
        ["node", str(SCRIPT)],
        input=json.dumps({"path": "src/api.ts", "source": source, "names": names}),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)["declarations"]


def test_only_requested_public_names_and_signatures_are_disclosed():
    result = extract(
        'export function publicApi(input: string) { return "secret answer"; }\n'
        'function internalHelper() { return 42; }',
        ["publicApi"],
    )
    assert result == "function publicApi(input: string): unknown;"
    assert "secret answer" not in result
    assert "internalHelper" not in result


def test_input_shapes_are_kept_but_literal_values_and_defaults_are_removed():
    result = extract(
        'interface Input { mode: "secret-mode"; count: 42; title?: string; }\n'
        'export function api(input: Input, retries = 123) { return input; }',
        ["api"],
    )
    assert "input: Input" in result
    assert "title?: string" in result
    assert "mode: string" in result
    assert "count: number" in result
    assert "retries?: unknown" in result
    assert "secret-mode" not in result
    assert "42" not in result
    assert "123" not in result


def test_class_private_members_and_method_bodies_are_not_disclosed():
    result = extract(
        'export class Worker { constructor(name: string) {} '
        'private hidden() {} protected secret() {} '
        'static make(input: string) { return "answer"; } '
        'run(flag?: boolean) { return 123; } }',
        ["Worker"],
    )
    assert "constructor(name: string)" in result
    assert "static make(input: string): unknown" in result
    assert "run(flag?: boolean): unknown" in result
    for value in ("hidden", "secret", "answer", "123"):
        assert value not in result


def test_constant_initializers_and_output_types_are_not_disclosed():
    result = extract(
        'export const key = "answer";\n'
        'export const api = (input: string): { output: "exact-output" } => ({output: "exact-output"});',
        ["key", "api"],
    )
    assert "const key: unknown" in result
    assert "function api(input: string): unknown" in result
    assert "exact-output" not in result
    assert "answer" not in result


def test_imports_are_reported_without_assertion_values_or_local_aliases():
    result = subprocess.run(
        ["node", str(SCRIPT)],
        input=json.dumps({
            "path": "test/api.test.ts",
            "source": 'import { api as call } from "../src/api.js"; expect(call()).toBe("secret answer");',
            "names": [],
        }),
        capture_output=True, text=True, check=True,
    )
    parsed = json.loads(result.stdout)
    assert parsed["imports"] == [{"path": "../src/api.js", "names": ["api"]}]
    assert parsed["declarations"] == ""
    assert parsed["assertionLiterals"] == ["secret answer"]


def test_boolean_literal_types_and_type_aliases_do_not_leak_expected_values():
    result = extract(
        'type Input = { enabled: true; mode: "answer" }; '
        'export function api(input: Input) {}', ["api"],
    )
    assert "enabled: boolean" in result
    assert "answer" not in result


def test_sections_resolve_relative_imports_and_omit_unrelated_modules():
    spec = importlib.util.spec_from_file_location("task_interface", SCRIPT.with_name("task_interface.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.interface_sections(
        {"src/api.ts": 'export function api(input: string) { return "answer"; }'},
        {"test/api.test.ts": 'import { api } from "../src/api.js"; import { describe } from "vitest";'},
    )
    assert "src/api.ts" in result
    assert "function api(input: string): unknown" in result
    assert "answer" not in result
    assert "vitest" not in result


def test_literal_leak_check_refuses_an_assertion_value_even_in_a_nested_type():
    spec = importlib.util.spec_from_file_location("task_interface", SCRIPT.with_name("task_interface.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with pytest.raises(ValueError, match="assertion literal"):
        module.require_no_assertion_literals('type Input = { value: "answer" };', {"answer"})


def test_type_queries_do_not_expose_internal_helpers():
    result = extract(
        'const hiddenHelper = () => "secret"; '
        'export function api(input: typeof hiddenHelper) {}', ["api"],
    )
    assert "hiddenHelper" not in result
    assert "input: unknown" in result


def test_parser_refuses_malformed_source_instead_of_emitting_partial_interfaces():
    result = subprocess.run(
        ["node", str(SCRIPT)],
        input=json.dumps({"path": "src/api.ts", "source": "export function api( {", "names": ["api"]}),
        capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "Invalid source syntax" in result.stderr


def test_parser_uses_the_source_extension_for_jsx():
    result = subprocess.run(
        ["node", str(SCRIPT)],
        input=json.dumps({"path": "src/view.tsx", "source": "export function View(title: string) { return <div>{title}</div>; }", "names": ["View"]}),
        capture_output=True, text=True, check=True,
    )
    assert "function View(title: string): unknown" in json.loads(result.stdout)["declarations"]


def test_untyped_object_binding_keeps_public_input_field_names():
    assert extract(
        'export function lookup({ repo, terms, paths, request, now }) {}',
        ["lookup"],
    ) == (
        "function lookup(input: { repo: unknown; terms: unknown; paths: unknown; "
        "request: unknown; now: unknown }): unknown;"
    )


def test_object_binding_aliases_expose_external_keys_without_local_names():
    result = extract(
        'export const api = ({ publicKey: localSecret, request: invokeHidden }) => localSecret;',
        ["api"],
    )
    assert result == "function api(input: { publicKey: unknown; request: unknown }): unknown;"
    assert "localSecret" not in result
    assert "invokeHidden" not in result


def test_object_binding_defaults_preserve_optionality_without_default_values():
    result = extract(
        'export function api({ required, optional = "secret-default", '
        'external: privateAlias = 123 } = {}) {}',
        ["api"],
    )
    assert result == (
        "function api(input?: { required: unknown; optional?: unknown; "
        "external?: unknown }): unknown;"
    )
    for forbidden in ("secret-default", "privateAlias", "123", " = "):
        assert forbidden not in result


def test_object_binding_does_not_infer_bodies_returns_or_private_helpers():
    result = extract(
        'function hiddenHelper() { return "helper-answer"; } '
        'export class Worker { '
        'constructor({ name, secret: localName = "constructor-answer" }) {} '
        'private hidden({ privateField }) {} '
        'run({ request }) : { output: "output-answer" } { '
        'const implementationOnly = request("body-answer"); '
        'return { output: "output-answer" }; } }',
        ["Worker"],
    )
    assert "constructor(input: { name: unknown; secret?: unknown });" in result
    assert "run(input: { request: unknown }): unknown;" in result
    for forbidden in (
        "hiddenHelper", "helper-answer", "localName", "constructor-answer",
        "privateField", "output", "output-answer", "implementationOnly", "body-answer",
    ):
        assert forbidden not in result


@pytest.mark.parametrize(
    "binding",
    [
        '{ ["computed-secret"]: local }',
        '{ first, ...rest }',
        '{ external: { nestedPrivate } }',
        '{ "quoted-secret": local }',
        '[first, second]',
    ],
)
def test_unsupported_binding_forms_stay_unknown(binding):
    assert extract(f"export function api({binding}) {{}}", ["api"]) == (
        "function api(input: unknown): unknown;"
    )


def test_typed_object_binding_keeps_existing_sanitized_input_type():
    result = extract(
        'type Input = { field: "literal-secret" }; '
        'export function api({ field: privateAlias }: Input) {}',
        ["api"],
    )
    assert "function api(input: Input): unknown;" in result
    assert "field: string" in result
    assert "privateAlias" not in result
    assert "literal-secret" not in result


def test_object_binding_sections_still_exclude_assertion_literals():
    spec = importlib.util.spec_from_file_location("task_interface", SCRIPT.with_name("task_interface.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.interface_sections(
        {"src/api.ts": 'export function api({ flag = "asserted-answer" }) { return "asserted-answer"; }'},
        {"test/api.test.ts": 'import { api } from "../src/api.js"; expect(api({})).toBe("asserted-answer");'},
    )
    assert "function api(input: { flag?: unknown }): unknown;" in result
    assert "asserted-answer" not in result

@pytest.fixture
def interface_module():
    spec = importlib.util.spec_from_file_location("task_interface", SCRIPT.with_name("task_interface.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_selective_star_reexport_exposes_only_test_imported_public_signature(interface_module):
    result = interface_module.interface_sections(
        {
            "src/index.ts": 'export * from "./api.js";',
            "src/api.ts": (
                'export function api(source: unknown): { value: "output-secret"; count: number } '
                '{ return { value: "output-secret", count: 42 }; } '
                'export function unrelated(privateInput: string) {} '
                'function hiddenHelper() { return "helper-secret"; }'
            ),
        },
        {"test/api.test.ts": 'import { api } from "../src/index.js";'},
    )
    assert "### `src/index.ts`" in result
    assert "Import path: `../src/index.js`" in result
    assert "function api(source: unknown): unknown;" in result
    for forbidden in ("unrelated", "privateInput", "hiddenHelper", "output-secret", "count", "42"):
        assert forbidden not in result


def test_named_reexport_alias_keeps_public_name_and_sanitized_inputs(interface_module):
    result = interface_module.interface_sections(
        {
            "src/index.ts": 'export { implementation as publicApi } from "./api.js";',
            "src/api.ts": (
                'interface Input { mode: "input-literal"; title?: string; } '
                'export function implementation(input: Input, retry = 123) { return "answer"; }'
            ),
        },
        {"test/api.test.ts": 'import { publicApi as call } from "../src/index.js";'},
    )
    assert "function publicApi(input: Input, retry?: unknown): unknown;" in result
    assert "mode: string" in result
    for forbidden in ("implementation", "input-literal", "123", "answer", "call("):
        assert forbidden not in result


def test_transitive_named_and_star_reexports_preserve_outer_public_name(interface_module):
    result = interface_module.interface_sections(
        {
            "src/index.ts": 'export { inner as publicApi } from "./middle.js";',
            "src/middle.ts": 'export * from "./api.js";',
            "src/api.ts": 'export const inner = ({ flag = "secret" }) => "output";',
        },
        {"test/api.test.ts": 'import { publicApi } from "../src/index.js";'},
    )
    assert "function publicApi(input: { flag?: unknown }): unknown;" in result
    for forbidden in ("inner", "middle.ts", "secret", "output"):
        assert forbidden not in result


@pytest.mark.parametrize(
    "sources",
    [
        {"src/index.ts": 'export * from "./api.js";', "src/api.ts": 'function api(value: string) {}'},
        {"src/index.ts": 'export * from "./api.js";', "src/api.ts": 'export default function api(value: string) {}'},
        {"src/index.ts": 'export { default as api } from "./api.js";', "src/api.ts": 'export default function hidden(value: string) {}'},
        {"src/index.ts": 'export * from "./absent.js";'},
        {"src/index.ts": 'export { api } from "unavailable-package";'},
        {"src/index.ts": 'export * from "./middle.js";', "src/middle.ts": 'export * from "./index.js";'},
        {"src/index.ts": 'export { api } from "./middle.js";', "src/middle.ts": 'export { api } from "./index.js";'},
        {
            "src/index.ts": 'export * from "./one.js"; export * from "./two.js";',
            "src/one.ts": 'export function api(one: string) {}',
            "src/two.ts": 'export function api(two: number) {}',
        },
        {
            "src/index.ts": 'export { api } from "./one.js"; export { api } from "./two.js";',
            "src/one.ts": 'export function api(one: string) {}',
            "src/two.ts": 'export function api(two: number) {}',
        },
        {
            "src/index.ts": 'export * from "./one.js"; export * from "./absent.js";',
            "src/one.ts": 'export function api(one: string) {}',
        },
        {"src/index.ts": 'export * as api from "./api.js";', "src/api.ts": 'export function inner(value: string) {}'},
        {
            "src/index.ts": 'export * from "./api.js";',
            "src/api.ts": 'export function api(value: string) {}',
            "src/api.js": 'export function api(value) {}',
        },
    ],
)
def test_unresolved_ambiguous_default_private_and_cyclic_exports_remain_unknown(interface_module, sources):
    assert interface_module.interface_sections(
        sources, {"test/api.test.ts": 'import { api } from "../src/index.js";'},
    ) == ""


def test_star_branch_without_requested_export_does_not_disclose_other_names(interface_module):
    result = interface_module.interface_sections(
        {
            "src/index.ts": 'export * from "./one.js"; export * from "./two.js";',
            "src/one.ts": 'export function api(value: string) {}',
            "src/two.ts": 'export function unrelated(other: number) {}',
        },
        {"test/api.test.ts": 'import { api } from "../src/index.js";'},
    )
    assert "function api(value: string): unknown;" in result
    assert "unrelated" not in result
    assert "other" not in result


def test_transitive_reexport_keeps_assertion_literal_guard(interface_module, monkeypatch):
    original = interface_module.parse_source

    def leaking_parser(path, source, names=(), **kwargs):
        result = original(path, source, names, **kwargs)
        if path == "src/api.ts" and names:
            result["declarations"] = 'function api(input: { value: "asserted-answer" }): unknown;'
        return result

    monkeypatch.setattr(interface_module, "parse_source", leaking_parser)
    with pytest.raises(ValueError, match="assertion literal"):
        interface_module.interface_sections(
            {
                "src/index.ts": 'export * from "./api.js";',
                "src/api.ts": 'export function api(input: string) { return "asserted-answer"; }',
            },
            {"test/api.test.ts": 'import { api } from "../src/index.js"; expect(api("input")).toBe("asserted-answer");'},
        )


@pytest.fixture
def export_task(tmp_path):
    def create(base_files, changed_files, paths):
        repo = tmp_path / "repo"
        repo.mkdir()

        def git(*args):
            return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()

        git("init")
        git("config", "user.name", "Fixture")
        git("config", "user.email", "fixture@example.com")
        for path, text in base_files.items():
            target = repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        git("add", *sorted(base_files))
        git("commit", "-m", "base")
        base = git("rev-parse", "HEAD")
        for path, text in changed_files.items():
            target = repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        git("add", *sorted(changed_files))
        git("commit", "-m", "change")
        head = git("rev-parse", "HEAD")
        task = tmp_path / "task"
        (task / "tests").mkdir(parents=True)
        (task / "tests/grader-paths.txt").write_text("test/api.test.ts\n")
        (task / "instruction.md").write_text("Implement the issue.\n")
        (task / "provenance.json").write_text(json.dumps({"baseSha": base, "headSha": head, "paths": paths}))
        return task, repo

    return create


def test_barrel_lazily_reads_only_reachable_unchanged_siblings(interface_module, export_task):
    task, repo = export_task(
        {
            "src/index.ts": "export const marker = 0;",
            "src/api.ts": 'export function api(value: string) { return "body-secret"; }',
            "src/unused.ts": 'export function unrelated(hidden: number) {}',
        },
        {"src/index.ts": 'export * from "./api.js";', "test/api.test.ts": 'import { api } from "../src/index.js";'},
        ["src/index.ts", "test/api.test.ts"],
    )
    text, evidence = interface_module.build_interface(task, repo)
    assert "Import path: `../src/index.js`" in text
    assert "function api(value: string): unknown;" in text
    assert "body-secret" not in text
    assert [item["path"] for item in evidence["additionalSources"]] == ["src/api.ts"]
    record = evidence["additionalSources"][0]
    assert record["headBlobSha"] == record["baseBlobSha"]
    assert "src/unused.ts" not in json.dumps(evidence)
    assert evidence["findings"] == []


def test_changed_sibling_outside_provenance_stays_unknown(interface_module, export_task):
    task, repo = export_task(
        {"src/index.ts": "export const marker = 0;", "src/api.ts": "export function api(value: string) {}"},
        {
            "src/index.ts": 'export * from "./api.js";',
            "src/api.ts": "export function api(secretValue: number) {}",
            "test/api.test.ts": 'import { api } from "../src/index.js";',
        },
        ["src/index.ts", "test/api.test.ts"],
    )
    text, evidence = interface_module.build_interface(task, repo)
    assert text == ""
    assert evidence["additionalSources"] == []
    assert any(item["reason"] == "changed-outside-provenance" and item["path"] == "src/api.ts" for item in evidence["refusedSources"])


def test_barrel_metadata_is_deterministic_and_add_interface_records_it(interface_module, export_task):
    task, repo = export_task(
        {"src/index.ts": "export const marker = 0;", "src/api.ts": "export function api(value: string) {}"},
        {"src/index.ts": 'export * from "./api.js";', "test/api.test.ts": 'import { api } from "../src/index.js";'},
        ["test/api.test.ts", "src/index.ts"],
    )
    first = interface_module.build_interface(task, repo)
    assert interface_module.build_interface(task, repo) == first
    assert interface_module.add_interface(task, repo)
    recorded = json.loads((task / "interface.provenance.json").read_text())
    assert recorded == first[1]
    assert interface_module.add_interface(task, repo)
    assert json.loads((task / "interface.provenance.json").read_text()) == recorded


def test_complete_73_module_graph_loads_70_verified_siblings(interface_module, export_task):
    base = {"src/index.ts": "export const marker = 0;"}
    root_exports = []
    for index in range(24):
        root_exports.append(f'export * from "./branch{index}/index.js";')
        base[f"src/branch{index}/index.ts"] = 'export * from "./one.js"; export * from "./two.js";'
        base[f"src/branch{index}/one.ts"] = (
            "export function api(source: unknown) { return 'body-secret'; }" if index == 0
            else f"export function unrelated{index}(value: number) {{}}"
        )
        base[f"src/branch{index}/two.ts"] = f"export function other{index}(value: string) {{}}"
    changed = {
        "src/index.ts": "\n".join(root_exports),
        "src/branch0/one.ts": "export function api(source: unknown) { return 'changed-body'; }",
        "src/branch0/two.ts": "export function other0(value: string) { return 'another-body'; }",
        "test/api.test.ts": 'import { api } from "../src/index.js"; expect(api(null)).toBe("changed-body");',
    }
    task, repo = export_task(base, changed, sorted(changed))
    text, evidence = interface_module.build_interface(task, repo)
    assert "function api(source: unknown): unknown;" in text
    assert len(evidence["resolutionSources"]) == 73
    assert len(evidence["additionalSources"]) == 70
    assert len(evidence["edges"]) == 72
    assert evidence["findings"] == []
    assert all(item["baseBlobSha"] == item["headBlobSha"] for item in evidence["additionalSources"])
    for forbidden in ("body-secret", "changed-body", "another-body", "unrelated", "other0"):
        assert forbidden not in text


def test_unchanged_nonprovenance_direct_import_does_not_expand_scope(interface_module, export_task):
    task, repo = export_task(
        {"src/index.ts": "export const marker = 0;", "src/api.ts": "export function api(value: string) {}"},
        {"src/index.ts": "export const marker = 1;", "test/api.test.ts": 'import { api } from "../src/api.js";'},
        ["src/index.ts", "test/api.test.ts"],
    )
    text, evidence = interface_module.build_interface(task, repo)
    assert text == ""
    assert evidence["additionalSources"] == []


def test_changed_exact_target_cannot_fall_through_to_unchanged_alternative(interface_module, export_task):
    task, repo = export_task(
        {
            "src/index.ts": "export const marker = 0;",
            "src/api.js": "export function api(original) {}",
            "src/api.ts": "export function api(unrelated: string) {}",
        },
        {
            "src/index.ts": 'export * from "./api.js";',
            "src/api.js": "export function api(changed) {}",
            "test/api.test.ts": 'import { api } from "../src/index.js";',
        },
        ["src/index.ts", "test/api.test.ts"],
    )
    text, evidence = interface_module.build_interface(task, repo)
    assert text == ""
    assert evidence["additionalSources"] == []
    assert any(item["reason"] == "unresolved-or-ambiguous-module" for item in evidence["findings"])
