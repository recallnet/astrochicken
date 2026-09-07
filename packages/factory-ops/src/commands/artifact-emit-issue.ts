import { createHash } from "node:crypto";

import { sanitizeString } from "./artifact-ingest.ts";
import { gh } from "../lib/cli-helpers.ts";


function trim(s = "", n = 400) {
  const x = String(s || "").trim();
  return x.length <= n ? x : `${x.slice(0, n - 1)}…`;
}

function hashSig(seed) {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

export async function emitArtifactIssue({
  repo,
  factoryId = "",
  sourceRepo = "",
  runId = "",
  pipeline = "",
  node = "",
  kind = "blocker",
  summary = "",
  evidence = "",
  proposedGoalTitle = "",
  proposedGoalBody = "",
  requiredFactoryRelease = "",
} = {}) {
  if (!repo) throw new Error("repo is required");

  const safe = {
    schema_version: "artifact.v1",
    goal_ingest: "true",
    factory_id: sanitizeString(factoryId || "unknown-factory"),
    source_repo: sanitizeString(sourceRepo || repo),
    run_id: sanitizeString(runId || ""),
    pipeline: sanitizeString(pipeline || ""),
    node: sanitizeString(node || ""),
    kind: sanitizeString(kind || "blocker"),
    artifact_type: sanitizeString(kind || "blocker"),
    summary: trim(sanitizeString(summary || "(no summary)"), 240),
    evidence_excerpt: trim(sanitizeString(evidence || ""), 700),
    proposed_goal_title: trim(sanitizeString(proposedGoalTitle || ""), 180),
    proposed_goal_body: trim(sanitizeString(proposedGoalBody || ""), 1600),
    required_factory_release: trim(sanitizeString(requiredFactoryRelease || ""), 32),
  };

  safe.signature_hash = hashSig(JSON.stringify({
    source_repo: safe.source_repo,
    factory_id: safe.factory_id,
    kind: safe.kind,
    pipeline: safe.pipeline,
    node: safe.node,
    summary: safe.summary,
  }));

  const title = `[artifact] ${safe.factory_id}: ${safe.kind} (${safe.run_id || "run"})`;
  const body = [
    "Machine-generated artifact issue for intents ingest.",
    "Do not add `ready` to this issue.",
    "",
    "```json",
    JSON.stringify(safe, null, 2),
    "```",
  ].join("\n");

  const r = gh([
    "issue", "create", "--repo", repo,
    "--title", title,
    "--body", body,
    "--label", "artifacts",
  ]);
  if (!r.ok) throw new Error((r.stderr || r.stdout || "failed to create artifact issue").trim());

  const m = r.stdout.match(/issues\/(\d+)/);
  return {
    repo,
    issue_number: m ? Number(m[1]) : null,
    issue_url: r.stdout.trim(),
    signature_hash: safe.signature_hash,
  };
}
