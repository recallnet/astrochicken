import { createHash } from "node:crypto";

import { emitSupervisorArtifact, emitBugIssue } from "./supervisor-artifact.ts";
import { trim, parseJson, gh, ghJson } from "../lib/cli-helpers.ts";
import {
  FACTORY_LABEL_KEYS,
  buildIssueLabelEditArgs,
  ensureFactoryLabels,
  getFactoryLabelName,
} from "../lib/factory-label-contract.ts";




function noteHash(notes = "") {
  return createHash("sha256").update(String(notes || "").trim()).digest("hex").slice(0, 16);
}

function parseFailureMarker(body = "") {
  const m = String(body || "").match(/WAVE-REVIEW-FAILURE:\s*count=(\d+)\s+note_hash=([a-f0-9]+)/i);
  if (!m) return null;
  return { count: Number.parseInt(m[1], 10) || 0, note_hash: String(m[2] || "").toLowerCase() };
}

function parseQuarantineUntil(body = "") {
  const m = String(body || "").match(/WAVE-QUARANTINE:\s*until=(\d+)/i);
  if (!m) return 0;
  return Number.parseInt(m[1], 10) || 0;
}

function getIssueSnapshot(repo, issueNumber, ghJsonExec = ghJson) {
  return ghJsonExec(["issue", "view", String(issueNumber), "--repo", repo, "--json", "number,title,labels,comments"], {});
}

function hasLabel(issue, label) {
  return (issue?.labels || []).some((l) => String(l?.name || "") === label);
}

export function computeFailureCount(snapshot, hash) {
  const comments = Array.isArray(snapshot?.comments) ? snapshot.comments : [];
  let highest = 0;
  for (const c of comments) {
    const marker = parseFailureMarker(c?.body || "");
    if (!marker) continue;
    if (marker.count > highest) highest = marker.count;
  }
  return highest + 1;
}

function buildFailureComment({ notes, branch, count, hash }) {
  const resume = branch
    ? `Resume policy: keep branch ${branch}. After fixes land, re-run wave_execute; milestone scheduler will deterministically resume from pending issues.`
    : "Resume policy: after fixes land, re-run wave_execute; milestone scheduler will deterministically resume from pending issues.";
  return [
    "Review failed after attempts:",
    "",
    String(notes || "").trim(),
    "",
    resume,
    "",
    `WAVE-REVIEW-FAILURE: count=${count} note_hash=${hash}`,
  ].join("\n");
}

export function buildIssueExecutionStyleComment(title = "", body = "") {
  const heading = String(title || "").trim();
  const details = String(body || "").trim();
  return details ? `${heading}\n\n${details}` : heading;
}

function buildIssueExecutionFailureComment(notes = "") {
  return buildIssueExecutionStyleComment("Review failed after 3 attempts:", String(notes || "").trim());
}

function normalizeMode(mode = "") {
  return String(mode || "wave_execute").trim().toLowerCase().replace(/-/g, "_");
}

const QUARANTINED_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.QUARANTINED);

export function buildFailureComments(reviewFailures = []) {
  return (Array.isArray(reviewFailures) ? reviewFailures : [])
    .map((item) => {
      const issue = String(item?.issue_number || "").trim();
      const notes = String(item?.review_notes || "").trim();
      if (!issue || !notes) return { issue_number: "", body: "", notes: "", branch: "" };
      const branch = String(item?.branch || "").trim();
      return { issue_number: issue, body: "", notes, branch };
    })
    .filter((x) => x.issue_number && x.notes);
}

export function commentReviewFailuresIssueExecution({
  repo,
  reviewFailuresRaw = "[]",
} = {}, deps = {}) {
  const failures = parseJson(String(reviewFailuresRaw || "[]"), []);
  const comments = buildFailureComments(failures);
  const issueComment = typeof deps.issueComment === "function"
    ? deps.issueComment
    : ({ issueNumber, body, repo: issueRepo }) => gh(["issue", "comment", issueNumber, "--repo", issueRepo, "--body", body]);

  const posted = [];
  for (const c of comments) {
    const body = buildIssueExecutionFailureComment(c.notes);
    const response = issueComment({
      issueNumber: c.issue_number,
      body,
      repo,
      notes: c.notes,
      branch: c.branch,
    });
    if (response?.ok) posted.push(c.issue_number);
  }

  return {
    posted_count: posted.length,
    posted_issues: posted,
    quarantined_count: 0,
    quarantined: [],
    supervisor_artifact_url: "",
    supervisor_artifact_error: "",
    mode: "issue_execution",
  };
}

