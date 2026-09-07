import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { afterEach } from "node:test";

import {
  resetAnalysisLensFollowupCandidatesRuntimeForTest,
  runAnalysisLensFollowupCandidates,
  setAnalysisLensFollowupCandidatesRuntimeForTest,
} from "../../src/commands/analysis/lens-followup-candidates.ts";

function sha256(value = "") {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function renderGeneratedCandidateBlock({ action, reportIssueNumber = 2188, repo = "recallnet/astrochicken", factoryId = "mothership", runId = "", publicationSha = "" } = {}) {
  const evidenceLinks = Array.isArray(action?.evidence_links)
    ? action.evidence_links.map((e) => (typeof e === "string" ? e : String(e?.ref || e?.url || e?.id || e?.type || "").trim())).filter(Boolean)
    : [];
  const dependencyHints = Array.isArray(action?.dependency_hints)
    ? action.dependency_hints.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
  const recommendation = String(action?.recommendation || "").trim();
  const implementationHints = String(action?.implementation_hints || action?.implementationHints || action?.impact_notes || action?.detail || "").trim();
  const whyNow = String(action?.why_now || action?.whyNow || action?.impact_notes || action?.detail || action?.summary || "").trim();
  const successMetric = String(action?.success_metric || action?.successMetric || "Candidate issue reaches merged or closed state with evidence-backed completion notes.").trim();
  const executionOwner = String(action?.execution_owner || action?.executionOwner || "supervisor_on_main").trim() || "supervisor_on_main";
  const normalizedTitle = String(action?.title || action?.summary || "").trim();
  const normalizedSummary = String(action?.summary || action?.title || "").trim();

  const evidenceSection = evidenceLinks.length > 0
    ? `\n## Evidence links\n${evidenceLinks.map((ref) => `- ${ref}`).join("\n")}`
    : "";
  const recommendationSection = recommendation
    ? `\n## Recommendation\n${recommendation}`
    : "";
  const dependencySection = dependencyHints.length > 0
    ? `\n## Dependency hints\n${dependencyHints.map((hint) => `- ${hint}`).join("\n")}`
    : "";
  const implementationSection = implementationHints
    ? `\n## Implementation hints\n${implementationHints}`
    : "\n## Implementation hints\n- Convert this candidate into execution-ready steps during operator review.";

  return [
    "## Action title",
    normalizedTitle,
    "\n## Summary",
    normalizedSummary,
    `\n## Why now\n${whyNow || "Not provided."}`,
    `\n## Success metric\n${successMetric || "Not provided."}`,
    recommendationSection,
    `\n## Execution owner\n${executionOwner}`,
    implementationSection,
    dependencySection,
    evidenceSection,
    "\n## Provenance",
    `- Origin report: #${reportIssueNumber} (https://github.com/${repo}/issues/${reportIssueNumber})`,
    `- Action id: ${String(action?.id || "").trim()}`,
    `- Action type: ${String(action?.type || "task").trim() || "task"}`,
    `- Execution owner: ${executionOwner}`,
    `- Elevation: ${String(action?.elevation || "unspecified").trim() || "unspecified"}`,
    `- Candidate source: ${String(action?.source || "suggestions").trim() || "suggestions"}`,
    `- Factory id: ${factoryId}`,
    `- Report run id: ${runId || "n/a"}`,
    `- Publication SHA: ${publicationSha || "n/a"}`,
  ].join("\n");
}

function buildGeneratedFieldsHash({ action, reportIssueNumber = 2188, repo = "recallnet/astrochicken", factoryId = "mothership" } = {}) {
  const generatedFields = {
    report_issue_number: Number(reportIssueNumber),
    action_id: String(action?.id || "").trim(),
    title: String(action?.title || action?.summary || "").trim(),
    summary: String(action?.summary || action?.title || "").trim(),
    why_now: String(action?.why_now || action?.whyNow || action?.impact_notes || action?.detail || action?.summary || "").trim(),
    success_metric: String(action?.success_metric || action?.successMetric || "Candidate issue reaches merged or closed state with evidence-backed completion notes.").trim(),
    recommendation: String(action?.recommendation || "").trim(),
    implementation_hints: String(action?.implementation_hints || action?.implementationHints || action?.impact_notes || action?.detail || "").trim(),
    dependency_hints: Array.isArray(action?.dependency_hints)
      ? action.dependency_hints.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [],
    evidence_links: Array.isArray(action?.evidence_links)
      ? action.evidence_links.map((e) => (typeof e === "string" ? e : String(e?.ref || e?.url || e?.id || e?.type || "").trim())).filter(Boolean)
      : [],
    action_type: String(action?.type || "task").trim() || "task",
    execution_owner: String(action?.execution_owner || action?.executionOwner || "supervisor_on_main").trim() || "supervisor_on_main",
    elevation: String(action?.elevation || "unspecified").trim() || "unspecified",
    source_repo: repo,
    factory_id: factoryId,
    candidate_source: String(action?.source || "suggestions").trim() || "suggestions",
  };
  return sha256(JSON.stringify(generatedFields));
}

afterEach(() => {
  resetAnalysisLensFollowupCandidatesRuntimeForTest();
});

test("runAnalysisLensFollowupCandidates creates candidate issues, links sub-issues, and patches report metadata", async () => {
  const createCalls = [];
  const linkCalls = [];
  const updateCalls = [];

  setAnalysisLensFollowupCandidatesRuntimeForTest({
    readFile: () => JSON.stringify({
      action_registry: [
        {
          id: "lens-2026-03-16-001",
          type: "task",
          title: "Add lease chaos regression coverage",
          summary: "Add lease chaos regression coverage",
          why_now: "Lease churn incidents repeated across the latest window.",
          success_metric: "Regression proves stable lease behavior over 3 consecutive runs.",
          recommendation: "Create deterministic regression for lease churn.",
          evidence_links: [{ ref: "langfuse.trace:123" }],
          dependency_hints: ["Coordinate with retry budget telemetry update"],
          execution_owner: "supervisor_on_main",
        },
      ],
    }),
    listGoalSubIssues: () => [],
    applySuggestionStatusUpdates: () => ({
      applied_ids: ["lens-2026-03-16-001"],
      skipped_ids: [],
      missing_ids: [],
      pending_count: 3,
    }),
    createIssue: ({ repo, issueSpecRaw }) => {
      createCalls.push({ repo, issueSpecRaw: JSON.parse(issueSpecRaw) });
      return {
        ok: true,
        issue_url: "https://github.com/recallnet/astrochicken/issues/2205",
        created_issue_number: "2205",
      };
    },
    addSubIssue: ({ repo, parentNumber, childNumber }) => {
      linkCalls.push({ repo, parentNumber, childNumber });
      return { ok: true };
    },
    updateIssue: ({ repo, issueUrl, issueSpecRaw }) => {
      updateCalls.push({ repo, issueUrl, issueSpecRaw: JSON.parse(issueSpecRaw) });
      return { ok: true, issue_url: issueUrl };
    },
    ghJson: (args) => {
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2188") {
        return {
          number: 2188,
          url: "https://github.com/recallnet/astrochicken/issues/2188",
          title: "Daily Lens Report — 2026-03-16",
          body: "Report body",
        };
      }
      return {};
    },
    ghJsonPaginated: () => [],
    commentIssue: () => ({ ok: true }),
  });

  const out = await runAnalysisLensFollowupCandidates({
    repo: "recallnet/astrochicken",
    reportIssueNumber: 2188,
    analysisPath: "/tmp/analysis-output.json",
    runId: "run-456",
    publicationSha: "abc123",
    factoryId: "mothership",
  });

  assert.equal(out.ok, true);
  assert.equal(out.created_count, 1);
  assert.equal(out.updated_count, 0);
  assert.equal(out.reused_count, 0);
  assert.equal(out.reconciled_count, 0);
  assert.equal(createCalls.length, 1);
  assert.equal(linkCalls.length, 1);
  assert.equal(updateCalls.length, 1);

  assert.equal(createCalls[0].issueSpecRaw.issue_labels, "daily-lens,daily-lens-candidate");
  assert.match(createCalls[0].issueSpecRaw.issue_body, /DL-Candidate-Generated:START/);
  assert.match(createCalls[0].issueSpecRaw.issue_body, /DL-Candidate-Metadata:/);

  assert.equal(linkCalls[0].parentNumber, 2188);
  assert.equal(linkCalls[0].childNumber, 2205);

  assert.equal(updateCalls[0].issueUrl, "https://github.com/recallnet/astrochicken/issues/2188");
  // When sub-issues are created, the goal label is added to the parent report issue
  assert.ok(
    updateCalls[0].issueSpecRaw.issue_labels === "goal"
    || (typeof updateCalls[0].issueSpecRaw.issue_labels === "string"
      && updateCalls[0].issueSpecRaw.issue_labels.split(",").includes("goal")),
    `parent issue update should include goal label when sub-issues are created; got: ${updateCalls[0].issueSpecRaw.issue_labels}`,
  );
  assert.match(updateCalls[0].issueSpecRaw.issue_body, /DL-Report-Candidate-Metadata:/);

  assert.match(createCalls[0].issueSpecRaw.issue_body, /## Why now/);
  assert.match(createCalls[0].issueSpecRaw.issue_body, /## Success metric/);
  assert.match(createCalls[0].issueSpecRaw.issue_body, /## Execution owner/);
  assert.match(createCalls[0].issueSpecRaw.issue_body, /## Dependency hints/);
  assert.deepEqual(out.learning_log_status, {
    applied_ids: ["lens-2026-03-16-001"],
    skipped_ids: [],
    missing_ids: [],
    pending_count: 3,
  });
});

test("runAnalysisLensFollowupCandidates reuses existing candidate when generated fields are unchanged", async () => {
  const updateCalls = [];
  const createCalls = [];

  const action = {
    id: "lens-2026-03-16-001",
    type: "task",
    title: "Add lease chaos regression coverage",
    summary: "Add lease chaos regression coverage",
    why_now: "Lease churn incidents repeated across the latest window.",
    success_metric: "Regression proves stable lease behavior over 3 consecutive runs.",
    recommendation: "Add a deterministic lease regression and fix the lease churn path.",
    evidence_links: ["langfuse.trace:123"],
    dependency_hints: [],
    source: "action_registry",
    execution_owner: "supervisor_on_main",
  };
  const managedBlock = renderGeneratedCandidateBlock({ action, reportIssueNumber: 2188, runId: "run-old", publicationSha: "old" });
  const existingBody = [
    "<!-- DL-Candidate-Generated:START -->",
    managedBlock,
    "<!-- DL-Candidate-Generated:END -->",
    "",
    "## Operator notes",
    "- human edit",
    "",
    `<!-- DL-Candidate-Metadata: ${JSON.stringify({
      schema: "daily_lens_candidate.v1",
      schema_version: 1,
      report_issue_number: 2188,
      action_id: action.id,
      factory_id: "mothership",
      report_run_id: "run-old",
      publication_sha: "old",
      generated_fields_hash: buildGeneratedFieldsHash({ action, reportIssueNumber: 2188 }),
      managed_block_hash: sha256(managedBlock),
    })} -->`,
  ].join("\n");

  setAnalysisLensFollowupCandidatesRuntimeForTest({
    readFile: () => JSON.stringify({ action_registry: [action] }),
    listGoalSubIssues: () => [{ number: 2205, title: "existing", state: "open" }],
    ghJson: (args) => {
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2205") {
        return {
          number: 2205,
          url: "https://github.com/recallnet/astrochicken/issues/2205",
          title: "Daily Lens follow-up: Add lease chaos regression coverage",
          body: existingBody,
        };
      }
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2188") {
        return {
          number: 2188,
          url: "https://github.com/recallnet/astrochicken/issues/2188",
          title: "Daily Lens Report — 2026-03-16",
          body: "report body",
        };
      }
      return {};
    },
    ghJsonPaginated: () => [],
    updateIssue: ({ repo, issueUrl, issueSpecRaw }) => {
      updateCalls.push({ repo, issueUrl, issueSpecRaw: JSON.parse(issueSpecRaw) });
      return { ok: true, issue_url: issueUrl };
    },
    createIssue: () => {
      createCalls.push(true);
      return { ok: true };
    },
    addSubIssue: () => ({ ok: true }),
    commentIssue: () => ({ ok: true }),
  });

  const out = await runAnalysisLensFollowupCandidates({
    repo: "recallnet/astrochicken",
    reportIssueNumber: 2188,
    analysisPath: "/tmp/analysis-output.json",
    runId: "run-789",
    publicationSha: "newsha",
    factoryId: "mothership",
  });

  assert.equal(out.ok, true);
  assert.equal(out.created_count, 0);
  assert.equal(out.updated_count, 0);
  assert.equal(out.reused_count, 1);
  assert.equal(out.reconciled_count, 0);
  assert.equal(createCalls.length, 0);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].issueUrl, "https://github.com/recallnet/astrochicken/issues/2188");
});

