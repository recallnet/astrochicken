# Factory runtime internals

## Context resolver mode derivation

`resolveFactoryContext(...)` now emits canonical mode metadata:

- `factory_mode`: `"standalone" | "managed"`
- `factory_mode_source`: deterministic provenance records

Mode resolution is centralized in `apps/hatch/src/factory/mode.ts` and applied by
`apps/hatch/src/factory/context-resolver.ts`.

Precedence (high -> low):

1. Explicit mode signals (`--factory-mode`, `HATCH_FACTORY_MODE|FACTORY_MODE`)
2. Checked-in managed overlays (`managed`, `kind_id`, `instance_id`, `destinations`, etc.)
3. Instance manifest signals (`.hatch/instance.json`)
4. Derived topology/destination hints
5. Fallback default (`standalone`)

Conflict handling is fail-closed at high precedence. If two high-precedence
signals disagree (for example `managed=false` + `kind_id`), context resolution
throws:

- `FACTORY_MODE_CONFLICT_ERROR_CODE` (`FACTORY_MODE_CONFLICT`)
- surfaced as `[factory-context:FACTORY_MODE_CONFLICT] ...`

Consumers should treat that as a startup blocker and require operators to align
checked-in mode signals before retrying.
