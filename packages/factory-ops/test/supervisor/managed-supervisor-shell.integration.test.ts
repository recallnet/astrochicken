import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const hatchPath = join(repoRoot, "node_modules/.bin/hatch");
const shellGraphPath = join(repoRoot, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");

function runManagedShell({ mode = "active", controlAction = "none" } = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), "managed-supervisor-shell-run-"));
  const binDir = join(sandbox, "scripts", "bin");
  const sandboxFactoryRoot = join(sandbox, "factories", "brainstorm");
  const sandboxScenariosRoot = join(sandboxFactoryRoot, "scenarios", "brainstorm");
  const sandboxFactoryStateRoot = join(sandboxFactoryRoot, ".hatch");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(sandboxFactoryRoot, { recursive: true });
  mkdirSync(sandboxScenariosRoot, { recursive: true });
  mkdirSync(sandboxFactoryStateRoot, { recursive: true });

  const localShellGraphPath = join(sandbox, "managed_supervisor.dot");
  writeFileSync(localShellGraphPath, readFileSync(shellGraphPath, "utf8"));

  const domainGraphPath = join(sandbox, "domain.dot");
  writeFileSync(domainGraphPath, `digraph domain_mock {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  emit [type=\"tool\" governance=\"reversible\" output_key=\"domain_result\" prompt=\"printf '{\\\"dispatched\\\":${mode === "idle" ? "false" : "true"},\\\"mode\\\":\\\"${mode}\\\"}'\"]\n  start -> emit -> done\n}\n`);

  const kindPath = join(sandbox, "kind.json");
  const instancePath = join(sandbox, "instance.json");
  const factoryConfigPath = join(sandboxFactoryRoot, "factory.config.json");
  writeFileSync(kindPath, JSON.stringify({
    kind_id: "brainstorm",
    schema_version: 1,
    managed: true,
    execution_mode: "issues_only",
    shared_supervisor_shell: localShellGraphPath,
    domain_graph: domainGraphPath,
    supported_destinations: ["goal_issues"],
    required_labels: ["hatch:intake"],
  }, null, 2));
  writeFileSync(instancePath, JSON.stringify({
    instance_id: "fac_01TEST",
    kind_id: "brainstorm",
    target_repo: {
      provider: "github",
      repo_id: "R_kgDOExample",
      full_name: "example-org/brainstorm-lab",
    },
    control_plane_repo: "recallnet/astrochicken",
    intake: {
      issue_selector: { labels: ["hatch:intake"] },
    },
    destinations: {
      goal_issues: {
        repo: "recallnet/astrochicken",
        labels: ["goal", "source:brainstorm"],
      },
    },
  }, null, 2));
  writeFileSync(join(sandboxFactoryRoot, "kind.json"), readFileSync(kindPath, "utf8"));
  writeFileSync(join(sandboxFactoryStateRoot, "instance.json"), readFileSync(instancePath, "utf8"));
  writeFileSync(factoryConfigPath, JSON.stringify({
    factory_id: "brainstorm",
    kind_id: "brainstorm",
    instance_id: "fac_01TEST",
    canonical_checkout_path: sandbox,
    target_repo: "example-org/brainstorm-lab",
    control_plane_repo: "recallnet/astrochicken",
    trust_domain: "brainstorm.local",
    trust_role: "brainstorm.local.tool",
    runs_dir: join(sandbox, "runs"),
    dispatch: {
      graph: localShellGraphPath,
    },
    scenarios: {
      root: sandboxScenariosRoot,
    },
    domain_graph: domainGraphPath,
    intake: {
      issue_selector: {
        labels: ["hatch:intake"],
      },
    },
    repo_topology: {
      target_repo: "example-org/brainstorm-lab",
      control_plane_repo: "recallnet/astrochicken",
    },
    destinations: {
      goal_issues: {
        repo: "recallnet/astrochicken",
        labels: ["goal", "source:brainstorm"],
      },
    },
  }, null, 2));

  const hatchOpsPath = join(binDir, "hatch-ops");
  const ghPath = join(binDir, "gh");
  const hasIssue = mode === "idle" ? "false" : "true";

  writeFileSync(hatchOpsPath, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "brainstorm" ]]; then
  cmd="$2"
  shift 2
  case "$cmd" in
    intake-context)
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --intake-json) intake_json="$2"; shift 2 ;;
          --factory-id) shift 2 ;;
          --repo) shift 2 ;;
          --root-dir) shift 2 ;;
          *) shift ;;
        esac
      done
      if [[ "${mode}" == "idle" ]]; then
        echo '{"has_issue":"false","brainstorm_issue_number":"","brainstorm_issue_body":"","shipped_goals_since_last":"[]","open_backlog_summary":"{}","scenario_holdouts":"[]","parse_error":""}'
      else
        echo '{"has_issue":"true","brainstorm_issue_number":"1201","brainstorm_issue_body":"body","shipped_goals_since_last":"[]","open_backlog_summary":"{}","scenario_holdouts":"[]","parse_error":""}'
      fi
      ;;
    *)
      echo '{}'
      ;;
  esac
  exit 0
