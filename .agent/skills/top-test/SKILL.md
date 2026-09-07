---
name: top-test
description: Find and fix the single highest-ROI quality improvement in the codebase. Use this skill whenever the user says "/top-test", "improve quality", "find untested code", "what needs tests", or wants autonomous quality improvement. Each invocation picks ONE thing, does it well, and ratchets so it can't regress. Never declares "converged" — there's always something to improve.
---

# Top Test — Highest-ROI Quality Improvement

Find the single most valuable quality improvement in the codebase, fix it, and ratchet so it can't regress. One bite per invocation.

**CRITICAL: Never say "no gaps found" or "loop converged."** There is ALWAYS something to improve in a living codebase. If the obvious checklist items are done, dig deeper — fix pre-commit/push blockers, improve error messages, add missing docs, write deeper integration tests, refactor complex modules, fix CI drift, or tackle tech debt. Use your judgment as an engineer, not just a checklist runner.

## What to Improve (Ordered by Typical ROI)

### Tier 1: Blockers & Broken Things

Things that are actively preventing work or shipping:

- **Failing pre-commit, pre-push, or pre-merge gates** — If `git commit` or `git push` fails on valid code, fix it. Contract drift (docs freshness, workflow-IR conformance, active-surface manifests) is always #1 priority.
- **Build errors or type errors** on main branch — `pnpm turbo run build` or `pnpm turbo run typecheck` failing.
- **Flaky or broken tests** — Tests that fail intermittently or are skipped with TODO notes.

### Tier 2: Tests & Coverage

The core of what this skill does most often:

- **Critical-path runtime code with coverage gaps** — Pipeline engine, action registries, context resolution, handler dispatch, graph parsing. Code where a bug means factory-wide failure. Check `apps/hatch/src/pipeline/` for any module with 0 test files but >50 lines of logic.
- **Factory-ops command modules with zero tests** — `packages/factory-ops/src/commands/` contains deterministic action owners. Any command without a corresponding test in `packages/factory-ops/test/commands/` is a gap worth filling.
- **Factory-ops lib modules with zero tests** — `packages/factory-ops/src/lib/` contains foundational shared logic (error catalog, packet core, repo identity, verdict envelope, control-plane blocker). These cascade everywhere.
- **Gate/contract scripts without tests** — `scripts/check-*.mjs` and `scripts/lib/*.mjs` enforce fail-closed QA gates. A gate without its own tests can silently pass invalid state.
- **Shared packages with zero tests** — Foundation packages imported by many consumers (`factory-telemetry`, `github-adapter`, `factory-core`). A bug here cascades.
- **Capability packages with missing handler/action tests** — `packages/capability-*/` each contain action owners and graph bindings.
- **Deep coverage for important modules** — Don't stop at surface-level tests. Push key modules toward comprehensive edge case, error path, and boundary condition coverage.

Tests that are NOT high-ROI: type-only files, barrel exports, generated JSON contracts, config files, one-line re-exports, DOT graph files, prompt markdown files.

### Tier 3: Documentation

- **Stale docs** — `pnpm docs:freshness` failures. Docs with `reviewed` dates older than their `review_policy` period. Refresh the date or delete obsolete docs.
- **Factory/package READMEs** — Packages or factories without README.md or with stub-only READMEs.
- **INTENT.md accuracy** — Factory intent documents that don't match actual factory behavior.

### Tier 4: Pre-Commit Gate Health

The pre-commit contract suite must stay green. Common drift sources:

- **Workflow-IR conformance** — New or modified DOT graphs need PNG siblings and workflow-IR registry entries. Use `renderDotToPng` from `scripts/lib/workflow-diagram-png.ts` and `writeWorkflowIrParityOutputs` from `scripts/lib/workflow-ir-parity-contract.ts`.
- **Active-surface manifest drift** — New test files in unusual locations need their prefix added to `config/testing/topology-enforcement.json`.
- **Legacy pattern inventory** — `scripts/check-legacy-pattern-zero-inventory.mjs --write` to reconcile governance counters after structural changes.
- **Docs freshness** — Stale `reviewed` dates on periodic-review docs.

### Tier 5: Refactoring & Simplification

- **Large files with separable concerns** — Files >500 lines often contain multiple responsibilities that could be split.
- **Duplicated patterns across commands** — Logic that appears in multiple factory-ops commands but isn't in a shared lib function.
- **Dead code** — Unused exports, stale feature flags, commented-out code. If it's unused, delete it.
- **Handwritten DOT files for migrated families** — If a workflow-source exists for a DOT graph, the handwritten DOT should not exist. Delete it.

### Tier 6: DX & Maintenance

- **Slow builds** — Investigate turbo cache misses, unnecessary rebuilds.
- **Dependency issues** — Outdated deps, circular imports, unnecessary peer deps.
- **Tech debt** tracked in GitHub issues but not yet addressed.

## Execution Flow

### Phase 1: Discover the Target

Think like an engineer, not a checklist runner. Start with:

1. **Check for blockers first** — Run `git status`, check for pre-commit/pre-push failures, build errors, or contract drift. If something is broken, fix it before adding new things.