test("runAnalysisLensFollowupCandidates updates generated block and preserves operator notes when summary changes", async () => {
  const updateCalls = [];

  const oldAction = {
    id: "lens-2026-03-16-001",
    type: "task",
    title: "Old summary",
    summary: "Old summary",
    why_now: "Legacy note",
    success_metric: "Legacy metric",
    recommendation: "Replace the legacy action with the new deterministic fix.",
    evidence_links: ["#2188"],
    dependency_hints: [],
    source: "action_registry",
    execution_owner: "supervisor_on_main",
  };
  const oldManagedBlock = renderGeneratedCandidateBlock({ action: oldAction, reportIssueNumber: 2188, runId: "run-old", publicationSha: "old" });

  const existingBody = [
    "<!-- DL-Candidate-Generated:START -->",
    oldManagedBlock,
    "<!-- DL-Candidate-Generated:END -->",
    "",
    "## Operator notes",
    "- retain this note",
    "",
    `<!-- DL-Candidate-Metadata: ${JSON.stringify({
      schema: "daily_lens_candidate.v1",
      schema_version: 1,
      report_issue_number: 2188,
      action_id: oldAction.id,
      factory_id: "mothership",
      report_run_id: "run-old",
      publication_sha: "old",
      generated_fields_hash: "oldhash",
      managed_block_hash: sha256(oldManagedBlock),
    })} -->`,
  ].join("\n");

  setAnalysisLensFollowupCandidatesRuntimeForTest({
    readFile: () => JSON.stringify({
      action_registry: [
        {
          id: "lens-2026-03-16-001",
          type: "task",
          title: "New summary",
          summary: "New summary",
          why_now: "new why now",
          success_metric: "new metric",
          recommendation: "Apply the new deterministic fix path.",
          dependency_hints: ["depends on review timeout tuning"],
          evidence_links: ["langfuse.trace:new"],
          implementation_hints: "new hints",
          execution_owner: "supervisor_on_main",
        },
      ],
    }),
    listGoalSubIssues: () => [{ number: 2205, title: "existing", state: "open" }],
    ghJson: (args) => {
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2205") {
        return {
          number: 2205,
          url: "https://github.com/recallnet/astrochicken/issues/2205",
          title: "Daily Lens follow-up",
          body: existingBody,
        };
      }
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2188") {
        return {
          number: 2188,
          url: "https://github.com/recallnet/astrochicken/issues/2188",
          title: "Daily Lens Report — 2026-03-16",
          body: "report body",
        };
      }
      return {};
    },
    ghJsonPaginated: () => [],
    updateIssue: ({ repo, issueUrl, issueSpecRaw }) => {
      updateCalls.push({ repo, issueUrl, issueSpecRaw: JSON.parse(issueSpecRaw) });
      return { ok: true, issue_url: issueUrl };
    },
    createIssue: () => ({ ok: true }),
    addSubIssue: () => ({ ok: true }),
    commentIssue: () => ({ ok: true }),
  });

  const out = await runAnalysisLensFollowupCandidates({
    repo: "recallnet/astrochicken",
    reportIssueNumber: 2188,
    analysisPath: "/tmp/analysis-output.json",
    runId: "run-790",
    factoryId: "mothership",
  });

  assert.equal(out.updated_count, 1);
  const candidateUpdate = updateCalls.find((call) => call.issueUrl.endsWith("/2205"));
  assert.ok(candidateUpdate, "expected candidate update call");
  assert.match(candidateUpdate.issueSpecRaw.issue_body, /New summary/);
  assert.match(candidateUpdate.issueSpecRaw.issue_body, /retain this note/);
  assert.match(candidateUpdate.issueSpecRaw.issue_body, /DL-Candidate-Metadata:/);
});

