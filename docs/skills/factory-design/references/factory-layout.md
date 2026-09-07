---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-24"
status: "active"
summary: "Factory Layout and Config Reference."
tags: [docs, factory-design, reference, skill, skills]
written: "2026-03-06"
---
# Factory Layout and Config Reference

## Directory structure

A factory instance follows this layout:

```
<factory_root>/                       # e.g., factories/my-factory/
├── factory.config.json               # Capacity and behavior config
├── graphs/                           # DOT pipeline definitions
│   ├── supervisor_tick.dot           # Top-level outer loop (entrypoint)
│   ├── goal_run.dot                  # Goal decomposition pipeline
│   ├── work_execute.dot              # Batch execution pipeline
│   ├── work_item_execute.dot         # Single work item pipeline
│   └── <custom>.dot                  # Domain-specific subgraphs
├── skills/                           # LLM instruction documents
│   ├── supervisor/SKILL.md           # Supervisor role instructions
│   ├── code_review/SKILL.md          # Reviewer role instructions
│   └── <role>/SKILL.md              # One per LLM-driven role
├── ops/                              # Deterministic CLI commands
│   ├── package.json                  # Dependencies + bin entry
│   ├── src/
│   │   ├── cli.mjs                   # CLI entrypoint (tiny: build + run)
│   │   ├── cli/
│   │   │   ├── index.mjs             # CLI builder, argv normalization
│   │   │   └── commands/             # Domain-organized command files
│   │   │       ├── common.mjs        # Repo resolution, defaults, utilities
│   │   │       ├── goal.mjs          # Goal lifecycle commands
│   │   │       ├── wave.mjs          # Wave/batch commands
│   │   │       ├── supervisor.mjs    # Supervisor actions
│   │   │       └── <domain>.mjs      # Domain-specific commands
│   │   ├── commands/                  # Pure function implementations
│   │   │   ├── goal-list-ready.mjs
│   │   │   ├── wave-find-ready.mjs
│   │   │   └── ...
│   │   └── lib/                      # Shared utilities
│   │       ├── otel-stdout.mjs       # OTel event emitter
│   │       └── ...
│   └── test/                         # Unit + contract tests
│       ├── supervisor-tick-contract.test.mjs
│       ├── wave-*.test.mjs
│       └── ...
├── contexts/                         # Shared context templates (optional)
│   └── default.json                  # Default context values
└── scripts/                          # Operational scripts
    └── factory_supervisor_loop.sh    # Daemon wrapper (optional)
```

## factory.config.json

Capacity and behavior configuration:

```json
{
  "max_concurrent_waves": 3,
  "max_goal_runs_per_tick": 2,
  "max_issues_per_wave": 5,
  "review_max_attempts": 3,
  "review_quarantine_threshold": 2,
  "review_cooldown_hours": 6,
  "stale_run_minutes": 20
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `max_concurrent_waves` | number | 3 | Max parallel batch/wave executions |
| `max_goal_runs_per_tick` | number | 2 | Max goal decompositions per supervisor tick |
| `max_issues_per_wave` | number | 5 | Max work items per batch |
| `review_max_attempts` | number | 3 | Max review cycles before giving up |
| `review_quarantine_threshold` | number | 2 | Failures before quarantine |
| `review_cooldown_hours` | number | 6 | Hours in quarantine before retry |
| `stale_run_minutes` | number | 20 | Minutes before a run is considered stale/crashed |

Config values are resolved at runtime via ops commands:
```dot
resolve_config [type="tool" governance="reversible"
                label="Resolve factory config"
                output_format="json"
                outputs="max_concurrent_waves,max_issues_per_wave"
                prompt="node ops/cli.mjs common run --op resolve-factory-config --key 'max_concurrent_waves' --fallback '3'"]
```

## Topology configurations

### In-repo factory (simple)

Factory machinery lives in the same repo it operates on:

```json
{
  "factory_repo": "owner/repo",
  "target_repo": "owner/repo",
  "infra_issue_repo": "owner/repo",
  "entrypoint": "factories/my-factory/graphs/supervisor_tick.dot"
}
```

Everything in one place. Good for getting started.

### Separate infra factory (production)

Factory machinery in its own repo, operating on a target repo:

```json
{
  "factory_repo": "owner/factory-infra",
  "target_repo": "owner/product-repo",
  "infra_issue_repo": "owner/factory-infra",
  "entrypoint": "graphs/supervisor_tick.dot"
}
```

Factory bugs go to the infra repo. Product work goes to the target repo.
This prevents the factory from filing bugs against itself in the same
issue tracker as the work it's doing.

## State conventions

### GitHub-backed state (recommended)

| Entity | GitHub object | Key labels | Lifecycle |
|--------|--------------|------------|-----------|
| Goal | Issue | `goal`, `ready` | Open → decomposed into sub-issues → closed |
| Feature/work item | Issue | `feature`, `triaged` | Open → in-progress → closed |
| Bug | Issue | `bug` | Open → fixed → closed |

### Label taxonomy (starter set)

| Label | Color | Purpose |
|-------|-------|---------|
| `goal` | blue | Goal-type issue |
| `ready` | green | Eligible for processing |
| `feature` | purple | Work item from decomposition |
| `triaged` | teal | Work item triage completed |
| `bug` | red | Factory or product bug |
| `wave-in-progress` | orange | Wave currently executing |
| `quarantined` | gray | Review failures, cooling down |

### Run state (.hatch/runs/)

Ephemeral, local. Useful for debugging, not authoritative.

```
.hatch/runs/<run-id>/
├── state.json       # Context map + node records
├── metadata.json    # { "status": "running|completed|failed" }
├── sessions/        # Agent session artifacts
└── decisions/       # Guard circuit decisions
```

**Key fields in state.json:**
- `runId` — unique run identifier
- `status` — running, completed, failed
- `currentNode` — which node is executing
- `context` — accumulated key-value map (all `output_key` values)
- `records` — array of `{ nodeId, outcome: { status, output, error } }`

## Ops CLI architecture

The ops CLI provides deterministic commands for factory operations. Every command
that a tool node calls should live here — not as inline shell in DOT prompts.

### Command class pattern

```javascript
import { Command, Option } from "clipanion";

export class MyDomainCheckCommand extends Command {
  static paths = [["mydomain", "check"]];
  repo = Option.String("--repo", { required: true });

  async execute() {
    const { checkStatus } = await import("../../commands/mydomain-check.mjs");
    const result = checkStatus({ repo: this.repo });
    this.context.stdout.write(JSON.stringify(result));
    return 0;
  }
}

export const mydomainCommands = [MyDomainCheckCommand];
```

### Conventions
- Commands output JSON to stdout
- Errors go to stderr
- Return exit code (never `process.exit()`)
- Pure function implementations in `src/commands/`
- CLI wrappers in `src/cli/commands/`
- Use `await import()` for lazy loading

### DOT graph invocation

```dot
prompt="hatch-ops mydomain check --repo '${gh_repo}'"
```

Legacy `run --op <action>` forms are normalized to canonical `hatch-ops <domain> <action>` at runtime.

## Daemon / outer loop runner

For continuous factory operation, use the productized daemon wrapper:

```bash
nohup scripts/factory-daemon.sh <factory_id> > /dev/null 2>&1 &
```

This is the canonical supervisor loop entrypoint (for example `mothership`, `research`) and already handles PID ownership, log routing, stale-run recovery, and tick cadence.

For the full daemon contract (startup, lifecycle paths, and monitoring commands), see [Factory Supervisor Tick Reference](../../../factory-supervisor-tick.md).
