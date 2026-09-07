import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  computeSignature,
  extractArtifactFromBody,
  safeObj,
  sanitizeString,
  buildLinkagePayload,
} from "../../commands/artifact-ingest.ts";
import {
  compareReleases,
  computeLinkageKey,
  parseLinkagePayload,
  evaluateResumeGateFromLinkage,
} from "../../commands/artifact-linkage.ts";
import { stableStringify } from "../../commands/tick-artifact.ts";
import { parseJson, ghJson, ghOrThrow } from "../cli-helpers.ts";

export const RELEASE_MANIFEST_SCHEMA_VERSION = "factory_release_manifest/v1";
const RELEASE_MANIFEST_FILENAME = "release-manifest.json";
export const CONTROL_PLANE_RELEASE_STATUSES = Object.freeze([
  "fixed_main_unreleased",
  "fixed_released",
  "rejected",
  "superseded",
  "blocked_upstream",
]);

function normalizeControlPlaneReleaseStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) return "";
  return CONTROL_PLANE_RELEASE_STATUSES.includes(normalized) ? normalized : "";
}



function trim(s = "", n = 400) {
  const x = String(s || "").trim();
  return x.length <= n ? x : `${x.slice(0, n - 1)}…`;
}

function parseStates(raw = "closed") {
  const states = String(raw || "closed")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s === "open" || s === "closed" || s === "all");
  return states.length > 0 ? [...new Set(states)] : ["closed"];
}

function parseLinkageFromCommentBody(body = "") {
  const m = String(body || "").match(/```json\n([\s\S]*?)\n```/);
  if (!m?.[1]) return null;
  return parseLinkagePayload(m[1]);
}

function findIssueLinkage({ sourceRepo = "", sourceIssueNumber = 0, ghJsonFn = ghJson } = {}) {
  const viewed = ghJsonFn === ghJson
    ? (() => {
      const out = ghOrThrow([
        "issue", "view", String(sourceIssueNumber), "--repo", String(sourceRepo || ""),
        "--json", "number,url,comments",
      ]);
      const parsed = parseJson(out.stdout || "", null);
      if (parsed === null) {
        throw new Error(`gh_invalid_json: ${(out.stdout || "").slice(0, 200)}`);
      }
      return parsed;
    })()
    : ghJsonFn([
      "issue", "view", String(sourceIssueNumber), "--repo", String(sourceRepo || ""),
      "--json", "number,url,comments",
    ], {});
  const comments = Array.isArray(viewed?.comments) ? viewed.comments : [];

  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const link = parseLinkageFromCommentBody(String(comments[i]?.body || ""));
    if (link) {
      return {
        linkage: link,
        source_issue_url: String(viewed?.url || ""),
      };
    }
  }

  return {
    linkage: null,
    source_issue_url: String(viewed?.url || ""),
  };
}

