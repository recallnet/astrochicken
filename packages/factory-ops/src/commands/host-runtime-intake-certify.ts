import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listHostInstallations, resolveHostRuntimePaths } from "./host-runtime-lifecycle.ts";
import { ghJson, parseJson, trim } from "../lib/cli-helpers.ts";
import { findRegistryInstanceRow, loadFactoryRegistry } from "../lib/factory-registry.ts";
import { resolveDestinationRoute } from "../lib/factory-repo-identity.ts";

function normalizeIssueNumber(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return String(Math.trunc(parsed));
}

function parseGithubIssueUrl(url = "") {
  const match = String(url || "").trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/i);
  if (!match) {
    return {
      repo: "",
      issue_number: "",
    };
  }

  return {
    repo: `${match[1]}/${match[2]}`.toLowerCase(),
    issue_number: String(match[3]),
  };
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function buildInvariant({ id = "", ok = false, expected = {}, actual = {}, message = "" } = {}) {
  return {
    id: trim(id),
    ok: Boolean(ok),
    expected: toRecord(expected),
    actual: toRecord(actual),
    message: trim(message) || (ok ? "pass" : "failed"),
  };
}

function extractRunContext(state = {}) {
  const context = toRecord(state?.context);
  const domainResultRaw = context.domain_result;
  const domainResult = typeof domainResultRaw === "string"
    ? toRecord(parseJson(domainResultRaw, {}))
    : toRecord(domainResultRaw);

  const brainstormIssueNumber = normalizeIssueNumber(
    context.brainstorm_issue_number
    || domainResult.brainstorm_issue_number,
  );

  const goalIssueNumber = normalizeIssueNumber(
    context.goal_issue_number
    || domainResult.goal_issue_number,
  );

  const goalIssueUrl = trim(
    context.goal_issue_url
    || domainResult.goal_issue_url,
  );

  return {
    brainstorm_issue_number: brainstormIssueNumber,
    goal_issue_number: goalIssueNumber,
    goal_issue_url: goalIssueUrl,
    state_status: trim(state?.status),
    state_current_node: trim(state?.currentNode),
  };
}

function readRunState({ manifestPath = "", runId = "", existsSyncFn = existsSync, readFileSyncFn = readFileSync } = {}) {
  const runDir = path.resolve(path.dirname(trim(manifestPath)), "runs", trim(runId));
  const statePath = path.resolve(runDir, "state.json");
  if (!existsSyncFn(statePath)) {
    return {
      run_dir: runDir,
      state_path: statePath,
      state: {},
      parse_error: "state_missing",
    };
  }

  try {
    const parsed = parseJson(readFileSyncFn(statePath, "utf8"), null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        run_dir: runDir,
        state_path: statePath,
        state: {},
        parse_error: "state_malformed",
      };
    }
    return {
      run_dir: runDir,
      state_path: statePath,
      state: parsed,
      parse_error: "",
    };
  } catch (error) {
    return {
      run_dir: runDir,
      state_path: statePath,
      state: {},
      parse_error: `state_read_failed:${trim(error?.message || error)}`,
    };
  }
}

function resolveHostRuntimeEntrypoint() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "host-runtime.ts");
}

function runHostRuntimeOnce({
  hostBaseDir = "",
  repoRoot = ".",
  registryPath = "",
  registryCwd = "",
  spawnSyncFn = spawnSync,
} = {}) {
  const args = [
    resolveHostRuntimeEntrypoint(),
    "run",
    "--host-base-dir",
    hostBaseDir,
    "--repo-root",
    repoRoot,
    "--once",
  ];

  const env = {
    ...process.env,
  };

  const normalizedRegistryPath = trim(registryPath);
  const normalizedRegistryCwd = trim(registryCwd);
  if (normalizedRegistryPath) env.HATCH_FACTORY_REGISTRY_PATH = normalizedRegistryPath;
  if (normalizedRegistryCwd) env.HATCH_FACTORY_REGISTRY_CWD = normalizedRegistryCwd;

  const run = spawnSyncFn(process.execPath, args, {
    encoding: "utf8",
    env,
  });

  const stdout = trim(run.stdout);
  const parsed = parseJson(stdout, null);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      status: "host_runtime_command_failed",
      error: `host_runtime_output_invalid:exit=${Number(run.status) || 1}`,
      exit_code: Number(run.status) || 1,
      stderr: trim(run.stderr),
      stdout,
      payload: {},
    };
  }

  return {
    ok: Number(run.status) === 0,
    status: trim(parsed.status) || (Number(run.status) === 0 ? "ok" : "host_runtime_command_failed"),
    error: Number(run.status) === 0 ? "" : trim(parsed.message || run.stderr || "host_runtime_once_failed"),
    exit_code: Number(run.status) || 0,
    stderr: trim(run.stderr),
    stdout,
    payload: parsed,
  };
}

