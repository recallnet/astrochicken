import { createHash } from "node:crypto";

import { gh, ghOrThrow } from "../lib/cli-helpers.ts";
import {
  FACTORY_LABEL_KEYS,
  buildIssueLabelEditArgs,
  getFactoryLabelName,
} from "../lib/factory-label-contract.ts";

export function normalizeRepoList(input) {
  if (Array.isArray(input)) return input.map((r) => String(r || "").trim()).filter(Boolean);
  if (typeof input === "string") return input.split(",").map((r) => r.trim()).filter(Boolean);
  return [];
}

export function isGitHubRepoIdentity(input) {
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(String(input || "").trim());
}

export function normalizeSourceRepoList(input, { fallbackRepo } = {}) {
  const normalized = normalizeRepoList(input).filter(isGitHubRepoIdentity);
  if (normalized.length > 0) return normalized;

  const fallback = String(fallbackRepo || "").trim();
  return isGitHubRepoIdentity(fallback) ? [fallback] : [];
}

export function normalizeMaxArtifacts(input, fallback = 20) {
  const parsed = Number.parseInt(String(input ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

const MAX_SUMMARY = 240;
const MAX_EVIDENCE = 700;
const ARTIFACT_SCHEMA_VERSION = "artifact.v1";
const FACTORY_LINK_SCHEMA_VERSION = "factory_link.v1";
const REQUIRED_FIELDS = ["schema_version", "factory_id", "source_repo", "run_id", "summary"];
const GOAL_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.GOAL);
const READY_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.READY);
const ARTIFACTS_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.ARTIFACTS);



function trim(s = "", n = 200) {
  const x = String(s || "").trim();
  return x.length <= n ? x : `${x.slice(0, n - 1)}…`;
}

function toBoolString(v) {
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "false") return s;
  return "";
}

export function sanitizeString(input = "") {
  let s = String(input || "");
  s = s.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED_TOKEN]");
  s = s.replace(/\b(sk|rk|pk)_[A-Za-z0-9]{20,}\b/g, "[REDACTED_TOKEN]");
  s = s.replace(/(authorization\s*:\s*bearer\s+)\S+/gi, "$1[REDACTED]");
  s = s.replace(/(api[_-]?key\s*[:=]\s*)\S+/gi, "$1[REDACTED]");
  s = s.replace(/(token\s*[:=]\s*)\S+/gi, "$1[REDACTED]");
  s = s.replace(/\/Users\/[A-Za-z0-9._-]+\/[\S]*/g, "[REDACTED_PATH]");
  s = s.replace(/\/home\/[A-Za-z0-9._-]+\/[\S]*/g, "[REDACTED_PATH]");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

export function safeObj(obj) {
  if (!obj || typeof obj !== "object") return {};
  const artifactType = sanitizeString(obj.artifact_type || obj.kind || "");
  return {
    schema_version: sanitizeString(obj.schema_version || "v1"),
    goal_ingest: toBoolString(obj.goal_ingest),
    factory_id: sanitizeString(obj.factory_id || ""),
    source_repo: sanitizeString(obj.source_repo || ""),
    run_id: sanitizeString(obj.run_id || ""),
    pipeline: sanitizeString(obj.pipeline || ""),
    node: sanitizeString(obj.node || ""),
    signature_hash: sanitizeString(obj.signature_hash || ""),
    artifact_type: artifactType,
    kind: sanitizeString(obj.kind || artifactType || "unspecified"),
    summary: trim(sanitizeString(obj.summary || ""), MAX_SUMMARY),
    evidence: trim(sanitizeString(obj.evidence || ""), 4000),
    evidence_excerpt: trim(sanitizeString(obj.evidence_excerpt || obj.evidence || ""), MAX_EVIDENCE),
    proposed_goal_title: trim(sanitizeString(obj.proposed_goal_title || ""), 180),
    proposed_goal_body: trim(sanitizeString(obj.proposed_goal_body || ""), 2000),
    required_factory_release: trim(sanitizeString(obj.required_factory_release || ""), 32),
  };
}