test("runAnalysisLensFollowupCandidates posts reconciliation comment when managed block was edited", async () => {
  const commentCalls = [];
  const updateCalls = [];

  const existingBody = [
    "<!-- DL-Candidate-Generated:START -->",
    "## Summary",
    "operator changed managed summary",
    "<!-- DL-Candidate-Generated:END -->",
    "",
    "## Operator notes",
    "- retain",
    "",
    "<!-- DL-Candidate-Metadata: {\"schema\":\"daily_lens_candidate.v1\",\"schema_version\":1,\"report_issue_number\":2188,\"action_id\":\"lens-2026-03-16-001\",\"factory_id\":\"mothership\",\"report_run_id\":\"run-old\",\"publication_sha\":\"old\",\"generated_fields_hash\":\"oldhash\",\"managed_block_hash\":\"expected-old-managed-hash\"} -->",
  ].join("\n");

  setAnalysisLensFollowupCandidatesRuntimeForTest({
    readFile: () => JSON.stringify({
      action_registry: [
        {
          id: "lens-2026-03-16-001",
          type: "task",
          title: "new machine summary",
          summary: "new machine summary",
          why_now: "because evidence changed",
          success_metric: "metric",
          recommendation: "Regenerate the managed block from the updated evidence.",
          evidence_links: ["langfuse.trace:changed"],
          dependency_hints: [],
          execution_owner: "supervisor_on_main",
        },
      ],
    }),
    listGoalSubIssues: () => [{ number: 2205, title: "existing", state: "open" }],
    ghJson: (args) => {
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2205") {
        return {
          number: 2205,
          url: "https://github.com/recallnet/astrochicken/issues/2205",
          title: "Daily Lens follow-up",
          body: existingBody,
        };
      }
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2188") {
        return {
          number: 2188,
          url: "https://github.com/recallnet/astrochicken/issues/2188",
          title: "Daily Lens Report — 2026-03-16",
          body: "report body",
        };
      }
      return {};
    },
    ghJsonPaginated: () => [],
    updateIssue: ({ repo, issueUrl, issueSpecRaw }) => {
      updateCalls.push({ repo, issueUrl, issueSpecRaw: JSON.parse(issueSpecRaw) });
      return { ok: true, issue_url: issueUrl };
    },
    createIssue: () => ({ ok: true }),
    addSubIssue: () => ({ ok: true }),
    commentIssue: ({ repo, issueNumber, body }) => {
      commentCalls.push({ repo, issueNumber, body });
      return { ok: true };
    },
  });

  const out = await runAnalysisLensFollowupCandidates({
    repo: "recallnet/astrochicken",
    reportIssueNumber: 2188,
    analysisPath: "/tmp/analysis-output.json",
    runId: "run-991",
    factoryId: "mothership",
  });

  assert.equal(out.updated_count, 0);
  assert.equal(out.reconciled_count, 1);
  assert.equal(commentCalls.length, 1);
  assert.equal(commentCalls[0].issueNumber, 2205);
  assert.match(commentCalls[0].body, /Skipping automatic overwrite/);

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].issueUrl, "https://github.com/recallnet/astrochicken/issues/2188");
});