2. **Run the automated scans** to find test gaps:

   ```bash
   # Factory-ops commands without tests
   for cmd in packages/factory-ops/src/commands/*.mjs; do
     name=$(basename "$cmd" .mjs)
     tests=$(find packages/factory-ops/test -name "${name}*test*" 2>/dev/null | wc -l | tr -d ' ')
     if [ "$tests" -eq 0 ]; then
       lines=$(wc -l < "$cmd" | tr -d ' ')
       echo "GAP: $name — $lines lines, 0 tests"
     fi
   done

   # Factory-ops lib modules without tests
   for lib in packages/factory-ops/src/lib/*.mjs; do
     name=$(basename "$lib" .mjs)
     tests=$(find packages/factory-ops -name "${name}*test*" 2>/dev/null | wc -l | tr -d ' ')
     if [ "$tests" -eq 0 ]; then
       lines=$(wc -l < "$lib" | tr -d ' ')
       [ "$lines" -gt 50 ] && echo "GAP: lib/$name — $lines lines, 0 tests"
     fi
   done

   # Gate scripts without tests
   for gate in scripts/check-*.mjs; do
     name=$(basename "$gate" .mjs)
     tests=$(find scripts -name "${name}*test*" 2>/dev/null | wc -l | tr -d ' ')
     if [ "$tests" -eq 0 ]; then
       lines=$(wc -l < "$gate" | tr -d ' ')
       echo "GAP: $name — $lines lines, 0 tests"
     fi
   done

   # Packages with zero or minimal tests
   for pkg in packages/*/; do
     name=$(basename "$pkg")
     tests=$(find "$pkg" -name "*.test.*" -not -path "*/node_modules/*" 2>/dev/null | wc -l | tr -d ' ')
     sources=$(find "$pkg/src" -name "*.ts" -o -name "*.mjs" | grep -v test | grep -v node_modules 2>/dev/null | wc -l | tr -d ' ')
     if [ "$sources" -gt 2 ] && [ "$tests" -lt 2 ]; then
       echo "GAP: $name — $tests tests / $sources source files"
     fi
   done

   # Untested Hatch runtime modules
   for src in apps/hatch/src/pipeline/*.ts apps/hatch/src/dispatch/*.ts; do
     [ -f "$src" ] || continue
     name=$(basename "$src" .ts)
     echo "$name" | grep -qE '\.(test|contract\.test|integration\.test|unit\.test)$' && continue
     tests=$(find apps/hatch/src -name "${name}*test*" 2>/dev/null | wc -l | tr -d ' ')
     if [ "$tests" -eq 0 ]; then
       lines=$(wc -l < "$src" | tr -d ' ')
       [ "$lines" -gt 50 ] && echo "GAP: hatch/$name — $lines lines, 0 tests"
     fi
   done
   ```

3. **If automated scans find nothing, dig deeper:**
   - Is there a pre-commit or pre-push blocker? Contract drift?
   - Are there packages where test quality could improve (more edge cases, deeper coverage)?
   - Are there stale docs, missing READMEs, or dead code?
   - Could a complex module be refactored to reduce complexity?
   - Are there handwritten DOT files that should be generated?

**Pick ONE target and do it.**

### Phase 2: Fix It

For **test gaps**, spawn a worktree agent with clear instructions:

- The exact target (file paths, module names)
- The source code of the target (read it first and include key sections)
- The testing conventions (see below)
- Where to put the test files
- Instruction to run tests and verify they pass before finishing

**Testing conventions for this repo:**

- Hatch runtime (vitest): `import { describe, it, expect } from "vitest"` — test files go alongside source as `<name>.unit.test.ts`
- Factory-ops / lib (node:test): `import { describe, it } from "node:test"; import assert from "node:assert/strict"` — test files go in `packages/factory-ops/test/commands/`
- Capability packages (node:test): test files go in `packages/<capability>/test/`
- GitHub adapter (node:test): test files go in `packages/github-adapter/test/`
- Gate scripts (node:test): test files go as `scripts/<gate-name>.unit.test.mjs`
- No mocks of production code. Stub external dependencies via dependency injection.
- Each test should have a clear name describing the behavior it proves

Spawn with `isolation: "worktree"` so the agent works on an isolated copy.

For **blockers and drift fixes**, do it directly — no worktree needed.

For **docs**, do it directly.

### Phase 3: Code Review Gate (tests only)

After the worktree agent finishes, evaluate the work:

**REJECT if:**
- Tests are trivial (checking that a function exists, or that true === true)
- Tests mock so heavily they don't prove anything about real behavior
- Tests are brittle (hardcoded to implementation details)
- Tests don't actually run

**APPROVE if:**
- Tests prove real behavior that wasn't previously covered
- Tests document important invariants
- Tests would catch actual bugs if the code regressed

If borderline, fast-track for pure functions with no mocking. Run a full review agent for complex modules with DI or vitest mocks.

### Phase 4: Commit and Ratchet

1. Copy from worktree, verify tests pass on main
2. Stage and commit with descriptive message
3. If applicable, **ratchet** — add the test file's prefix to `config/testing/topology-enforcement.json` if it's in a new location
4. If a new package gets its first test, register its test prefix in topology enforcement

## Important Constraints

- **One target per invocation.** Pick the best gap, fix it, ship it.
- **Always ratchet.** Every fix should make regression harder.
- **Never say "converged" or "nothing to do."** There's always something. Dig deeper.
- **Blockers first.** If something is broken, fix it before adding new things.
- **Don't test implementation, test behavior.** "When I call X with Y, I get Z" — not "X calls private method _foo 3 times."
- **TDD mindset.** Tests should document what the code promises, not just exercise it.
- **The review gate is real.** If the reviewer rejects, don't force it through.
