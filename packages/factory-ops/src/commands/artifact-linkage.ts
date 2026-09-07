import { createHash } from "node:crypto";

import { trim, parseJson, ghJson } from "../lib/cli-helpers.ts";


const FACTORY_LINK_SCHEMA_VERSION = "factory_link.v1";



export function computeLinkageKey({ sourceRepo = "", sourceIssueNumber = 0, signature = "" } = {}) {
  const seed = JSON.stringify({
    source_repo: String(sourceRepo || ""),
    source_issue: Number(sourceIssueNumber || 0),
    signature_hash: String(signature || ""),
  });
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function parseRelease(v = "") {
  const s = String(v || "").trim().replace(/^v/i, "");
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function compareReleases(a = "", b = "") {
  const pa = parseRelease(a);
  const pb = parseRelease(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

export function isReleaseSatisfied({ localFactoryRelease = "", requiredFactoryRelease = "" } = {}) {
  const required = String(requiredFactoryRelease || "").trim();
  if (!required) return true;
  const local = String(localFactoryRelease || "").trim();
  if (!local) return false;
  return compareReleases(local, required) >= 0;
}

export function parseLinkagePayload(raw = "") {
  const payload = typeof raw === "string" ? parseJson(raw, null) : raw;
  if (!payload || String(payload?.schema_version || "") !== FACTORY_LINK_SCHEMA_VERSION) return null;
  return payload;
}

function parseLinkageFromCommentBody(body = "") {
  const m = String(body || "").match(/```json\n([\s\S]*?)\n```/);
  if (!m?.[1]) return null;
  return parseLinkagePayload(m[1]);
}

export function checkResumeGate({ controlPlaneRepo = "", goalNumber = 0, localFactoryRelease = "", requiredFactoryRelease = "" } = {}) {
  if (!controlPlaneRepo || !goalNumber) {
    return { ok: false, can_resume: false, reason: "missing_goal_reference" };
  }

  const goal = ghJson([
    "issue", "view", String(goalNumber), "--repo", controlPlaneRepo,
    "--json", "number,state,url,title",
  ], {});

  const goalClosed = String(goal?.state || "").toUpperCase() === "CLOSED";
  const releaseSatisfied = isReleaseSatisfied({ localFactoryRelease, requiredFactoryRelease });

  return {
    ok: true,
    can_resume: goalClosed && releaseSatisfied,
    reason: !goalClosed ? "linked_goal_open" : (!releaseSatisfied ? "factory_release_below_required" : "ready_to_resume"),
    goal: {
      number: Number(goal?.number || goalNumber),
      state: String(goal?.state || ""),
      url: String(goal?.url || ""),
      title: String(goal?.title || ""),
    },
    local_factory_release: String(localFactoryRelease || ""),
    required_factory_release: String(requiredFactoryRelease || ""),
  };
}

export function evaluateResumeGateFromLinkage({
  linkage = null,
  controlPlaneRepo = "",
  sourceRepo = "",
  sourceIssueNumber = 0,
  sourceIssueUrl = "",
  localFactoryRelease = "",
  checkResumeGateFn = checkResumeGate,
} = {}) {
  const parsedLink = parseLinkagePayload(linkage);
  if (!parsedLink) return { ok: false, can_resume: false, reason: "missing_linkage_record" };

  const gate = checkResumeGateFn({
    controlPlaneRepo: controlPlaneRepo || String(parsedLink?.control_plane_repo || ""),
    goalNumber: Number(parsedLink?.control_plane_goal || 0),
    localFactoryRelease,
    requiredFactoryRelease: String(parsedLink?.required_factory_release || ""),
  });

  return {
    ...gate,
    linkage: parsedLink,
    source_issue: {
      repo: sourceRepo,
      number: Number(sourceIssueNumber),
      url: String(sourceIssueUrl || ""),
    },
  };
}

export function evaluateResumeGateFromManifestEntry({
  manifestEntry = null,
  controlPlaneRepo = "",
  localFactoryRelease = "",
  checkResumeGateFn = checkResumeGate,
} = {}) {
  const entry = manifestEntry && typeof manifestEntry === "object" ? manifestEntry : null;
  if (!entry) return { ok: false, can_resume: false, reason: "missing_manifest_entry" };
  if (!entry?.linkage) return { ok: false, can_resume: false, reason: "missing_manifest_linkage" };

  const parsedLinkage = parseLinkagePayload(entry.linkage);
  if (!parsedLinkage) return { ok: false, can_resume: false, reason: "invalid_manifest_linkage" };

  return evaluateResumeGateFromLinkage({
    linkage: parsedLinkage,
    controlPlaneRepo: controlPlaneRepo || String(parsedLinkage?.control_plane_repo || ""),
    sourceRepo: String(entry?.source_repo || parsedLinkage?.source_repo || ""),
    sourceIssueNumber: Number(entry?.source_issue || parsedLinkage?.source_issue || 0),
    sourceIssueUrl: String(entry?.source_issue_url || ""),
    localFactoryRelease: String(localFactoryRelease || entry?.resume_gate?.local_factory_release || ""),
    checkResumeGateFn,
  });
}

export function checkResumeGateFromArtifactLink({ controlPlaneRepo = "", sourceRepo = "", sourceIssueNumber = 0, localFactoryRelease = "" } = {}) {
  if (!sourceRepo || !sourceIssueNumber) {
    return { ok: false, can_resume: false, reason: "missing_source_reference" };
  }

  const issue = ghJson([
    "issue", "view", String(sourceIssueNumber), "--repo", sourceRepo,
    "--json", "number,url,comments",
  ], {});

  const comments = Array.isArray(issue?.comments) ? issue.comments : [];
  let link = null;
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const parsed = parseLinkageFromCommentBody(comments[i]?.body || "");
    if (parsed) {
      link = parsed;
      break;
    }
  }

  return evaluateResumeGateFromLinkage({
    linkage: link,
    controlPlaneRepo,
    sourceRepo,
    sourceIssueNumber,
    sourceIssueUrl: String(issue?.url || ""),
    localFactoryRelease,
  });
}