fi
if [[ "$1" != "supervisor" ]]; then
  echo '{}'
  exit 0
fi
cmd="$2"
shift 2
case "$cmd" in
  managed-load-context)
    cat <<JSON
{"manifest_ok":true,"manifest_error":"","factory_id":"brainstorm","factory_root":"factories/brainstorm","kind_path":"${kindPath}","instance_path":"${instancePath}","kind_id":"brainstorm","instance_id":"fac_01TEST","target_repo":"example-org/brainstorm-lab","control_plane_repo":"recallnet/astrochicken","domain_graph":"${domainGraphPath}","shared_supervisor_shell":"${localShellGraphPath}","destinations_json":"{\\"goal_issues\\":{}}","intake_json":"{\\"issue_selector\\":{\\"labels\\":[\\"hatch:intake\\"]}}","kind_context_json":"{\\"schema_version\\":1}","trust_domain":"brainstorm.local","trust_role":"brainstorm.local.tool"}
JSON
    ;;
  state-snapshot)
    if [[ "${mode}" == "blocked_local" ]]; then
      echo '{"action_items":[{"id":1}]}'
    else
      echo '{"action_items":[]}'
    fi
    ;;
  managed-control-gate)
    if [[ "${controlAction}" == "pause" ]]; then
      echo '{"control_gate":"paused","control_state_action":"pause","control_state_reason":"manual","should_run":false,"parse_error":"","state_path":"${sandbox}/control-state.json"}'
    else
      echo '{"control_gate":"run","control_state_action":"none","control_state_reason":"","should_run":true,"parse_error":"","state_path":"${sandbox}/control-state.json"}'
    fi
    ;;
  upstream-bug-gate)
    if [[ "${mode}" == "blocked_platform" ]]; then
      echo '{"has_open_upstream_bugs":true,"open_upstream_bug_count":1,"open_upstream_bug_numbers":[2116],"parse_error":""}'
    else
      echo '{"has_open_upstream_bugs":false,"open_upstream_bug_count":0,"open_upstream_bug_numbers":[],"parse_error":""}'
    fi
    ;;
  managed-action-item-gate)
    if [[ "${mode}" == "blocked_local" ]]; then
      echo '{"has_action_items":true,"action_item_count":1}'
    else
      echo '{"has_action_items":false,"action_item_count":0}'
    fi
    ;;
  managed-intake-selector)
    if [[ "${hasIssue}" == "true" ]]; then
      echo '{"has_issue":true,"selected_issue_number":"1201","selected_issue_title":"selected","selected_issue_body":"body","intake_json":"{}","parse_error":""}'
    else
      echo '{"has_issue":false,"selected_issue_number":"","selected_issue_title":"","selected_issue_body":"","intake_json":"{}","parse_error":""}'
    fi
    ;;
  managed-health-classifier)
    control_gate="run"
    has_open_upstream_bugs="false"
    has_action_items="false"
    has_selected_work="false"
    has_domain_failure="false"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --control-gate) control_gate="$2"; shift 2 ;;
        --has-open-upstream-bugs) has_open_upstream_bugs="$2"; shift 2 ;;
        --has-action-items) has_action_items="$2"; shift 2 ;;
        --has-selected-work) has_selected_work="$2"; shift 2 ;;
        --has-domain-failure) has_domain_failure="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    state="idle"
    if [[ "$control_gate" == "paused" ]]; then state="paused";
    elif [[ "$control_gate" == "draining" ]]; then state="draining";
    elif [[ "$has_open_upstream_bugs" == "true" ]]; then state="blocked_platform";
    elif [[ "$has_action_items" == "true" ]]; then state="blocked_local";
    elif [[ "$has_domain_failure" == "true" ]]; then state="degraded";
    elif [[ "$has_selected_work" == "true" ]]; then state="active";
    fi
    printf '{"lifecycle_state":"%s","health_state":"%s"}' "$state" "$state"
    ;;
  managed-failure-classifier)
    echo '{"failure_classification":"none","failure_reason":""}'
    ;;
  managed-persist-state)
    lifecycle_state=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --lifecycle-state) lifecycle_state="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    printf '{"ok":true,"state_path":"%s","state_version":3,"lifecycle_state":"%s","lifecycle_reason":"","lifecycle_failure_classification":"none","lifecycle_failure_reason":"","lifecycle_updated_at":"2026-03-15T22:00:00.000Z","blockers":{"upstream":{"has_open_upstream_bugs":false,"open_upstream_bug_count":0,"open_upstream_bug_numbers":[]},"action_items":{"has_action_items":false,"action_item_count":0}},"unresolved_actions":0,"queue_depth":0,"oldest_work_age_seconds":0,"latest_incidents":[]}' "${sandbox}/control-state.json" "$lifecycle_state"
    ;;
  managed-emit-run-summary)
    lifecycle_state="idle"
    failure_classification="none"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --lifecycle-state) lifecycle_state="$2"; shift 2 ;;
        --failure-classification) failure_classification="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    printf '{"schema_version":"managed_supervisor_run_summary/v1","factory_id":"brainstorm","instance_id":"fac_01TEST","kind_id":"brainstorm","lifecycle":{"state":"%s"},"failure":{"classification":"%s"},"managed_snapshot":{"schema_version":"managed-factory-snapshot/v1","lifecycle_state":"%s","lifecycle_reason":"","lifecycle_failure_classification":"%s","lifecycle_failure_reason":"","lifecycle_updated_at":"","lifecycle_updated_by":"","blockers":{"upstream":{"has_open_upstream_bugs":false,"open_upstream_bug_count":0,"open_upstream_bug_numbers":[]},"action_items":{"has_action_items":false,"action_item_count":0}},"unresolved_actions":0,"queue_depth":0,"oldest_work_age_seconds":0,"latest_incidents":[]},"telemetry":{"event_name":"factory.managed_supervisor.run_summary"}}' "$lifecycle_state" "$failure_classification" "$lifecycle_state" "$failure_classification"
    ;;
  *)
    echo '{}'
    ;;