test("runAnalysisLensFollowupCandidates supports legacy suggestions fallback", async () => {
  const createCalls = [];
  const linkCalls = [];

  setAnalysisLensFollowupCandidatesRuntimeForTest({
    readFile: () => JSON.stringify({
      suggestions: [
        {
          id: "lens-2026-03-16-001",
          summary: "legacy summary",
          type: "task",
          evidence_refs: ["langfuse.trace:legacy"],
        },
      ],
    }),
    listGoalSubIssues: () => [],
    createIssue: ({ repo, issueSpecRaw }) => {
      createCalls.push({ repo, issueSpecRaw: JSON.parse(issueSpecRaw) });
      return {
        ok: true,
        issue_url: "https://github.com/recallnet/astrochicken/issues/2206",
        created_issue_number: "2206",
      };
    },
    addSubIssue: ({ repo, parentNumber, childNumber }) => {
      linkCalls.push({ repo, parentNumber, childNumber });
      return { ok: true };
    },
    updateIssue: ({ repo, issueUrl, issueSpecRaw }) => ({ ok: true, issue_url: issueUrl, repo, issueSpecRaw }),
    ghJson: (args) => {
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2188") {
        return {
          number: 2188,
          url: "https://github.com/recallnet/astrochicken/issues/2188",
          title: "Daily Lens Report — 2026-03-16",
          body: "Report body",
        };
      }
      return {};
    },
    ghJsonPaginated: () => [],
    commentIssue: () => ({ ok: true }),
  });

  const out = await runAnalysisLensFollowupCandidates({
    repo: "recallnet/astrochicken",
    reportIssueNumber: 2188,
    analysisPath: "/tmp/analysis-output.json",
    runId: "run-legacy",
    factoryId: "mothership",
  });

  assert.equal(out.ok, true);
  assert.equal(out.created_count, 1);
  assert.equal(createCalls.length, 1);
  assert.equal(linkCalls.length, 1);
  assert.match(createCalls[0].issueSpecRaw.issue_body, /## Why now/);
  assert.match(createCalls[0].issueSpecRaw.issue_body, /legacy summary/);
});

