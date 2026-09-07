import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { trim } from "./cli-helpers.ts";
import { isDurablePacketType } from "./packet-core.ts";
import { buildRemediationPacket } from "./remediation-packet.ts";

// TODO(F-1): persist contract_drift_wave_cleanup via persistRemediationPacket when registry promotes it to durable.
const CONTRACT_DRIFT_WAVE_CLEANUP_IS_DURABLE = isDurablePacketType("contract_drift_wave_cleanup");
void CONTRACT_DRIFT_WAVE_CLEANUP_IS_DURABLE;

function parseJson(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

/**
 * Compute a deterministic SHA-256 hash of the factory's contract surface.
 *
 * Contract surface includes:
 * - All files under skills/ (recursively)
 * - All .dot files under graphs/
 * - roles.stylesheet
 *
 * Files are sorted by relative path before hashing so the result is
 * filesystem-order-independent.
 */
export function computeFactoryContractHash({ factoryRoot = "" } = {}) {
  const root = trim(factoryRoot);
  if (!root || !existsSync(root)) return "";

  const entries = [];

  // Collect skills files recursively
  const skillsDir = join(root, "skills");
  if (existsSync(skillsDir)) {
    collectFiles(skillsDir, skillsDir, entries);
  }

  // Collect graph .dot files
  const graphsDir = join(root, "graphs");
  if (existsSync(graphsDir)) {
    try {
      for (const name of readdirSync(graphsDir).sort()) {
        if (!name.endsWith(".dot")) continue;
        const fullPath = join(graphsDir, name);
        entries.push({ relativePath: `graphs/${name}`, fullPath });
      }
    } catch {}
  }

  // Collect roles.stylesheet
  const stylesheetPath = join(root, "roles.stylesheet");
  if (existsSync(stylesheetPath)) {
    entries.push({ relativePath: "roles.stylesheet", fullPath: stylesheetPath });
  }

  if (entries.length === 0) return "";

  // Sort by relative path for determinism
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const hash = createHash("sha256");
  for (const entry of entries) {
    try {
      const content = readFileSync(entry.fullPath, "utf8");
      // Include path in hash so renames are detected
      hash.update(`${entry.relativePath}\n${content}\n`);
    } catch {}
  }

  return hash.digest("hex");
}

function collectFiles(dir, baseDir, entries) {
  try {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        collectFiles(fullPath, baseDir, entries);
      } else {
        const relativePath = `skills/${fullPath.slice(baseDir.length + 1)}`;
        entries.push({ relativePath, fullPath });
      }
    }
  } catch {}
}

/**
 * Scan completed wave runs for contract drift.
 *
 * Returns an array of drift signals for runs that completed under a
 * different factory_contract_sha256 than the current hash.
 */