export function commentReviewFailures({
  repo,
  reviewFailuresRaw = "[]",
  runId = "",
  pipeline = "wave_execute",
  mode = "wave_execute",
  quarantineThreshold = 3,
  cooldownHours = 6,
} = {}, deps = {}) {
  const normalizedMode = normalizeMode(mode);
  if (normalizedMode === "issue_execution" || normalizedMode === "comment_only") {
    return commentReviewFailuresIssueExecution({ repo, reviewFailuresRaw }, deps);
  }

  const ghExec = typeof deps.gh === "function" ? deps.gh : gh;
  const ghJsonExec = typeof deps.ghJson === "function" ? deps.ghJson : ghJson;
  const emitArtifact = typeof deps.emitArtifact === "function" ? deps.emitArtifact : emitSupervisorArtifact;
  const emitBug = typeof deps.emitBugIssue === "function" ? deps.emitBugIssue : emitBugIssue;

  const failures = parseJson(String(reviewFailuresRaw || "[]"), []);
  const comments = buildFailureComments(failures);
  const posted = [];
  const quarantined = [];
  const now = Math.floor(Date.now() / 1000);
  const until = now + Math.max(1, Number(cooldownHours || 6)) * 3600;

  ensureFactoryLabels({
    repo,
    factoryId: "mothership",
    keys: [FACTORY_LABEL_KEYS.QUARANTINED],
    ghExec,
  });

  for (const c of comments) {
    const snapshot = getIssueSnapshot(repo, c.issue_number, ghJsonExec);
    const hash = noteHash(c.notes);
    const count = computeFailureCount(snapshot, hash);
    const body = buildFailureComment({ notes: c.notes, branch: c.branch, count, hash });
    const p = ghExec(["issue", "comment", c.issue_number, "--repo", repo, "--body", body]);
    if (!p.ok) continue;

    posted.push(c.issue_number);

    if (count >= Number(quarantineThreshold || 3)) {
      ghExec(buildIssueLabelEditArgs({
        repo,
        issueNumber: c.issue_number,
        factoryId: "mothership",
        addKeys: [FACTORY_LABEL_KEYS.QUARANTINED],
      }));
      ghExec([
        "issue",
        "comment",
        c.issue_number,
        "--repo",
        repo,
        "--body",
        `Applied deterministic cooldown after repeated review failures. WAVE-QUARANTINE: until=${until} reason=repeat_review_failure count=${count}`,
      ]);
      quarantined.push({ issue_number: Number(c.issue_number), failure_count: count, cooldown_until: until });
    }
  }

  let artifact = { ok: true, issue_url: "", error: "" };
  if (posted.length > 0 || quarantined.length > 0) {
    artifact = emitArtifact({
      repo,
      runId,
      pipeline,
      artifactType: "wave-review-failures",
      summary: `Wave review failures posted (${posted.length}); quarantined (${quarantined.length}).`,
      evidence: JSON.stringify({ posted_issues: posted, quarantined, failures: failures.filter((f) => posted.includes(String(f?.issue_number || ""))) }),
      goalIngest: false,
    });
  }

  let bugResult = { ok: false, issue_url: "", error: "" };
  if (quarantined.length > 0) {
    const issueList = quarantined.map((q) => `#${q.issue_number} (${q.failure_count} failures)`).join(", ");
    bugResult = emitBug({
      repo,
      bugType: "repeat-review-failure-quarantine",
      summary: `Quarantined ${quarantined.length} issue(s) after repeated review failures: ${issueList}`,
      evidence: JSON.stringify({ posted_issues: posted, quarantined, failures: failures.filter((f) => posted.includes(String(f?.issue_number || ""))) }),
      runId: String(runId || ""),
      pipeline: String(pipeline || ""),
      sourceRepo: repo,
      classification: "local",
      severity: "degrading",
      crashType: "review_failure_loop",
    });
  }

  return {
    posted_count: posted.length,
    posted_issues: posted,
    quarantined_count: quarantined.length,
    quarantined,
    supervisor_artifact_url: artifact.issue_url,
    supervisor_artifact_error: artifact.error,
    supervisor_bug_url: bugResult.issue_url || "",
    mode: "wave_execute",
  };
}

export function releaseWaveQuarantine({ repo, nowEpoch = 0, adapter, ghExec = gh, ghJsonExec = ghJson } = {}) {
  const now = Number(nowEpoch) > 0 ? Number(nowEpoch) : Math.floor(Date.now() / 1000);
  const effectiveRepo = repo || adapter?.repo;

  const open = adapter
    ? adapter.issueList({ state: "open", labels: [QUARANTINED_LABEL], limit: 200, fields: "number,title" })
    : ghJsonExec([
        "issue", "list", "--repo", effectiveRepo,
        "--state", "open", "--label", QUARANTINED_LABEL,
        "--limit", "200", "--json", "number,title",
      ], []);

  const released = [];
  for (const issue of open) {
    const snapshot = adapter
      ? adapter.issueView({ number: issue.number, fields: "number,title,labels,comments" })
      : getIssueSnapshot(effectiveRepo, issue.number, ghJsonExec);
    const comments = Array.isArray(snapshot?.comments) ? snapshot.comments : [];
    let lastUntil = 0;
    for (const c of comments) {
      const u = parseQuarantineUntil(c?.body || "");
      if (u > lastUntil) lastUntil = u;
    }
    if (lastUntil > 0 && now >= lastUntil) {
      const quarantinedLabelNames = [getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.QUARANTINED)];
      if (adapter) {
        adapter.issueEdit({ number: issue.number, removeLabels: quarantinedLabelNames });
        adapter.issueComment({ number: issue.number, body: `Cooldown elapsed; removing quarantine label. WAVE-QUARANTINE-RELEASE: at=${now}` });
      } else {
        ghExec(buildIssueLabelEditArgs({
          repo: effectiveRepo,
          issueNumber: String(issue.number),
          factoryId: "mothership",
          removeKeys: [FACTORY_LABEL_KEYS.QUARANTINED],
        }));
        ghExec([
          "issue", "comment", String(issue.number),
          "--repo", effectiveRepo,
          "--body", `Cooldown elapsed; removing quarantine label. WAVE-QUARANTINE-RELEASE: at=${now}`,
        ]);
      }
      released.push(Number(issue.number));
    }
  }

  return { released_count: released.length, released_issues: released, now };
}