test("runAnalysisLensFollowupCandidates returns empty result when action registry schema is missing", async () => {
  setAnalysisLensFollowupCandidatesRuntimeForTest({
    readFile: () => JSON.stringify({ findings: [] }),
    ghJson: () => ({}),
    ghJsonPaginated: () => [],
    updateIssue: ({ issueUrl }) => ({ ok: true, issue_url: issueUrl }),
  });

  const out = await runAnalysisLensFollowupCandidates({
    repo: "recallnet/astrochicken",
    reportIssueNumber: 2188,
    analysisPath: "/tmp/analysis-output.json",
  });

  assert.equal(out.ok, true);
  assert.equal(out.created_count, 0);
  assert.equal(out.updated_count, 0);
});

test("runAnalysisLensFollowupCandidates skips invalid or low-quality action_registry entries", async () => {
  setAnalysisLensFollowupCandidatesRuntimeForTest({
    readFile: () => JSON.stringify({
      action_registry: [{
        id: "lens-2026-03-16-001",
        type: "task",
        title: "missing success metric",
        why_now: "because",
        evidence_links: [],
        dependency_hints: [],
      }],
    }),
    ghJson: () => ({}),
    ghJsonPaginated: () => [],
    updateIssue: ({ issueUrl }) => ({ ok: true, issue_url: issueUrl }),
    applySuggestionStatusUpdates: () => ({
      applied_ids: [],
      skipped_ids: [],
      missing_ids: [],
      pending_count: 0,
    }),
  });

  const out = await runAnalysisLensFollowupCandidates({
    repo: "recallnet/astrochicken",
    reportIssueNumber: 2188,
    analysisPath: "/tmp/analysis-output.json",
  });

  assert.equal(out.ok, true);
  assert.equal(out.created_count, 0);
  assert.equal(out.updated_count, 0);
});