export function detectWaveContractDrift({
  runsDir = "",
  currentHash = "",
  nowMs = Date.now(),
  windowMs = 60 * 60 * 1000,
} = {}) {
  const resolved = trim(runsDir);
  if (!resolved || !existsSync(resolved)) return [];
  if (!currentHash) return [];

  const drifted = [];
  let runIds;
  try {
    runIds = readdirSync(resolved, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  for (const runId of runIds) {
    const statePath = join(resolved, runId, "state.json");
    let state;
    try {
      state = parseJson(readFileSync(statePath, "utf8"), null);
    } catch {
      continue;
    }
    if (!state) continue;

    // Only completed or failed runs — running waves haven't finished yet
    const status = trim(state.status);
    if (status !== "completed" && status !== "failed") continue;

    // Only wave execution pipelines
    const pipeline = trim(state.pipelineFile || state.pipeline || "");
    if (!pipeline.includes("wave_execute")) continue;

    const ctx = state.context || {};
    const spawnHash = trim(ctx.factory_contract_sha256);
    if (!spawnHash) continue;
    if (spawnHash === currentHash) continue;

    // Within time window
    const updatedMs = Date.parse(trim(state.updatedAt));
    if (Number.isFinite(updatedMs) && (nowMs - updatedMs) > windowMs) continue;

    drifted.push({
      run_id: trim(state.runId || runId),
      spawn_hash: spawnHash,
      current_hash: currentHash,
      wave_issue_number: trim(ctx.wave_issue_number || ctx.waveIssueNumber || ""),
      milestone: trim(ctx.milestone || ""),
      pipeline,
      status,
    });
  }

  return drifted;
}

/**
 * Build supervisor action items from contract drift signals.
 *
 * Each drifted wave run becomes one action item with:
 * - Problem description identifying CONTRACT_DRIFT
 * - Diagnostics with both hashes and affected issue/milestone
 * - Remediation packet with commands for the supervisor to clean up
 * - Suggested action text for the supervisor LLM prompt
 */
export function buildContractDriftActionItems({ signals = [], repo = "" } = {}) {
  if (!Array.isArray(signals) || signals.length === 0) return [];

  return signals.map((signal) => {
    const issueNum = trim(signal.wave_issue_number);
    const milestone = trim(signal.milestone);
    const runId = trim(signal.run_id);
    const normalizedRepo = trim(repo);

    const issueRef = issueNum ? `#${issueNum}` : runId;
    const milestoneRef = milestone ? ` (${milestone})` : "";

    return {
      type: "contract_drift",
      problem: `CONTRACT_DRIFT: wave run ${runId} for issue ${issueRef}${milestoneRef} completed under stale factory contracts (spawn=${trim(signal.spawn_hash).slice(0, 12)}… current=${trim(signal.current_hash).slice(0, 12)}…).`,
      diagnostics: {
        run_id: runId,
        spawn_hash: trim(signal.spawn_hash),
        current_hash: trim(signal.current_hash),
        wave_issue_number: issueNum,
        milestone,
        pipeline: trim(signal.pipeline),
        status: trim(signal.status),
        classification: "factory_contract_drift",
      },
      remediation_packet: buildRemediationPacket({
        packetType: "contract_drift_wave_cleanup",
        intent: "Evaluate whether the contract drift affected the wave's output quality. If drift is benign, accept the work. If drift is material, re-queue the affected issue for a fresh wave run under current contracts.",
        inspectionCommands: [
          issueNum && normalizedRepo ? `gh issue view ${issueNum} --repo ${normalizedRepo} --json number,title,state,labels,milestone` : "",
          normalizedRepo ? `gh issue list --repo ${normalizedRepo} --state open --search '"Wave Ready:" in:title' --json number,title,milestone,labels` : "",
        ].filter(Boolean),
        executionCommands: [
          issueNum && normalizedRepo
            ? `gh issue comment ${issueNum} --repo ${normalizedRepo} --body 'Contract drift detected: wave completed under stale factory contracts (spawn=${trim(signal.spawn_hash).slice(0, 12)}… vs current=${trim(signal.current_hash).slice(0, 12)}…). Supervisor reviewing whether re-queue is needed.'`
            : "",
        ].filter(Boolean),
        verifyCommands: [
          issueNum && normalizedRepo ? `gh issue view ${issueNum} --repo ${normalizedRepo} --json number,state,labels` : "",
          "hatch-ops factory tick-status",
        ].filter(Boolean),
        expectedPostconditions: [
          "affected issue is either accepted (drift benign) or re-queued for next tick under current contracts",
          "wave marker state is consistent — no orphan markers from drifted run",
          "next tick can run healthy without stale contract artifacts",
        ],
        retryPolicy: {
          max_attempts: 1,
          on_failure: "defer_with_drift_evidence",
          recheck_after: "next_tick",
        },
      }),
      suggested_action: `CONTRACT_DRIFT: wave for issue ${issueRef}${milestoneRef} completed under stale factory contracts. Check whether the drift (skills/graphs/stylesheet changed between spawn and completion) affected the output. If the work is correct despite drift, accept it and close normally. If the contract change was material (review policy, graph flow, or role model changed), re-queue the issue: remove wave-in-progress label, ensure a Wave Ready marker exists for the milestone, and let the next tick re-execute under current contracts. Prefer accepting work over re-queuing — contract drift is usually benign.`,
    };
  });
}