function toReleaseEntry({
  issue = {},
  artifact = {},
  linkage = null,
  sourceIssueUrl = "",
  fallbackIntentsRepo = "",
  localFactoryRelease = "",
  checkResumeGateFn,
} = {}) {
  const sourceRepo = String(artifact.source_repo || "");
  const sourceIssueNumber = Number(issue?.number || 0);
  const signature = computeSignature(sourceRepo, sourceIssueNumber, artifact);

  const effectiveLinkage = parseLinkagePayload(linkage)
    || buildLinkagePayload({
      controlPlaneRepo: fallbackIntentsRepo,
      sourceRepo,
      sourceIssueNumber,
      signature,
      goalNumber: Number(linkage?.control_plane_goal || 0),
      factoryId: artifact.factory_id,
      requiredFactoryRelease: artifact.required_factory_release,
    });

  const requiredFactoryRelease = String(
    effectiveLinkage?.required_factory_release || artifact.required_factory_release || "",
  );

  const linkageResumeGate = evaluateResumeGateFromLinkage({
    linkage: effectiveLinkage,
    controlPlaneRepo: String(effectiveLinkage?.control_plane_repo || fallbackIntentsRepo || ""),
    sourceRepo,
    sourceIssueNumber,
    sourceIssueUrl: String(sourceIssueUrl || issue?.url || ""),
    localFactoryRelease: String(localFactoryRelease || ""),
    checkResumeGateFn,
  });

  const providedStatus = String(artifact.status || "").trim().toLowerCase();
  const releaseStatus = normalizeControlPlaneReleaseStatus(providedStatus)
    || (providedStatus || "blocked_upstream");

  return {
    source_repo: sourceRepo,
    source_issue: sourceIssueNumber,
    source_issue_url: String(sourceIssueUrl || issue?.url || ""),
    source_issue_state: String(issue?.state || ""),
    run_id: String(artifact.run_id || ""),
    factory_id: String(artifact.factory_id || ""),
    artifact_type: String(artifact.artifact_type || artifact.kind || ""),
    kind: String(artifact.kind || artifact.artifact_type || ""),
    summary: trim(String(artifact.summary || ""), 240),
    status: releaseStatus,
    required_factory_release: requiredFactoryRelease,
    signature_hash: signature,
    linkage: {
      schema_version: String(effectiveLinkage?.schema_version || ""),
      linkage_key: computeLinkageKey({ sourceRepo, sourceIssueNumber, signature }),
      control_plane_repo: String(effectiveLinkage?.control_plane_repo || fallbackIntentsRepo || ""),
      control_plane_goal: Number(effectiveLinkage?.control_plane_goal || 0),
      source_repo: String(effectiveLinkage?.source_repo || sourceRepo),
      source_issue: Number(effectiveLinkage?.source_issue || sourceIssueNumber),
      status: releaseStatus,
      factory_id: String(effectiveLinkage?.factory_id || artifact.factory_id || ""),
      required_factory_release: requiredFactoryRelease,
      signature_hash: String(effectiveLinkage?.signature_hash || signature),
      fixed_in_version: String(effectiveLinkage?.fixed_in_version || ""),
      fixed_in_manifest: String(effectiveLinkage?.fixed_in_manifest || ""),
    },
    resume_gate: {
      can_resume: Boolean(linkageResumeGate?.can_resume),
      reason: String(linkageResumeGate?.reason || ""),
      local_factory_release: String(linkageResumeGate?.local_factory_release || localFactoryRelease || ""),
      required_factory_release: requiredFactoryRelease,
      linked_goal_state: String(linkageResumeGate?.goal?.state || ""),
      linked_goal_number: Number(linkageResumeGate?.goal?.number || effectiveLinkage?.control_plane_goal || 0),
      linked_goal_url: String(linkageResumeGate?.goal?.url || ""),
    },
  };
}

function compareReleaseEntries(a, b) {
  const repo = String(a?.source_repo || "").localeCompare(String(b?.source_repo || ""));
  if (repo !== 0) return repo;
  const issue = Number(a?.source_issue || 0) - Number(b?.source_issue || 0);
  if (issue !== 0) return issue;
  return String(a?.signature_hash || "").localeCompare(String(b?.signature_hash || ""));
}

function normalizeManifestEntry(entry = {}, index = -1) {
  const item = isObject(entry) ? { ...entry } : {};
  const linkage = parseLinkagePayload(item.linkage) || (isObject(item.linkage) ? { ...item.linkage } : {});
  const status = normalizeControlPlaneReleaseStatus(item.status);
  if (!status) throw new Error(`invalid_artifact_status:${index}`);

  item.status = status;
  item.linkage = {
    ...linkage,
    status,
    fixed_in_version: String(linkage.fixed_in_version || ""),
    fixed_in_manifest: String(linkage.fixed_in_manifest || ""),
  };

  return item;
}

function buildCompatibilityMatrix(entries = []) {
  const normalized = Array.isArray(entries) ? entries : [];

  const requiredFactoryReleases = [...new Set(
    normalized
      .map((entry) => String(entry?.required_factory_release || "").trim())
      .filter(Boolean),
  )].sort((a, b) => compareReleases(a, b));

  let requiredFactoryReleaseFloor = "";
  for (const release of requiredFactoryReleases) {
    if (!requiredFactoryReleaseFloor || compareReleases(release, requiredFactoryReleaseFloor) > 0) {
      requiredFactoryReleaseFloor = release;
    }
  }

  const byFactory = new Map();
  for (const entry of normalized) {
    const factoryId = String(entry?.factory_id || "").trim();
    if (!factoryId) continue;
    const required = String(entry?.required_factory_release || "").trim();
    const current = byFactory.get(factoryId) || {
      factory_id: factoryId,
      artifact_count: 0,
      required_factory_release_floor: "",
    };

    current.artifact_count += 1;
    if (required && (!current.required_factory_release_floor || compareReleases(required, current.required_factory_release_floor) > 0)) {
      current.required_factory_release_floor = required;
    }
    byFactory.set(factoryId, current);
  }

  return {
    mode: "strict_version_floor",
    required_factory_releases: requiredFactoryReleases,
    required_factory_release_floor: requiredFactoryReleaseFloor,
    by_factory: [...byFactory.values()].sort((a, b) => String(a.factory_id).localeCompare(String(b.factory_id))),
  };
}