test("runAnalysisLensFollowupCandidates marks superseded suggestions dismissed in learning log updates", async () => {
  const learningLogCalls = [];

  setAnalysisLensFollowupCandidatesRuntimeForTest({
    readFile: () => JSON.stringify({
      action_registry: [
        {
          id: "lens-2026-03-21-002",
          type: "task",
          title: "Fix Langfuse metrics attribution",
          summary: "Fix Langfuse metrics attribution",
          why_now: "Metrics API bug now supersedes sug-2026-03-17-06.",
          success_metric: "Collector has healthy cost attribution again.",
          recommendation: "Fix the metrics endpoint and remove duplicate tracker items.",
          evidence_links: ["langfuse collector: HTTP 405"],
          dependency_hints: ["lens-2026-03-21-002 supersedes sug-2026-03-17-06 and langfuse-model-attribution-fix"],
          execution_owner: "supervisor_on_main",
        },
      ],
    }),
    listGoalSubIssues: () => [],
    createIssue: () => ({
      ok: true,
      issue_url: "https://github.com/recallnet/astrochicken/issues/2250",
      created_issue_number: "2250",
    }),
    addSubIssue: () => ({ ok: true }),
    ghJson: (args) => {
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2188") {
        return {
          number: 2188,
          url: "https://github.com/recallnet/astrochicken/issues/2188",
          title: "Daily Lens Report — 2026-03-21",
          body: "report body",
        };
      }
      return {};
    },
    ghJsonPaginated: () => [],
    updateIssue: ({ issueUrl }) => ({ ok: true, issue_url: issueUrl }),
    commentIssue: () => ({ ok: true }),
    applySuggestionStatusUpdates: ({ logPath, updates }) => {
      learningLogCalls.push({ logPath, updates });
      return {
        applied_ids: updates.map((entry) => entry.id),
        skipped_ids: [],
        missing_ids: [],
        pending_count: 6,
      };
    },
  });

  const out = await runAnalysisLensFollowupCandidates({
    repo: "recallnet/astrochicken",
    reportIssueNumber: 2188,
    analysisPath: "/tmp/analysis-output.json",
    learningLogPath: "/tmp/custom-learning-log.json",
  });

  assert.equal(out.ok, true);
  assert.equal(learningLogCalls.length, 1);
  assert.equal(learningLogCalls[0].logPath, "/tmp/custom-learning-log.json");

  const updatesById = new Map(learningLogCalls[0].updates.map((entry) => [entry.id, entry]));
  assert.equal(updatesById.get("lens-2026-03-21-002")?.status, "adopted");
  assert.equal(updatesById.get("sug-2026-03-17-06")?.status, "dismissed");
  assert.equal(updatesById.get("langfuse-model-attribution-fix")?.status, "dismissed");
  assert.match(updatesById.get("sug-2026-03-17-06")?.impactNotes || "", /Superseded by lens-2026-03-21-002/);
  assert.match(updatesById.get("langfuse-model-attribution-fix")?.impactNotes || "", /Superseded by lens-2026-03-21-002/);
});

