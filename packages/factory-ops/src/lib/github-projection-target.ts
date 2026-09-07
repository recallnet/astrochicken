import {
  createGhCliAdapter,
  createGitHubProjectionTarget,
  runGhCli,
} from "@hatch/github-adapter";

function buildMutationContext({
  factoryId = "",
  runId = "",
  capabilityVersion = "commit-04",
} = {}) {
  return {
    instance_id: factoryId || "factory",
    installation_id: "local-installation",
    host_id: "local-host",
    run_id: runId || "local-run",
    tick_id: runId || "local-tick",
    destination_name: "github",
    capability_version: capabilityVersion,
    policy_profile: "default",
    runtime_version: "dev",
  };
}

export function resolveGitHubProjectionTarget({
  repo,
  ghExec,
  githubProjectionTarget,
  factoryId = "",
  runId = "",
  mutationContext = null,
  mutationContextJson = "",
  env = process.env,
  appendAuditRecordFn,
  auditHostBaseDir = "",
  auditLogPath = "",
  auditHomeDir,
  emitCanonicalEventFn,
  capabilityVersion = "commit-04",
} = {}) {
  if (githubProjectionTarget) {
    return githubProjectionTarget;
  }

  // @context:integration Projection-target creation stays in one owner so commands cannot drift
  // into copy-pasted GitHub transport and accidentally suppress audit records or receipts.
  const adapter = createGhCliAdapter({
    repo,
    ghFn: typeof ghExec === "function"
      ? (args, options) => ghExec(args, options)
      : (args, options) => runGhCli(args, { options }),
    mutationContext: mutationContext || buildMutationContext({
      factoryId,
      runId,
      capabilityVersion,
    }),
    mutationContextJson,
    env,
    appendAuditRecordFn,
    auditHostBaseDir,
    auditLogPath,
    auditHomeDir,
  });

  return createGitHubProjectionTarget({
    adapter,
    factoryId,
    runId,
    emitCanonicalEventFn,
  });
}