export function extractArtifactFromBody(body = "") {
  const raw = String(body || "");
  const m = raw.match(/```json\s*([\s\S]*?)```/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export function validateArtifactContract({ artifact = {}, sourceRepo = "", trustedSourceRepos = [], trustedFactoryIds = [] } = {}) {
  const reasons = [];
  const missing = REQUIRED_FIELDS.filter((f) => !String(artifact?.[f] || "").trim());
  if (missing.length > 0) reasons.push(`missing_required_fields:${missing.join(",")}`);

  if (String(artifact?.schema_version || "") !== ARTIFACT_SCHEMA_VERSION) {
    reasons.push(`invalid_schema_version:${String(artifact?.schema_version || "") || "(empty)"}`);
  }

  const goalIngest = toBoolString(artifact?.goal_ingest);
  if (goalIngest && goalIngest !== "true" && goalIngest !== "false") {
    reasons.push("invalid_goal_ingest");
  }

  const declaredSourceRepo = String(artifact?.source_repo || "");
  if (sourceRepo && declaredSourceRepo && declaredSourceRepo !== sourceRepo) {
    reasons.push("source_repo_mismatch");
  }

  const trustedRepos = new Set((Array.isArray(trustedSourceRepos) ? trustedSourceRepos : []).map((r) => String(r || "").trim()).filter(Boolean));
  if (trustedRepos.size > 0 && declaredSourceRepo && !trustedRepos.has(declaredSourceRepo)) {
    reasons.push("untrusted_source_repo");
  }

  const trustedFactories = new Set((Array.isArray(trustedFactoryIds) ? trustedFactoryIds : []).map((f) => String(f || "").trim()).filter(Boolean));
  const declaredFactory = String(artifact?.factory_id || "");
  if (trustedFactories.size > 0 && declaredFactory && !trustedFactories.has(declaredFactory)) {
    reasons.push("untrusted_factory_id");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    schema_version: ARTIFACT_SCHEMA_VERSION,
    required_fields: REQUIRED_FIELDS,
  };
}

export function computeSignature(sourceRepo, issueNumber, artifact) {
  const explicit = String(artifact.signature_hash || "").trim();
  if (explicit) return explicit;
  const kind = artifact.kind || artifact.artifact_type || "";
  const evidence = artifact.evidence_excerpt || artifact.evidence || "";
  const seed = JSON.stringify({
    source_repo: sourceRepo,
    issue_number: Number(issueNumber || 0),
    kind,
    pipeline: artifact.pipeline || "",
    node: artifact.node || "",
    summary: artifact.summary || "",
    evidence_excerpt: String(evidence).slice(0, 1200),
  });
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function buildGoalDraft(sourceRepo, sourceIssue, artifact, signature) {
  const title = artifact.proposed_goal_title || `[artifact] ${sourceRepo}: ${trim(artifact.summary || sourceIssue.title || "blocker", 120)}`;
  const body = [
    "Auto-generated from artifact issue for autonomous factory supervisor processing.",
    "",
    `Source: ${sourceRepo}#${sourceIssue.number}`,
    `Source URL: ${sourceIssue.url}`,
    `Artifact kind: ${artifact.kind || "unspecified"}`,
    `Factory: ${artifact.factory_id || ""}`,
    `Run ID: ${artifact.run_id || ""}`,
    `Pipeline: ${artifact.pipeline || ""}`,
    `Node: ${artifact.node || ""}`,
    "",
    "Summary:",
    artifact.summary || trim(sourceIssue.title || "", MAX_SUMMARY),
    "",
    "Evidence (sanitized):",
    artifact.evidence_excerpt || trim(sanitizeString(sourceIssue.body || ""), MAX_EVIDENCE),
    "",
    artifact.proposed_goal_body ? `Proposed Goal Notes:\n${artifact.proposed_goal_body}\n` : "",
    `Artifact-Signature: ${signature}`,
  ].filter(Boolean).join("\n");
  return { title: trim(title, 180), body };
}

function findExistingGoal(controlPlaneRepo, signature) {
  const q = `\"Artifact-Signature: ${signature}\" in:body`;
  const out = ghOrThrow([
    "issue", "list", "--repo", controlPlaneRepo, "--state", "open", "--label", GOAL_LABEL,
    "--search", q, "--limit", "10", "--json", "number,url,title",
  ]);
  try {
    const parsed = JSON.parse(String(out.stdout || "[]"));
    return parsed[0] || null;
  } catch {
    return null;
  }
}

function listArtifactIssues(repo, max) {
  const out = ghOrThrow([
    "issue", "list", "--repo", repo, "--state", "open", "--label", ARTIFACTS_LABEL,
    "--limit", String(max), "--json", "number,title,body,url,labels",
  ]);
  try {
    const parsed = JSON.parse(String(out.stdout || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function buildLinkagePayload({ controlPlaneRepo, sourceRepo, sourceIssueNumber, signature, goalNumber, factoryId, requiredFactoryRelease }) {
  return {
    schema_version: FACTORY_LINK_SCHEMA_VERSION,
    source_repo: String(sourceRepo || ""),
    source_issue: Number(sourceIssueNumber || 0),
    control_plane_repo: String(controlPlaneRepo || ""),
    control_plane_goal: Number(goalNumber || 0),
    signature_hash: String(signature || ""),
    factory_id: String(factoryId || ""),
    required_factory_release: String(requiredFactoryRelease || ""),
    status: "blocked_on_goal",
  };
}

export function buildLinkageComment({ controlPlaneRepo, sourceRepo, sourceIssueNumber, signature, goalNumber, factoryId, requiredFactoryRelease }) {
  const payload = buildLinkagePayload({
    controlPlaneRepo,
    sourceRepo,
    sourceIssueNumber,
    signature,
    goalNumber,
    factoryId,
    requiredFactoryRelease,
  });

  return [
    "Artifact linked to control-plane goal. Use this linkage to resume once goal is closed and release gate is satisfied.",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

function isActionableArtifact(artifact = {}) {
  const t = String(artifact.artifact_type || artifact.kind || "").trim();
  if (!t) return true;
  const nonActionable = new Set([
    "goal-duplicate-self-heal",
    "orphan-feature-milestone-backfill",
    "orphan-feature-detection",
    "supervisor-health-violations",
    "merge-failure-metrics",
    "wave-review-failures",
    "wave-state-self-heal",
  ]);
  if (nonActionable.has(t)) return false;
  if (String(artifact.goal_ingest || "").toLowerCase() === "false") return false;
  return true;
}

export async function ingestArtifactIssues({ controlPlaneRepo, sourceRepos, trustedSourceRepos = [], trustedFactoryIds = [], max = 20, dryRun = false } = {}) {
  const normalizedControlPlaneRepo = String(controlPlaneRepo || "").trim();
  if (!isGitHubRepoIdentity(normalizedControlPlaneRepo)) throw new Error("controlPlaneRepo is required");

  const repos = normalizeSourceRepoList(sourceRepos, { fallbackRepo: normalizedControlPlaneRepo });
  if (repos.length === 0) throw new Error("sourceRepos is required");

  const trustedRepos = normalizeSourceRepoList(trustedSourceRepos, { fallbackRepo: repos[0] || normalizedControlPlaneRepo });
  const trustedFactories = normalizeRepoList(trustedFactoryIds);
  const maxArtifacts = normalizeMaxArtifacts(max);

  const results = {
    processed: 0,
    createdGoals: 0,
    linkedExisting: 0,
    closedArtifacts: 0,
    invalidArtifacts: 0,
    items: [],
  };

  for (const repo of repos) {
    const issues = listArtifactIssues(repo, maxArtifacts);

    for (const issue of issues) {
      if (results.processed >= maxArtifacts) break;
      const parsed = extractArtifactFromBody(issue.body || "") || {};
      const artifact = safeObj({ ...parsed, source_repo: parsed.source_repo || repo });
      const validation = validateArtifactContract({
        artifact,
        sourceRepo: repo,
        trustedSourceRepos: trustedRepos,
        trustedFactoryIds: trustedFactories,
      });
      const signature = computeSignature(repo, issue.number, artifact);

      const actionable = validation.ok && isActionableArtifact(artifact);
      let goal = actionable ? findExistingGoal(normalizedControlPlaneRepo, signature) : null;
      let goalNumber = goal?.number || null;

      if (actionable && !goal && !dryRun) {
        const draft = buildGoalDraft(repo, issue, artifact, signature);
        const c = gh([
          "issue", "create", "--repo", normalizedControlPlaneRepo,
          "--title", draft.title,
          "--body", draft.body,
          "--label", GOAL_LABEL,
          "--label", READY_LABEL,
        ]);
        if (c.ok) {
          const m = c.stdout.match(/issues\/(\d+)/);
          goalNumber = m ? Number(m[1]) : null;
          results.createdGoals += 1;
        }
      } else if (actionable && goal) {
        results.linkedExisting += 1;
      }

      if (!dryRun) {
        if (!validation.ok) {
          results.invalidArtifacts += 1;
          gh([
            "issue", "comment", String(issue.number), "--repo", repo,
            "--body", `Artifact contract validation failed; quarantined by ingest.\n\nReasons: ${validation.reasons.join(", ")}`,
          ]);
          gh(["issue", "close", String(issue.number), "--repo", repo, "--reason", "not planned"]);
          results.closedArtifacts += 1;
        } else if (goalNumber) {
          gh(buildIssueLabelEditArgs({
            repo: normalizedControlPlaneRepo,
            issueNumber: String(goalNumber),
            factoryId: "mothership",
            addKeys: [FACTORY_LABEL_KEYS.READY],
          }));
          const linkBody = buildLinkageComment({
            controlPlaneRepo: normalizedControlPlaneRepo,
            sourceRepo: repo,
            sourceIssueNumber: issue.number,
            signature,
            goalNumber,
            factoryId: artifact.factory_id,
            requiredFactoryRelease: artifact.required_factory_release,
          });
          gh(["issue", "comment", String(issue.number), "--repo", repo, "--body", linkBody]);
          const cl = gh(["issue", "close", String(issue.number), "--repo", repo, "--reason", "completed"]);
          if (cl.ok) results.closedArtifacts += 1;
        } else if (!actionable) {
          gh([
            "issue", "comment", String(issue.number), "--repo", repo,
            "--body", "Processed artifact as operational telemetry/non-actionable signal (no goal creation required).",
          ]);
          const cl = gh(["issue", "close", String(issue.number), "--repo", repo, "--reason", "completed"]);
          if (cl.ok) results.closedArtifacts += 1;
        }
      }

      results.items.push({
        source_repo: repo,
        source_issue: issue.number,
        signature,
        goal_number: goalNumber,
        actionable,
        valid_contract: validation.ok,
        validation_reasons: validation.reasons,
        factory_id: artifact.factory_id,
      });
      results.processed += 1;
    }
  }

  return results;
}
