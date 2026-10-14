import { classifySupervisorFailure, deriveIncidentSeverity } from "./supervisor-failure-classifier.ts";
import {
  encodeJsonB64,
  shouldEscalateCliCrash,
  persistDurableSnapshotPacket,
} from "./supervisor-state-collector.ts";
import { trim } from "../lib/cli-helpers.ts";
import { resolvePrimaryOpsRepo } from "../lib/factory-repo-identity.ts";
import { buildRemediationPacket } from "../lib/remediation-packet.ts";
import {
  mapPersistedPacketEntryToActionItem,
} from "../lib/supervisor-state-snapshot-packet-first.ts";

export function appendCliCrashActionItems({
  scanCliCrashesFn,
  resolvedRunsDir,
  nowMs,
  normalizedFactoryId,
  normalizedTargetRepo,
  normalizedControlPlaneRepo,
  repo,
  appendActionItem,
  appendSynthesisActionItem,
  persistedPacketActionItems,
  persistedPacketByDedupeKey,
  snapshotErrors,
} = {}) {
  const cliCrashes = scanCliCrashesFn({ runsDir: resolvedRunsDir, nowMs }).filter((crash) => shouldEscalateCliCrash(crash));
  for (const crash of cliCrashes) {
    let repoIdentity;
    try {
      repoIdentity = resolvePrimaryOpsRepo({
        context: {
          factory_id: normalizedFactoryId,
          target_repo: normalizedTargetRepo,
        },
        factoryId: normalizedFactoryId,
        requireResolved: false,
      });
    } catch {
      repoIdentity = {
        target_repo: normalizedTargetRepo,
      };
    }
    const resolvedTargetRepo = trim(repoIdentity.target_repo || normalizedTargetRepo);
    const runId = String(crash.run_id || "");
    const pipeline = String(crash.pipeline || "");
    const node = String(crash.node || "");
    const filePath = String(crash.file_path || "");
    const crashType = String(crash.crash_type || "runtime_module_error");
    const excerpt = String(crash.error_excerpt || "");
    const localCrashOwnership = normalizedTargetRepo.toLowerCase() === normalizedControlPlaneRepo.toLowerCase();
    const classifier = classifySupervisorFailure({
      bugType: "factory-cli-runtime-crash",
      evidence: {
        source_repo: normalizedTargetRepo,
        control_plane_repo: normalizedControlPlaneRepo,
        file_path: filePath,
        node,
        crash_type: crashType,
        ownership_hint: localCrashOwnership ? "local_factory" : "control_plane",
      },
      sourceRepo: normalizedTargetRepo,
      controlPlaneRepo: normalizedControlPlaneRepo,
      sourceFactory: normalizedFactoryId,
      factoryId: normalizedFactoryId,
      crashTypeHint: crashType,
    });
    const remoteCrashEvidence = {
      schema_version: "incident.v2.evidence/cli_runtime_crash",
      run_id: runId,
      pipeline,
      node,
      crash_type: classifier.crash_type,
      file_path: filePath,
      error_excerpt: excerpt,
      target_repo: resolvedTargetRepo,
      control_plane_repo: normalizedControlPlaneRepo,
      source_factory: normalizedFactoryId,
      source_repo: resolvedTargetRepo,
      classification: classifier.classification,
      severity: deriveIncidentSeverity({
        classification: classifier.classification,
        crashType: classifier.crash_type,
        bugType: "factory-cli-runtime-crash",
      }),
      factory_identity: {
        instance_id: normalizedFactoryId,
        kind_id: normalizedFactoryId.split("/")[0] || normalizedFactoryId,
        host_id: "unknown_host",
      },
      supervisor_state_snapshot: {
        graph_id: pipeline,
        affected_node: node,
        file_path: filePath,
      },
      observed_behavior: `Factory CLI crashed in node ${node || "unknown"} with ${classifier.crash_type}.`,
      expected_behavior: "Factory CLI commands should complete without runtime module crashes so supervisor ticks can progress.",
      remediation_attempts: "Factory captured crash diagnostics and escalated to control plane for fix.",
      ownership_hint: localCrashOwnership ? "local_factory" : "control_plane",
      next_step_hint: "Fix control-plane CLI/runtime defect, publish release, then resume affected factory run.",
    };
    const remoteCrashEvidenceB64 = encodeJsonB64(remoteCrashEvidence);
    const remoteCrashSummary = `factory-cli-runtime-crash ${classifier.crash_type} in ${normalizedTargetRepo}`;
    const remoteCrashEmitCommand = [
      "node packages/factory-ops/src/cli.ts supervisor emit-bug",
      `--repo '${normalizedControlPlaneRepo}'`,
      "--bug-type 'factory-cli-runtime-crash'",
      `--summary '${remoteCrashSummary}'`,
      `--evidence-b64 '${remoteCrashEvidenceB64}'`,
      `--run-id '${runId || "supervisor-loop"}'`,
      `--pipeline '${pipeline || "factory_supervisor_tick"}'`,
      `--factory-id '${normalizedFactoryId}'`,
      `--source-factory '${normalizedFactoryId}'`,
      `--source-repo '${normalizedTargetRepo}'`,
      `--classification '${classifier.classification}'`,
      `--severity '${remoteCrashEvidence.severity}'`,
      `--crash-type '${classifier.crash_type}'`,
    ].join(" ");

    appendSynthesisActionItem({
      problem: `CLI_RUNTIME_CRASH: run ${runId} failed at node=${node} pipeline=${pipeline} crash_type=${classifier.crash_type}.`,
      diagnostics: {
        file_path: filePath,
        error_excerpt: excerpt,
        target_repo: resolvedTargetRepo,
        control_plane_repo: normalizedControlPlaneRepo,
        factory_id: normalizedFactoryId,
        deterministic_classification: classifier.classification,
        deterministic_crash_type: classifier.crash_type,
        remediation_policy: localCrashOwnership
          ? "LOCAL_FACTORY_IMMEDIATE_FIX"
          : "REMOTE_FACTORY_ESCALATE_AND_SUBSCRIBE",
      },
      possible_resolutions: localCrashOwnership
        ? [
          { when: "local_factory", resolution: "Fix the crashing code immediately in-repo, run focused tests, commit, and restart supervisor tick." },
          { when: "merge_marker_in_executable", resolution: "Remove conflict markers, add guard test, commit, rerun impacted pipeline." },
        ]
        : [
          { when: "remote_factory", resolution: "File bug in control_plane_repo using supervisor emit-bug so incident.v2 payload contains source_factory/source_repo metadata." },
        ],
      remediation_packet: (() => {
        if (localCrashOwnership) {
          return buildRemediationPacket({
            packetType: "local_cli_runtime_crash",
            intent: "Fix the crashing factory code in-repo now so the supervisor can resume autonomous operation.",
            inspectionCommands: [
              filePath ? `sed -n '1,240p' '${filePath}'` : "",
              filePath ? `rg -n '${String(filePath).split("/").pop()}' factories/mothership apps/hatch` : "",
            ],
            verifyCommands: [
              "npm run build --silent",
              "npm run typecheck --silent",
            ],
            expectedPostconditions: [
              "crashing code path is fixed in-repo",
              "focused validation passes",
              "a local commit is created before resuming the supervisor",
            ],
            retryPolicy: { max_attempts: 1, on_failure: "defer_with_bug_context", recheck_after: "after_local_fix" },
            requiresCommit: true,
            requiresRepoFix: true,
          });
        }

        const packet = buildRemediationPacket({
          packetType: "remote_cli_runtime_crash",
          intent: "Escalate the crash to the control plane and wait for resolution before retrying local work.",
          executionCommands: [
            remoteCrashEmitCommand,
            "hatch-ops factory subscribe --target next-goal-progress --timeout 3600",
          ],
          expectedPostconditions: [
            "control plane repo has a bug filed for the crash with incident.v2 payload and source metadata",
            "local factory is waiting on remote fix rather than thrashing",
          ],
          retryPolicy: { max_attempts: 1, on_failure: "defer_with_remote_escalation", recheck_after: "remote_bug_closed" },
          factoryId: normalizedFactoryId,
          runId,
          pipeline,
          nodeId: node || "supervisor_state_snapshot",
          targetRepo: resolvedTargetRepo || normalizedTargetRepo,
          controlPlaneRepo: normalizedControlPlaneRepo,
          resourceRefs: { run_id: runId, pipeline, node_id: node, file_path: filePath },
        });
        try {
          const persisted = persistDurableSnapshotPacket({
            runsDir: resolvedRunsDir,
            packet,
          });
          const persistedEntry = {
            packet,
            packet_path: persisted.packet_path,
            packet_ref: {
              packet_type: trim(packet?.packet_type),
              schema_version: trim(packet?.schema_version),
              packet_id: trim(packet?.packet_id),
              packet_state: trim(packet?.packet_state || "open"),
              packet_path: persisted.packet_path,
              factory_id: trim(packet?.factory_id),
              run_id: trim(packet?.run_id),
              pipeline: trim(packet?.pipeline),
              node_id: trim(packet?.node_id),
            },
            registry_entry: {
              family: "remediation_packet",
              storage_class: persisted.storage_class,
            },
            run_id: trim(packet?.run_id),
          };
          const persistedActionItem = mapPersistedPacketEntryToActionItem(persistedEntry);
          const dedupeKey = String(persistedActionItem.packet_dedupe_key || "");
          if (dedupeKey && persistedPacketByDedupeKey.has(dedupeKey)) {
          } else {
            persistedPacketActionItems.push(persistedActionItem);
            if (dedupeKey) persistedPacketByDedupeKey.set(dedupeKey, persistedActionItem);
            appendActionItem(persistedActionItem);
          }
        } catch (error) {
          snapshotErrors.push(`remote_cli_runtime_crash_packet_persist_failed:${String(error?.message || error || "unknown_error")}`);
        }
        return packet;
      })(),
      suggested_action: localCrashOwnership
        ? "APPLY_NOW: identify crashing file from diagnostics.file_path, fix and git commit locally immediately (no bug issue), then rerun factory supervisor tick."
        : `APPLY_NOW: ${remoteCrashEmitCommand}; then subscribe until fixed: hatch-ops factory subscribe --target next-goal-progress --timeout 3600`,
    });
  }

  return cliCrashes;
}