function selectExecutionResult({ payload = {}, installationId = "", instanceId = "", intakeIssueNumber = "", manifestPath = "", existsSyncFn = existsSync, readFileSyncFn = readFileSync } = {}) {
  const executionResults = Array.isArray(payload?.execution_results)
    ? payload.execution_results
    : [];

  const matching = executionResults.filter((entry) => {
    const entryInstallationId = trim(entry?.installation_id);
    const entryInstanceId = trim(entry?.instance_id);
    if (entryInstallationId && installationId && entryInstallationId !== installationId) return false;
    if (entryInstanceId && instanceId && entryInstanceId !== instanceId) return false;
    return true;
  });

  const evaluated = matching.map((entry) => {
    const runId = trim(entry?.run_id);
    const runState = runId
      ? readRunState({
        manifestPath,
        runId,
        existsSyncFn,
        readFileSyncFn,
      })
      : {
        run_dir: "",
        state_path: "",
        state: {},
        parse_error: "run_id_missing",
      };

    const context = extractRunContext(runState.state);
    return {
      entry,
      run_state: runState,
      context,
      issue_matches: context.brainstorm_issue_number === intakeIssueNumber,
    };
  });

  const byIssue = evaluated.find((candidate) => candidate.issue_matches);
  const fallback = evaluated[0] || null;

  return {
    execution_results: executionResults,
    candidates: evaluated,
    selected: byIssue || fallback,
    intake_issue_matched: Boolean(byIssue),
  };
}

