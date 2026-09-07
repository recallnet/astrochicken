---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-23"
status: "active"
summary: "Canonical factory health certification checklist and marker semantics for scaffolded factories."
tags: [docs, factory-design, health-check, skill, skills, template]
written: "2026-03-10"
---
# Factory Health Certification Checklist

Use this checklist to answer one operator question deterministically:
**"Is this factory operational before first live use?"**

Canonical command:

```bash
pnpm factory:health -- --factory-root factories/{{factory_id}}
```

Optional flags:
- `--skip-build` (use only when Hatch dist is already built in current workspace)
- `--skip-conformance` (wrapper/CLI checks only; does not certify conformance phases)
- `--json` (emit machine-readable summary to stdout)

## Required phase markers

`factory:health` emits deterministic stderr markers:

```text
factory_health phase=<phase> result=<ok|fail> detail=<message>
factory_health result=<ok|fail> failed_phase=<phase_or_empty>
```

Certification phases and intent:

1. `build_hatch`
   - Ensures runtime entrypoint is compiled before harness execution.
2. `config_schema`
   - Validates `factory.config.json` completeness and typed schema constraints.
3. `graph_validate`
   - Parses + validates supervisor graph contracts.
4. `dot_lint`
   - Enforces DOT lint contracts and policy rules.
5. `recovery_ownership`
   - Ensures reachable graph nodes have supervisor-owned recovery/sink metadata.
6. `run_dir_isolation`
   - Verifies runs directory is factory-scoped and not inside factory root.
7. `supervisor_tick_smoke`
   - Executes a smoke supervisor tick and checks run artifacts are emitted.
8. `ops_contract`
   - Verifies required ops CLI probes and JSON output contracts.

## Pass/fail interpretation

- **Operational pass** = all required phases emit `result=ok` and final line is:
  - `factory_health result=ok failed_phase=`
- **Operational fail** = first failing phase emits `result=fail` and final line is:
  - `factory_health result=fail failed_phase=<phase>`

On failure:
1. Fix the failing phase first.
2. Re-run the same canonical command.
3. Do not start first real supervisor tick/wave until command passes.

## CI contract guidance

CI should call the same command operators run locally:

```bash
pnpm factory:health -- --factory-root factories/{{factory_id}}
```

This keeps local operations, docs, and platform gates aligned on one certification surface.

## Related docs

- Factory spec template: [`factory-spec.md`](factory-spec.md)
- Evaluation hooks template: [`evaluation-hooks.md`](evaluation-hooks.md)