esac
`, "utf8");
  chmodSync(hatchOpsPath, 0o755);

  writeFileSync(ghPath, `#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" != "issue" || "$2" != "list" ]]; then
  echo '[]'
  exit 0
fi

repo=""
labels=()
fields="number,title,body,url,labels"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo="$2"; shift 2 ;;
    --label) labels+=("$2"); shift 2 ;;
    --json) fields="$2"; shift 2 ;;
    *) shift ;;
  esac
done

joined_labels=",\$(IFS=,; echo \"\${labels[*]}\"),"

if [[ "$repo" == "recallnet/astrochicken" && "$joined_labels" == *",managed-factory-bug,"* && "$joined_labels" == *",kind:brainstorm,"* ]]; then
  if [[ "${mode}" == "blocked_platform" ]]; then
    printf '[{"number":2116,"title":"Managed factory blocker","body":"","labels":["managed-factory-bug","kind:brainstorm"]}]'
  else
    printf '[]'
  fi
  exit 0
fi

if [[ ( "$repo" == "example-org/brainstorm-lab" || "$repo" == "example-org/example-notes" || "$repo" == "recallnet/astrochicken" ) && "$joined_labels" == *",hatch:intake,"* ]]; then
  if [[ "${hasIssue}" == "true" ]]; then
    printf '[{"number":1201,"title":"selected","body":"body","url":"https://example.test/issues/1201","labels":["hatch:intake"]}]'
  else
    printf '[]'
  fi
  exit 0
