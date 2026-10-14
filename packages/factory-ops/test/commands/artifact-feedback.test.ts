import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";


import { buildDispositionComment, buildFixedInVersionComment, postDispositionFeedback, postFixedInVersionArtifactFeedback, shouldSkipDispositionFeedback, shouldSkipFixedInVersionFeedback } from "../../src/commands/artifact-feedback.ts";
import { parseControlPlaneBlocker } from "../../src/lib/control-plane-blocker.ts";

function makeGhMock(dir, fixturePath) {
  mkdirSync(dir, { recursive: true });
  const ghPath = join(dir, "gh");
  writeFileSync(
    ghPath,
    `#!/usr/bin/env node
import { readFileSync, appendFileSync, existsSync } from "node:fs";

const fixturePath = process.env.ARTIFACT_FEEDBACK_FIXTURE;
const callsPath = process.env.ARTIFACT_FEEDBACK_CALLS_PATH;
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const args = process.argv.slice(2);

const record = (entry) => {
  if (!callsPath) return;
  appendFileSync(callsPath, JSON.stringify(entry) + "\\n", "utf8");
};

if (args[0] === "api" && String(args[1] || "").includes("/comments")) {
  record({ kind: "api", args });
  const issueMatch = String(args[1] || "").match(/issues\\\/(\\d+)\\\/comments/);
  const issue = issueMatch ? issueMatch[1] : "";
  const comments = fixture.comments?.[issue] || [];
  process.stdout.write(JSON.stringify(comments));
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "comment") {
  record({ kind: "comment", args });
  if (fixture.comment_failure) {
    process.stderr.write(String(fixture.comment_failure));
    process.exit(1);
  }
  process.stdout.write("ok");
  process.exit(0);
}

record({ kind: "other", args });
process.stdout.write(existsSync(fixturePath) ? "[]" : "");
`,
    "utf8",
  );
  chmodSync(ghPath, 0o755);
}

