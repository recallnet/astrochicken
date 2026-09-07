# Brainstorm factory graphs

Entrypoint graph:

```bash
hatch run factories/brainstorm/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs
```

Validation:

```bash
hatch validate factories/brainstorm/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs
node scripts/lint-dot.mjs factories/brainstorm/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs
```

This supervisor entrypoint is intentionally lean and shell-composed:

- resolve deterministic managed-factory context (`kind.json`, `instance.template.json`, trust/repo identity)
- invoke shared managed shell `packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs`
- let the shell own lifecycle/blockers/telemetry
- delegate domain logic to `factories/brainstorm/workflows/dispatch-control/domain_brainstorm.workflow-source.mjs`