export async function certifyHostRuntimeIntake({
  repo = "example-org/example-notes",
  issueNumber = "",
  instanceId = "brainstorm",
  targetRepo = "example-org/example-notes",
  workspaceMode = "api_only",
  hostBaseDir = "",
  repoRoot = process.cwd(),
  destinationsJson = "",
  registryPath = process.env.HATCH_FACTORY_REGISTRY_PATH || "factory-registry.json",
  registryCwd = process.env.HATCH_FACTORY_REGISTRY_CWD || process.cwd(),
  runHostRuntimeOnceFn = runHostRuntimeOnce,
  ghJsonExec = ghJson,
  resolveHostRuntimePathsFn = resolveHostRuntimePaths,
  listHostInstallationsFn = listHostInstallations,
  loadFactoryRegistryFn = loadFactoryRegistry,
  findRegistryInstanceRowFn = findRegistryInstanceRow,
  existsSyncFn = existsSync,
  readFileSyncFn = readFileSync,
} = {}) {
  const intakeIssueNumber = normalizeIssueNumber(issueNumber);
  const intakeRepo = trim(repo).toLowerCase();
  const expectedInstanceId = trim(instanceId);
  const expectedTargetRepo = trim(targetRepo).toLowerCase();
  const expectedWorkspaceMode = trim(workspaceMode);

  if (!intakeRepo) {
    return {
      ok: false,
      status: "invalid_args",
      error: "repo_required",
      invariants: [],
    };
  }
  if (!intakeIssueNumber) {
    return {
      ok: false,
      status: "invalid_args",
      error: "issue_number_required",
      invariants: [],
    };
  }
  if (!expectedInstanceId) {
    return {
      ok: false,
      status: "invalid_args",
      error: "instance_id_required",
      invariants: [],
    };
  }

  const paths = resolveHostRuntimePathsFn({ hostBaseDir, repoRoot });
  const listed = listHostInstallationsFn({ paths });
  const installation = (listed.installations || []).find((entry) => trim(entry?.instance_id) === expectedInstanceId) || null;

  if (!installation) {
    return {
      ok: false,
      status: "installation_missing",
      error: `instance_installation_not_found:${expectedInstanceId}`,
      host_runtime: {
        host_base_dir: paths.baseDir,
        diagnostics: listed.diagnostics || [],
      },
      invariants: [],
    };
  }

  if (trim(installation.workspace_mode) !== expectedWorkspaceMode) {
    return {
      ok: false,
      status: "workspace_mode_mismatch",
      error: `workspace_mode_mismatch:expected=${expectedWorkspaceMode}:actual=${trim(installation.workspace_mode) || "(missing)"}`,
      host_runtime: {
        host_base_dir: paths.baseDir,
        installation_id: trim(installation.installation_id),
        instance_id: expectedInstanceId,
      },
      invariants: [],
    };
  }

  let registryLoaded;
  try {
    registryLoaded = loadFactoryRegistryFn({
      registryPath,
      cwd: registryCwd,
    });
  } catch (error) {
    return {
      ok: false,
      status: "registry_load_failed",
      error: trim(error?.message || error || "registry_load_failed"),
      host_runtime: {
        host_base_dir: paths.baseDir,
        installation_id: trim(installation.installation_id),
      },
      invariants: [],
    };
  }

  const registryRow = findRegistryInstanceRowFn(registryLoaded.registry, expectedInstanceId);
  if (!registryRow) {
    return {
      ok: false,
      status: "registry_instance_missing",
      error: `instance_not_registered:${expectedInstanceId}`,
      host_runtime: {
        host_base_dir: paths.baseDir,
        installation_id: trim(installation.installation_id),
      },
      invariants: [],
    };
  }

  const actualTargetRepo = trim(registryRow.target_repo).toLowerCase();
  if (actualTargetRepo !== expectedTargetRepo) {
    return {
      ok: false,
      status: "target_repo_mismatch",
      error: `target_repo_mismatch:expected=${expectedTargetRepo}:actual=${actualTargetRepo || "(missing)"}`,
      host_runtime: {
        host_base_dir: paths.baseDir,
        installation_id: trim(installation.installation_id),
        instance_id: expectedInstanceId,
      },
      invariants: [],
    };
  }

  const routeContext = trim(destinationsJson)
    ? { destinations_json: destinationsJson }
    : { destinations_json: trim(registryRow.destinations_json || "") };

  let destinationRoute;
  try {
    destinationRoute = resolveDestinationRoute(routeContext, "goal_issues");
  } catch (error) {
    return {
      ok: false,
      status: "destination_route_invalid",
      error: trim(error?.message || error || "destination_route_invalid"),
      host_runtime: {
        host_base_dir: paths.baseDir,
        installation_id: trim(installation.installation_id),
        instance_id: expectedInstanceId,
      },
      invariants: [],
    };
  }

  const runOutcome = await runHostRuntimeOnceFn({
    hostBaseDir: paths.baseDir,
    repoRoot: paths.repoRoot,
    registryPath,
    registryCwd,
  });

  if (!runOutcome.ok) {
    return {
      ok: false,
      status: "host_runtime_run_failed",
      error: trim(runOutcome.error || runOutcome.status || "host_runtime_run_failed"),
      host_runtime: {
        host_base_dir: paths.baseDir,
        mode: "once",
        exit_code: Number(runOutcome.exit_code) || 1,
        stderr: trim(runOutcome.stderr),
        log_file: trim(runOutcome?.payload?.log_file),
      },
      run_metadata: {
        installation_id: trim(installation.installation_id),
        instance_id: expectedInstanceId,
        run_id: "",
        tick_id: "",
        tick_log_path: "",
      },
      invariants: [],
    };
  }

  const execution = selectExecutionResult({
    payload: runOutcome.payload,
    installationId: trim(installation.installation_id),
    instanceId: expectedInstanceId,
    intakeIssueNumber,
    manifestPath: trim(installation.manifest_path),
    existsSyncFn,
    readFileSyncFn,
  });

  const selected = execution.selected;
  const selectedEntry = selected?.entry || {};
  const selectedContext = selected?.context || {};

  const runMetadata = {
    installation_id: trim(installation.installation_id),
    instance_id: expectedInstanceId,
    run_id: trim(selectedEntry.run_id),
    tick_id: trim(selectedEntry.tick_id),
    tick_log_path: trim(selectedEntry.tick_log_path),
    host_log_file: trim(runOutcome?.payload?.log_file),
    run_state_path: trim(selected?.run_state?.state_path),
    run_state_parse_error: trim(selected?.run_state?.parse_error),
  };

  if (Number(selectedEntry.exit_code) !== 0 || !selected) {
    return {
      ok: false,
      status: "host_runtime_execution_failed",
      error: selected
        ? `execution_failed:exit_code=${Number(selectedEntry.exit_code) || 1}`
        : "execution_result_missing",
      host_runtime: {
        host_base_dir: paths.baseDir,
        mode: "once",
        log_file: trim(runOutcome?.payload?.log_file),
      },
      run_metadata: runMetadata,
      invariants: [],
      execution_results: execution.execution_results,
    };
  }

  const bindingInvariant = buildInvariant({
    id: "intake_binding",
    ok: execution.intake_issue_matched,
    expected: {
      intake_issue_number: intakeIssueNumber,
    },
    actual: {
      intake_issue_number: trim(selectedContext.brainstorm_issue_number),
      run_id: trim(selectedEntry.run_id),
    },
    message: execution.intake_issue_matched
      ? "run_bound_to_requested_intake"
      : "run_not_bound_to_requested_intake",
  });

  const goalUrl = trim(selectedContext.goal_issue_url);
  const goalNumber = normalizeIssueNumber(selectedContext.goal_issue_number);
  const parsedGoalUrl = parseGithubIssueUrl(goalUrl);

  let goalIssue = null;
  if (goalNumber) {
    goalIssue = ghJsonExec([
      "issue",
      "view",
      goalNumber,
      "--repo",
      destinationRoute.repo,
      "--json",
      "number,url,state",
    ], null);
  }

  const goalInvariant = buildInvariant({
    id: "goal_created",
    ok: Boolean(goalNumber)
      && Boolean(goalUrl)
      && parsedGoalUrl.repo === trim(destinationRoute.repo).toLowerCase()
      && parsedGoalUrl.issue_number === goalNumber
      && Boolean(goalIssue),
    expected: {
      destination_repo: trim(destinationRoute.repo),
      goal_issue_number: "non-empty",
      goal_issue_url_pattern: `https://github.com/${trim(destinationRoute.repo)}/issues/<number>`,
    },
    actual: {
      destination_repo: parsedGoalUrl.repo,
      goal_issue_number: goalNumber,
      goal_issue_url: goalUrl,
      github_lookup_ok: Boolean(goalIssue),
    },
    message: Boolean(goalIssue) ? "goal_issue_verified" : "goal_issue_missing_or_mismatched",
  });

  const intakeIssue = ghJsonExec([
    "issue",
    "view",
    intakeIssueNumber,
    "--repo",
    intakeRepo,
    "--json",
    "number,state,url,comments",
  ], {});

  const comments = Array.isArray(intakeIssue?.comments) ? intakeIssue.comments : [];
  const backlinkComment = comments.find((entry) => {
    const body = trim(entry?.body);
    if (!body) return false;
    return body.includes(goalUrl) && body.includes(`#${goalNumber}`);
  }) || null;

  const backlinkInvariant = buildInvariant({
    id: "source_backlink",
    ok: Boolean(backlinkComment),
    expected: {
      intake_repo: intakeRepo,
      intake_issue_number: intakeIssueNumber,
      contains_goal_issue_number: `#${goalNumber}`,
      contains_goal_issue_url: goalUrl,
    },
    actual: {
      intake_repo: intakeRepo,
      intake_issue_number: intakeIssueNumber,
      matched_comment_body: trim(backlinkComment?.body),
      comment_count: comments.length,
    },
    message: backlinkComment ? "backlink_comment_present" : "backlink_comment_missing",
  });

  const sourceClosedInvariant = buildInvariant({
    id: "source_closed",
    ok: trim(intakeIssue?.state).toUpperCase() === "CLOSED",
    expected: {
      intake_repo: intakeRepo,
      intake_issue_number: intakeIssueNumber,
      state: "CLOSED",
    },
    actual: {
      intake_repo: intakeRepo,
      intake_issue_number: intakeIssueNumber,
      state: trim(intakeIssue?.state).toUpperCase() || "(missing)",
    },
    message: trim(intakeIssue?.state).toUpperCase() === "CLOSED"
      ? "source_issue_closed"
      : "source_issue_not_closed",
  });

  const invariants = [
    bindingInvariant,
    goalInvariant,
    backlinkInvariant,
    sourceClosedInvariant,
  ];

  const ok = invariants.every((entry) => entry.ok);

  return {
    ok,
    status: ok ? "certified" : "certification_failed",
    error: ok ? "" : "host_runtime_intake_certification_failed",
    host_runtime: {
      host_base_dir: paths.baseDir,
      mode: "once",
      log_file: trim(runOutcome?.payload?.log_file),
      host_id: trim(runOutcome?.payload?.host_id),
      runtime_version: trim(runOutcome?.payload?.runtime_version),
    },
    context_contract: {
      instance_id: expectedInstanceId,
      target_repo: expectedTargetRepo,
      workspace_mode: expectedWorkspaceMode,
      intake_repo: intakeRepo,
      intake_issue_number: intakeIssueNumber,
      goal_destination_repo: trim(destinationRoute.repo),
    },
    run_metadata: runMetadata,
    markers: {
      intake_binding: bindingInvariant.ok ? "pass" : "fail",
      goal_created: goalInvariant.ok ? "pass" : "fail",
      source_backlink: backlinkInvariant.ok ? "pass" : "fail",
      source_closed: sourceClosedInvariant.ok ? "pass" : "fail",
    },
    invariants,
    execution_results: execution.execution_results,
  };
}