fi

printf '[]'
`, "utf8");
  chmodSync(ghPath, 0o755);

  const run = spawnSync(hatchPath, [
    "run",
    localShellGraphPath,
    "--context",
    JSON.stringify({
      repo: sandbox,
      factory_id: "brainstorm",
      factory_root: sandboxFactoryRoot,
      kind_path: kindPath,
      instance_path: instancePath,
      kind_id: "brainstorm",
      instance_id: "fac_01TEST",
      target_repo: "example-org/brainstorm-lab",
      control_plane_repo: "recallnet/astrochicken",
      trust_domain: "brainstorm.local",
      trust_role: "brainstorm.local.tool",
      runs_dir: join(sandbox, "runs"),
      destinations_json: JSON.stringify({ goal_issues: { repo: "recallnet/astrochicken", labels: ["goal"] } }),
    }),
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      HATCH_FACTORY_ID: "brainstorm",
      HATCH_FACTORY_ROOT: sandboxFactoryRoot,
      HATCH_FACTORY_CONFIG_PATH: factoryConfigPath,
      HATCH_RUNS_DIR: join(sandbox, "runs"),
      HATCH_TARGET_REPO: "example-org/brainstorm-lab",
      HATCH_TARGET_REPO: "example-org/brainstorm-lab",
      FACTORY_REPO: sandbox,
    },
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const runIdMatch = String(run.stdout || "").match(/Run:\s+(\S+)/);
  assert.ok(runIdMatch, "expected hatch run id in output");
  const runId = runIdMatch[1];
  const localRunsStatePath = join(sandbox, "runs", runId, "state.json");
  const fallbackRunsStatePath = join(repoRoot, ".hatch", "mothership", "runs", runId, "state.json");
  const statePath = existsSync(localRunsStatePath) ? localRunsStatePath : fallbackRunsStatePath;
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  return { run, state };
}

test("managed shell run contract routes active through domain and emits summary", () => {
  const { state } = runManagedShell({ mode: "active" });
  assert.equal(state.status, "completed");
  const context = state.context || {};
  const records = Array.isArray(state.records) ? state.records : [];
  const executedNodes = records.map((entry) => String(entry?.nodeId || ""));
  assert.equal(context.lifecycle_state, "active", JSON.stringify({ context, executedNodes }));
  assert.equal(context.health_state, "active", JSON.stringify({ context, executedNodes }));
  assert.equal(context.manifest_ok, "true", JSON.stringify({ context, executedNodes }));
  assert.equal(context.has_issue, "true", JSON.stringify({ context, executedNodes }));
  assert.match(String(context.managed_run_summary || ""), /managed_supervisor_run_summary\/v1/);
  const managedSummary = JSON.parse(String(context.managed_run_summary || "{}"));
  assert.equal(managedSummary.managed_snapshot?.schema_version, "managed-factory-snapshot/v1");
});

test("managed shell run contract routes idle when no intake issue is selected", () => {
  const { state } = runManagedShell({ mode: "idle" });
  const context = state.context || {};
  assert.equal(context.lifecycle_state, "idle");
  assert.equal(context.has_issue, "false");
  const records = Array.isArray(state.records) ? state.records : [];
  const executedNodes = records.map((entry) => String(entry?.nodeId || ""));
  assert.ok(executedNodes.includes("persist_lifecycle_state"));
});

test("managed shell run contract routes blocked_platform before domain execution", () => {
  const { state } = runManagedShell({ mode: "blocked_platform" });
  const context = state.context || {};
  const records = Array.isArray(state.records) ? state.records : [];
  const executedNodes = records.map((entry) => String(entry?.nodeId || ""));
  assert.equal(context.lifecycle_state, "blocked_platform", JSON.stringify({ context, executedNodes }));
  assert.equal(context.has_open_upstream_bugs, "true", JSON.stringify({ context, executedNodes }));
  assert.ok(!executedNodes.includes("run_domain_graph"), "blocked platform path must not execute domain graph");
  assert.ok(executedNodes.includes("persist_lifecycle_state"), "blocked path must persist lifecycle state before summary");
});