test("runAnalysisLensFollowupCandidates adds goal label to parent issue when sub-issues are created", async () => {
  const ghCalls = [];
  const updateCalls = [];

  setAnalysisLensFollowupCandidatesRuntimeForTest({
    readFile: () => JSON.stringify({
      action_registry: [
        {
          id: "lens-2026-03-16-001",
          type: "task",
          title: "Add lease chaos regression coverage",
          summary: "Add lease chaos regression coverage",
          why_now: "Lease churn incidents repeated across the latest window.",
          success_metric: "Regression proves stable lease behavior over 3 consecutive runs.",
          recommendation: "Create deterministic regression for lease churn.",
          evidence_links: [{ ref: "langfuse.trace:123" }],
          dependency_hints: [],
          execution_owner: "supervisor_on_main",
        },
      ],
    }),
    listGoalSubIssues: () => [],
    applySuggestionStatusUpdates: () => ({
      applied_ids: ["lens-2026-03-16-001"],
      skipped_ids: [],
      missing_ids: [],
      pending_count: 0,
    }),
    createIssue: ({ repo, issueSpecRaw }) => {
      ghCalls.push({ type: "createIssue", repo, issueSpecRaw: JSON.parse(issueSpecRaw) });
      return {
        ok: true,
        issue_url: "https://github.com/recallnet/astrochicken/issues/2500",
        created_issue_number: "2500",
      };
    },
    addSubIssue: ({ repo, parentNumber, childNumber }) => {
      ghCalls.push({ type: "addSubIssue", repo, parentNumber, childNumber });
      return { ok: true };
    },
    updateIssue: ({ repo, issueUrl, issueSpecRaw }) => {
      const parsed = JSON.parse(issueSpecRaw);
      updateCalls.push({ repo, issueUrl, issueSpecRaw: parsed });
      return { ok: true, issue_url: issueUrl };
    },
    ghJson: (args) => {
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2188") {
        return {
          number: 2188,
          url: "https://github.com/recallnet/astrochicken/issues/2188",
          title: "Daily Lens Report — 2026-03-16",
          body: "Report body",
        };
      }
      return {};
    },
    ghJsonPaginated: () => [],
    commentIssue: () => ({ ok: true }),
  });

  const out = await runAnalysisLensFollowupCandidates({
    repo: "recallnet/astrochicken",
    reportIssueNumber: 2188,
    analysisPath: "/tmp/analysis-output.json",
    runId: "run-goal-label",
    publicationSha: "sha-goal-label",
    factoryId: "mothership",
  });

  assert.equal(out.ok, true);
  assert.equal(out.created_count, 1);

  // The parent report issue update must include the "goal" label
  const parentUpdate = updateCalls.find((call) => call.issueUrl === "https://github.com/recallnet/astrochicken/issues/2188");
  assert.ok(parentUpdate, "parent issue should be updated");
  assert.ok(
    parentUpdate.issueSpecRaw.issue_labels === "goal"
    || (typeof parentUpdate.issueSpecRaw.issue_labels === "string" && parentUpdate.issueSpecRaw.issue_labels.split(",").includes("goal")),
    `parent issue update should include goal label; got: ${parentUpdate.issueSpecRaw.issue_labels}`,
  );
});