function buildChangelogSummary(entries = [], provided = "") {
  const explicit = trim(sanitizeString(provided || ""), 1200);
  if (explicit) return explicit;

  const uniqueSummaries = [...new Set(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => trim(sanitizeString(entry?.summary || ""), 240))
      .filter(Boolean),
  )];

  return trim(uniqueSummaries.join(" | "), 1200);
}

function normalizeReleaseId({ releaseTag = "", releaseSha = "" } = {}) {
  const base = String(releaseTag || releaseSha || "unversioned").trim();
  return base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "unversioned";
}

function hasReleaseIdentity({ releaseSha = "", releaseTag = "" } = {}) {
  return Boolean(String(releaseSha || "").trim() || String(releaseTag || "").trim());
}

function assertReleaseIdentity({ releaseSha = "", releaseTag = "" } = {}) {
  if (!hasReleaseIdentity({ releaseSha, releaseTag })) {
    throw new Error("missing_release_identity");
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateReleaseManifestContract(manifest = {}) {
  const reasons = [];
  const candidate = isObject(manifest) ? manifest : null;

  if (!candidate) {
    return {
      ok: false,
      reasons: ["manifest_not_object"],
      schema_version: RELEASE_MANIFEST_SCHEMA_VERSION,
    };
  }

  if (String(candidate.schema_version || "") !== RELEASE_MANIFEST_SCHEMA_VERSION) {
    reasons.push(`invalid_schema_version:${String(candidate.schema_version || "") || "(empty)"}`);
  }

  if (!isObject(candidate.release)) {
    reasons.push("missing_release_object");
  } else if (!hasReleaseIdentity({
    releaseSha: candidate.release.sha,
    releaseTag: candidate.release.tag,
  })) {
    reasons.push("missing_release_identity");
  }

  if (!isObject(candidate.compatibility_matrix)) reasons.push("missing_compatibility_matrix");

  const artifacts = Array.isArray(candidate.artifacts) ? candidate.artifacts : null;
  if (!artifacts) {
    reasons.push("missing_artifacts_array");
  } else {
    artifacts.forEach((entry, index) => {
      const item = isObject(entry) ? entry : null;
      if (!item) {
        reasons.push(`invalid_artifact_entry:${index}`);
        return;
      }

      const sourceRepo = String(item.source_repo || "").trim();
      const sourceIssue = Number(item.source_issue || 0);
      const status = normalizeControlPlaneReleaseStatus(item.status);
      const linkage = parseLinkagePayload(item.linkage);

      if (!sourceRepo) reasons.push(`missing_artifact_source_repo:${index}`);
      if (!Number.isFinite(sourceIssue) || sourceIssue <= 0) reasons.push(`missing_artifact_source_issue:${index}`);
      if (!status) reasons.push(`invalid_artifact_status:${index}`);
      if (!linkage) {
        reasons.push(`invalid_artifact_linkage_schema:${index}`);
        return;
      }

      if (sourceRepo && sourceRepo !== String(linkage.source_repo || "")) {
        reasons.push(`artifact_linkage_source_repo_mismatch:${index}`);
      }
      if (sourceIssue > 0 && sourceIssue !== Number(linkage.source_issue || 0)) {
        reasons.push(`artifact_linkage_source_issue_mismatch:${index}`);
      }
      if (status && normalizeControlPlaneReleaseStatus(linkage.status) !== status) {
        reasons.push(`artifact_linkage_status_mismatch:${index}`);
      }
    });
  }

  return {
    ok: reasons.length === 0,
    reasons,
    schema_version: RELEASE_MANIFEST_SCHEMA_VERSION,
  };
}

export function parseReleaseManifestPayload(raw = "") {
  const payload = typeof raw === "string" ? parseJson(raw, null) : raw;
  const validation = validateReleaseManifestContract(payload);
  if (!validation.ok) return null;
  return payload;
}

function normalizeReleaseIdentityInput(releaseIdentity = {}) {
  const releaseTag = String(releaseIdentity?.release_tag || releaseIdentity?.tag || "").trim();
  const releaseSha = String(releaseIdentity?.release_sha || releaseIdentity?.sha || "").trim();
  const releaseId = String(releaseIdentity?.release_id || releaseIdentity?.id || normalizeReleaseId({
    releaseTag,
    releaseSha,
  })).trim();
  return {
    release_id: releaseId,
    release_tag: releaseTag,
    release_sha: releaseSha,
  };
}

export function markArtifactInManifest(entry = {}, releaseIdentity = {}, manifestPath = "") {
  const identity = normalizeReleaseIdentityInput(releaseIdentity);
  if (!hasReleaseIdentity({ releaseSha: identity.release_sha, releaseTag: identity.release_tag }) && !identity.release_id) {
    throw new Error("missing_release_identity");
  }

  const normalizedPath = String(manifestPath || "").trim();
  if (!normalizedPath) throw new Error("missing_manifest_path");

  const item = isObject(entry) ? entry : {};
  const parsedLinkage = parseLinkagePayload(item.linkage);
  if (!parsedLinkage) throw new Error("invalid_manifest_linkage");

  const fixedInVersion = String(parsedLinkage.fixed_in_version || "").trim();
  const fixedInManifest = String(parsedLinkage.fixed_in_manifest || "").trim();
  const alreadyRecorded = fixedInVersion === identity.release_id && fixedInManifest === normalizedPath;

  if (alreadyRecorded) {
    return {
      changed: false,
      already_recorded: true,
      entry: item,
      release_id: identity.release_id,
      manifest_path: normalizedPath,
    };
  }

  const linkage = {
    ...parsedLinkage,
    fixed_in_version: identity.release_id,
    fixed_in_manifest: normalizedPath,
  };

  return {
    changed: true,
    already_recorded: false,
    entry: {
      ...item,
      linkage,
    },
    release_id: identity.release_id,
    manifest_path: normalizedPath,
  };
}

export function resolveReleaseManifestPath({
  runId = "",
  runsDir = ".hatch/runs",
  releasesDir = ".hatch/releases",
  releaseTag = "",
  releaseSha = "",
  outPath = "",
} = {}) {
  if (String(outPath || "").trim()) return String(outPath).trim();
  if (String(runId || "").trim()) {
    return join(String(runsDir || ".hatch/runs"), String(runId).trim(), "artifacts", RELEASE_MANIFEST_FILENAME);
  }

  const releaseId = normalizeReleaseId({ releaseTag, releaseSha });
  return join(String(releasesDir || ".hatch/releases"), releaseId, RELEASE_MANIFEST_FILENAME);
}

export function buildReleaseManifest({ controlPlaneRepo = "", releaseSha = "", releaseTag = "", changelogSummary = "", entries = [] } = {}) {
  assertReleaseIdentity({ releaseSha, releaseTag });

  const normalizedEntries = [...(Array.isArray(entries) ? entries : [])]
    .map((entry, index) => normalizeManifestEntry(entry, index))
    .sort(compareReleaseEntries);
  const releaseId = normalizeReleaseId({ releaseTag, releaseSha });

  return {
    schema_version: RELEASE_MANIFEST_SCHEMA_VERSION,
    release: {
      control_plane_repo: String(controlPlaneRepo || ""),
      sha: String(releaseSha || ""),
      tag: String(releaseTag || ""),
      release_id: releaseId,
    },
    rollout: {
      schema_version: "release_rollout_state/v1",
      controller: {
        status: "pending",
        stage: "candidate",
        resume_blocked: false,
        rollback_reason: "",
        canary_factory_ids: [],
        canary_max_factories: 0,
        previous_canary_release_id: "",
        previous_general_release_id: "",
        candidate_manifest_path: "",
        canary_manifest_path: ".hatch/releases/canary/release-manifest.json",
        general_manifest_path: ".hatch/releases/stable/release-manifest.json",
        lease: {},
        health: {
          status: "",
          reason: "",
          poll_count: 0,
          last_checked_at: "",
          snapshots: [],
        },
        events: [],
        updated_at: "",
      },
    },
    changelog_summary: buildChangelogSummary(normalizedEntries, changelogSummary),
    compatibility_matrix: buildCompatibilityMatrix(normalizedEntries),
    artifacts: normalizedEntries,
  };
}

export function collectReleaseManifestEntries({
  controlPlaneRepo = "",
  sourceRepos = [],
  states = "closed",
  max = 200,
  runId = "",
  localFactoryRelease = "",
  ghJsonFn = ghJson,
  checkResumeGateFn,
} = {}) {
  const repos = (Array.isArray(sourceRepos) ? sourceRepos : [])
    .map((repo) => String(repo || "").trim())
    .filter(Boolean);

  const stateList = parseStates(states);
  const entries = [];

  for (const sourceRepo of repos) {
    for (const state of stateList) {
      const issues = ghJsonFn([
        "issue", "list", "--repo", sourceRepo, "--state", state, "--label", "artifacts",
        "--limit", String(Number(max) || 200), "--json", "number,title,body,url,state",
      ], []);

      for (const issue of Array.isArray(issues) ? issues : []) {
        const parsedArtifact = extractArtifactFromBody(String(issue?.body || "")) || {};
        const safeArtifact = safeObj({ ...parsedArtifact, source_repo: parsedArtifact.source_repo || sourceRepo });
        const parsedStatus = String(parsedArtifact.status || "").trim();
        if (parsedStatus) safeArtifact.status = parsedStatus;
        if (!safeArtifact.summary) safeArtifact.summary = trim(sanitizeString(issue?.title || ""), 240);
        if (String(runId || "").trim() && String(safeArtifact.run_id || "") !== String(runId).trim()) continue;

        const issueLinkage = findIssueLinkage({
          sourceRepo,
          sourceIssueNumber: Number(issue?.number || 0),
          ghJsonFn,
        });
        if (!issueLinkage?.linkage) {
          throw new Error(`missing_linkage_record: ${sourceRepo}#${Number(issue?.number || 0)}`);
        }

        entries.push(toReleaseEntry({
          issue,
          artifact: safeArtifact,
          linkage: issueLinkage.linkage,
          sourceIssueUrl: issueLinkage.source_issue_url || String(issue?.url || ""),
          fallbackIntentsRepo: controlPlaneRepo,
          localFactoryRelease,
          checkResumeGateFn,
        }));
      }
    }
  }

  return entries.sort(compareReleaseEntries);
}

export function produceReleaseManifest({
  controlPlaneRepo = "",
  sourceRepos = [],
  states = "closed",
  max = 200,
  runId = "",
  releaseSha = "",
  releaseTag = "",
  changelogSummary = "",
  localFactoryRelease = "",
  runsDir = ".hatch/runs",
  releasesDir = ".hatch/releases",
  outPath = "",
  ghJsonFn = ghJson,
  checkResumeGateFn,
} = {}) {
  assertReleaseIdentity({ releaseSha, releaseTag });

  const entries = collectReleaseManifestEntries({
    controlPlaneRepo,
    sourceRepos,
    states,
    max,
    runId,
    localFactoryRelease,
    ghJsonFn,
    checkResumeGateFn,
  });

  const manifest = buildReleaseManifest({
    controlPlaneRepo,
    releaseSha,
    releaseTag,
    changelogSummary,
    entries,
  });

  const manifestPath = resolveReleaseManifestPath({ runId, runsDir, releasesDir, releaseTag, releaseSha, outPath });
  mkdirSync(dirname(manifestPath), { recursive: true });
  const encoded = `${stableStringify(manifest)}\n`;
  writeFileSync(manifestPath, encoded, "utf8");

  const manifestSha256 = `sha256:${createHash("sha256").update(encoded).digest("hex")}`;

  return {
    ok: true,
    manifest_path: manifestPath,
    manifest_sha256: manifestSha256,
    schema_version: RELEASE_MANIFEST_SCHEMA_VERSION,
    release_sha: String(releaseSha || ""),
    release_tag: String(releaseTag || ""),
    local_factory_release: String(localFactoryRelease || ""),
    artifact_count: manifest.artifacts.length,
    required_factory_release_floor: String(manifest.compatibility_matrix?.required_factory_release_floor || ""),
    manifest,
  };
}