function readCalls(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("buildFixedInVersionComment renders deterministic release identity + manifest path", () => {
  const body = buildFixedInVersionComment({
    releaseIdentity: {
      release_id: "v2.1.0",
      release_tag: "v2.1.0",
      release_sha: "abc123",
    },
    manifestPath: ".hatch/releases/v2.1.0/release-manifest.json",
  });

  assert.equal(
    body,
    "Fixed in version v2.1.0 (v2.1.0, abc123) — manifest: .hatch/releases/v2.1.0/release-manifest.json",
  );
});

test("shouldSkipFixedInVersionFeedback detects manifest metadata dedupe", () => {
  const skip = shouldSkipFixedInVersionFeedback({
    manifestEntry: {
      linkage: {
        fixed_in_version: "v2.1.0",
        fixed_in_manifest: ".hatch/releases/v2.1.0/release-manifest.json",
      },
    },
    releaseIdentity: {
      release_id: "v2.1.0",
      release_tag: "v2.1.0",
      release_sha: "abc123",
    },
    manifestPath: ".hatch/releases/v2.1.0/release-manifest.json",
  });

  assert.equal(skip, true);
});

test("postFixedInVersionArtifactFeedback comments when metadata is not recorded", () => {
  const calls = [];
  const out = postFixedInVersionArtifactFeedback({
    source_repo: "example/external-factory",
    source_issue: 101,
    releaseIdentity: {
      release_id: "v2.1.0",
      release_tag: "v2.1.0",
      release_sha: "abc123",
    },
    manifestPath: ".hatch/releases/v2.1.0/release-manifest.json",
    manifestEntry: {
      linkage: {
        fixed_in_version: "",
        fixed_in_manifest: "",
      },
    },
    issueCommentFn: ({ repo, issueNumber, body }) => {
      calls.push({ repo, issueNumber, body });
      return { ok: true, stdout: "", stderr: "" };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.skipped, false);
  assert.equal(out.reason, "comment_posted");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repo, "example/external-factory");
  assert.equal(calls[0].issueNumber, 101);
  assert.match(calls[0].body, /Fixed in version v2.1.0/);
  assert.match(calls[0].body, /manifest: \.hatch\/releases\/v2\.1\.0\/release-manifest\.json/);
});

test("postFixedInVersionArtifactFeedback skips duplicate feedback when metadata already recorded", () => {
  const out = postFixedInVersionArtifactFeedback({
    source_repo: "example/external-factory",
    source_issue: 101,
    releaseIdentity: {
      release_id: "v2.1.0",
      release_tag: "v2.1.0",
      release_sha: "abc123",
    },
    manifestPath: ".hatch/releases/v2.1.0/release-manifest.json",
    manifestEntry: {
      linkage: {
        fixed_in_version: "v2.1.0",
        fixed_in_manifest: ".hatch/releases/v2.1.0/release-manifest.json",
      },
    },
    issueCommentFn: () => {
      throw new Error("should_not_comment_when_deduped");
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.skipped, true);
  assert.equal(out.reason, "already_recorded");
});

test("postFixedInVersionArtifactFeedback reports deterministic failure on gh comment error", () => {
  const out = postFixedInVersionArtifactFeedback({
    source_repo: "example/external-factory",
    source_issue: 101,
    releaseIdentity: {
      release_id: "v2.1.0",
      release_tag: "v2.1.0",
      release_sha: "abc123",
    },
    manifestPath: ".hatch/releases/v2.1.0/release-manifest.json",
    manifestEntry: {
      linkage: {
        fixed_in_version: "",
        fixed_in_manifest: "",
      },
    },
    issueCommentFn: () => ({ ok: false, stderr: "rate limit" }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.skipped, false);
  assert.equal(out.reason, "issue_comment_failed");
  assert.match(String(out.error || ""), /rate limit/);
});

function assertMarkerShape(body = "") {
  const parsed = parseControlPlaneBlocker({ body });
  assert.match(body, /control_plane_blocker\.v1:/);
  return parsed;
}

test("buildDispositionComment renders fixed_released as resumed marker with release identity", () => {
  const body = buildDispositionComment({
    disposition: "fixed_released",
    blockerRef: "#1234",
    releaseIdentity: {
      release_id: "v3.2.1",
      release_tag: "v3.2.1",
      release_sha: "deadbeef",
    },
    manifestPath: ".hatch/runs/run-1/artifacts/release-manifest.json",
  });

  const marker = assertMarkerShape(body);
  assert.equal(marker.status, "resumed");
  assert.equal(marker.releaseId, "v3.2.1");
  assert.equal(marker.releaseTag, "v3.2.1");
  assert.equal(marker.releaseSha, "deadbeef");
  assert.equal(marker.manifestPath, ".hatch/runs/run-1/artifacts/release-manifest.json");
});

test("buildDispositionComment renders fixed_main_unreleased as blocked release_floor", () => {
  const body = buildDispositionComment({
    disposition: "fixed_main_unreleased",
    releaseIdentity: { release_id: "v9.9.9" },
  });

  const marker = assertMarkerShape(body);
  assert.equal(marker.status, "blocked");
  assert.equal(marker.kind, "release_floor");
  assert.match(marker.unblockCondition, /Requires release of v9\.9\.9|Pending release/);
});

test("buildDispositionComment renders rejected and superseded with blockerRef", () => {
  const rejected = assertMarkerShape(buildDispositionComment({
    disposition: "rejected",
    blockerRef: "#4040",
  }));
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.blockerRef, "#4040");

  const superseded = assertMarkerShape(buildDispositionComment({
    disposition: "superseded",
    blockerRef: "#5050",
  }));
  assert.equal(superseded.status, "superseded");
  assert.equal(superseded.blockerRef, "#5050");
});

test("buildDispositionComment renders blocked_upstream as blocked upstream_bug", () => {
  const marker = assertMarkerShape(buildDispositionComment({
    disposition: "blocked_upstream",
    blockerRef: "#7777",
  }));
  assert.equal(marker.status, "blocked");
  assert.equal(marker.kind, "upstream_bug");
  assert.match(marker.unblockCondition, /#7777|upstream dependency/i);
});

test("shouldSkipDispositionFeedback skips when existing comment already records target status", () => {
  const skip = shouldSkipDispositionFeedback({
    disposition: "rejected",
    existingComments: [
      { body: "control_plane_blocker.v1:{\"kind\":\"upstream_rejected\",\"blockerRef\":\"#123\",\"unblockCondition\":\"n/a\",\"status\":\"rejected\"}" },
    ],
  });
  assert.equal(skip.skip, true);
  assert.equal(skip.reason, "already_recorded");
});

test("shouldSkipDispositionFeedback does not skip when statuses differ", () => {
  const skip = shouldSkipDispositionFeedback({
    disposition: "rejected",
    existingComments: [
      { body: "control_plane_blocker.v1:{\"kind\":\"upstream_bug\",\"status\":\"blocked\"}" },
    ],
  });
  assert.equal(skip.skip, false);
});

test("postDispositionFeedback returns missing_source_reference for invalid source", () => {
  const out = postDispositionFeedback({
    source_repo: "",
    source_issue: 0,
    disposition: "fixed_released",
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "missing_source_reference");
});

test("postDispositionFeedback returns invalid_disposition for unknown status", () => {
  const out = postDispositionFeedback({
    source_repo: "example/external-factory",
    source_issue: 42,
    disposition: "unknown_status",
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "invalid_disposition");
});

test("postDispositionFeedback returns already_recorded when skip matches", () => {
  let commentCalls = 0;
  const out = postDispositionFeedback({
    source_repo: "example/external-factory",
    source_issue: 42,
    disposition: "superseded",
    listCommentsFn: () => ({
      ok: true,
      comments: [{ body: "control_plane_blocker.v1:{\"status\":\"superseded\"}" }],
    }),
    issueCommentFn: () => {
      commentCalls += 1;
      return { ok: true };
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.skipped, true);
  assert.equal(out.reason, "already_recorded");
  assert.equal(commentCalls, 0);
});

test("postDispositionFeedback returns comment_failed when issue comment errors", () => {
  const out = postDispositionFeedback({
    source_repo: "example/external-factory",
    source_issue: 42,
    disposition: "blocked_upstream",
    blockerRef: "#999",
    listCommentsFn: () => ({ ok: true, comments: [] }),
    issueCommentFn: () => ({ ok: false, stderr: "permission denied" }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.reason, "comment_failed");
  assert.match(String(out.stderr || ""), /permission denied/i);
});

test("postDispositionFeedback posts for all five dispositions", () => {
  const dispositions = [
    "fixed_released",
    "fixed_main_unreleased",
    "rejected",
    "superseded",
    "blocked_upstream",
  ];

  for (const disposition of dispositions) {
    let posted = "";
    const out = postDispositionFeedback({
      source_repo: "example/external-factory",
      source_issue: 4242,
      disposition,
      blockerRef: "#111",
      releaseIdentity: { release_id: "v1.0.0", release_tag: "v1.0.0", release_sha: "abc" },
      manifestPath: ".hatch/runs/r1/artifacts/release-manifest.json",
      listCommentsFn: () => ({ ok: true, comments: [] }),
      issueCommentFn: ({ body }) => {
        posted = body;
        return { ok: true };
      },
    });

    assert.equal(out.ok, true, `expected ok for ${disposition}`);
    assert.equal(out.skipped, false, `expected not skipped for ${disposition}`);
    assert.equal(out.disposition, disposition);
    assert.match(posted, /control_plane_blocker\.v1:/);
  }
});

test("artifact emit-disposition-feedback CLI emits JSON summary and dry-run suppresses gh calls", () => {
  const temp = mkdtempSync(join(tmpdir(), "artifact-feedback-cli-dry-"));
  const fixturePath = join(temp, "fixture.json");
  const callsPath = join(temp, "calls.log");
  const manifestPath = join(temp, "release-manifest.json");
  const binDir = join(temp, "bin");

  writeFileSync(fixturePath, JSON.stringify({ comments: {} }, null, 2), "utf8");
  writeFileSync(manifestPath, JSON.stringify({
    release: {
      release_id: "v1.2.3",
      tag: "v1.2.3",
      sha: "abc123",
    },
    entries: [
      {
        source_repo: "example/external-factory",
        source_issue: 101,
        status: "rejected",
        blocker_ref: "#5001",
      },
    ],
  }, null, 2), "utf8");

  makeGhMock(binDir, fixturePath);

  const previousPath = process.env.PATH || "";
  const previousFixture = process.env.ARTIFACT_FEEDBACK_FIXTURE;
  const previousCalls = process.env.ARTIFACT_FEEDBACK_CALLS_PATH;
  process.env.PATH = `${binDir}:${previousPath}`;
  process.env.ARTIFACT_FEEDBACK_FIXTURE = fixturePath;
  process.env.ARTIFACT_FEEDBACK_CALLS_PATH = callsPath;

  try {
    const run = spawnOpsCli([
      "artifact",
      "emit-disposition-feedback",
      "--control-plane-repo",
      "recallnet/astrochicken",
      "--manifest-path",
      manifestPath,
      "--dry-run"
    ]);

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const out = JSON.parse(run.stdout || "{}");
    assert.equal(out.processed, 1);
    assert.equal(out.failed, 0);
    assert.equal(out.skipped, 0);
    assert.equal(out.entries[0]?.ok, true);
    assert.equal(out.entries[0]?.dry_run, true);
    assert.equal(out.entries[0]?.disposition, "rejected");

    const calls = readCalls(callsPath);
    assert.equal(calls.length, 0);
  } finally {
    process.env.PATH = previousPath;
    if (previousFixture === undefined) delete process.env.ARTIFACT_FEEDBACK_FIXTURE;
    else process.env.ARTIFACT_FEEDBACK_FIXTURE = previousFixture;
    if (previousCalls === undefined) delete process.env.ARTIFACT_FEEDBACK_CALLS_PATH;
    else process.env.ARTIFACT_FEEDBACK_CALLS_PATH = previousCalls;
  }
});

test("artifact emit-disposition-feedback CLI exits non-zero when any entry fails", () => {
  const temp = mkdtempSync(join(tmpdir(), "artifact-feedback-cli-fail-"));
  const fixturePath = join(temp, "fixture.json");
  const callsPath = join(temp, "calls.log");
  const manifestPath = join(temp, "release-manifest.json");
  const binDir = join(temp, "bin");

  writeFileSync(fixturePath, JSON.stringify({ comments: { "101": [] } }, null, 2), "utf8");
  writeFileSync(manifestPath, JSON.stringify({
    release: {
      release_id: "v1.2.4",
      tag: "v1.2.4",
      sha: "def456",
    },
    artifacts: [
      {
        source_repo: "example/external-factory",
        source_issue: 101,
        status: "blocked_upstream",
        blocker_ref: "#6001",
      },
      {
        source_repo: "",
        source_issue: 0,
        status: "rejected",
        blocker_ref: "#6002",
      },
    ],
  }, null, 2), "utf8");

  makeGhMock(binDir, fixturePath);

  const previousPath = process.env.PATH || "";
  const previousFixture = process.env.ARTIFACT_FEEDBACK_FIXTURE;
  const previousCalls = process.env.ARTIFACT_FEEDBACK_CALLS_PATH;
  process.env.PATH = `${binDir}:${previousPath}`;
  process.env.ARTIFACT_FEEDBACK_FIXTURE = fixturePath;
  process.env.ARTIFACT_FEEDBACK_CALLS_PATH = callsPath;

  try {
    const run = spawnOpsCli([
      "artifact",
      "emit-disposition-feedback",
      "--control-plane-repo",
      "recallnet/astrochicken",
      "--manifest-path",
      manifestPath
    ]);

    assert.equal(run.status, 1, run.stderr || run.stdout);
    const out = JSON.parse(run.stdout || "{}");
    assert.equal(out.processed, 2);
    assert.equal(out.failed, 1);

    const missingSource = out.entries.find((entry) => entry?.reason === "missing_source_reference");
    assert.equal(missingSource?.ok, false);

    const posted = out.entries.find((entry) => entry?.source_issue === 101);
    assert.equal(posted?.ok, true);

    const calls = readCalls(callsPath);
    assert.equal(calls.filter((call) => call.kind === "api").length, 1);
    assert.equal(calls.filter((call) => call.kind === "comment").length, 1);
  } finally {
    process.env.PATH = previousPath;
    if (previousFixture === undefined) delete process.env.ARTIFACT_FEEDBACK_FIXTURE;
    else process.env.ARTIFACT_FEEDBACK_FIXTURE = previousFixture;
    if (previousCalls === undefined) delete process.env.ARTIFACT_FEEDBACK_CALLS_PATH;
    else process.env.ARTIFACT_FEEDBACK_CALLS_PATH = previousCalls;
  }
});
