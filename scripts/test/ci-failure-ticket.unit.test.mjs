import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const SCRIPT_PATH = join(import.meta.dirname, "../../.github/scripts/ci-failure-ticket.sh");

/**
 * Creates a temp directory with a fake `gh` that logs invocations to a file.
 * The fake gh can be configured to return specific output for specific subcommands.
 */
function createHarness({ ghBehavior = {} } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "ci-ticket-test-"));
  const binDir = join(tmp, "bin");
  mkdirSync(binDir);

  const logFile = join(tmp, "gh-calls.log");

  // Build the fake gh script
  // ghBehavior maps subcommand patterns to { stdout, exitCode }
  let ghScript = `#!/usr/bin/env bash\necho "$@" >> "${logFile}"\n`;

  // Default: if "issue list" is called, return empty (no existing issue)
  const issueListResponse = ghBehavior["issue list"] ?? { stdout: "", exitCode: 0 };
  const issueListNumberResponse = ghBehavior["issue list --jq-number"] ?? issueListResponse;
  const issueListStateResponse = ghBehavior["issue list --jq-state"] ?? issueListResponse;
  const issueCreateResponse = ghBehavior["issue create"] ?? { stdout: "", exitCode: 0 };
  const issueCommentResponse = ghBehavior["issue comment"] ?? { stdout: "", exitCode: 0 };
  const issueReopenResponse = ghBehavior["issue reopen"] ?? { stdout: "", exitCode: 0 };
  const runViewResponse = ghBehavior["run view"] ?? { stdout: "some-log-line\n", exitCode: 0 };

  ghScript += `
if [[ "$1" == "issue" && "$2" == "list" ]]; then
  joined="$*"
  if [[ "$joined" == *".number"* ]]; then
    echo "${issueListNumberResponse.stdout}"
    exit ${issueListNumberResponse.exitCode}
  elif [[ "$joined" == *".state"* ]]; then
    echo "${issueListStateResponse.stdout}"
    exit ${issueListStateResponse.exitCode}
  fi
  echo "${issueListResponse.stdout}"
  exit ${issueListResponse.exitCode}
elif [[ "$1" == "issue" && "$2" == "create" ]]; then
  echo "${issueCreateResponse.stdout}"
  exit ${issueCreateResponse.exitCode}
elif [[ "$1" == "issue" && "$2" == "comment" ]]; then
  echo "${issueCommentResponse.stdout}"
  exit ${issueCommentResponse.exitCode}
elif [[ "$1" == "issue" && "$2" == "reopen" ]]; then
  echo "${issueReopenResponse.stdout}"
  exit ${issueReopenResponse.exitCode}
elif [[ "$1" == "run" && "$2" == "view" ]]; then
  echo "${runViewResponse.stdout}"
  exit ${runViewResponse.exitCode}
fi
exit 0
`;

  const ghPath = join(binDir, "gh");
  writeFileSync(ghPath, ghScript, { mode: 0o755 });

  return {
    tmp,
    binDir,
    logFile,
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
    readLog: () => {
      try { return readFileSync(logFile, "utf8"); } catch { return ""; }
    },
  };
}

function runScript(jobName, runId, { binDir, env = {} } = {}) {
  const mergedEnv = {
    PATH: `${binDir}:/usr/bin:/bin`,
    GITHUB_REF_NAME: env.GITHUB_REF_NAME ?? "main",
    GITHUB_SHA: env.GITHUB_SHA ?? "abc1234",
    GITHUB_ACTOR: env.GITHUB_ACTOR ?? "test-actor",
    GITHUB_SERVER_URL: env.GITHUB_SERVER_URL ?? "https://github.com",
    GITHUB_REPOSITORY: env.GITHUB_REPOSITORY ?? "recallnet/astrochicken",
    ...env,
  };

  return execFileSync("bash", [SCRIPT_PATH, jobName, runId], {
    env: mergedEnv,
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("ci-failure-ticket: creates new issue when no existing issue found", () => {
  const harness = createHarness();
  try {
    runScript("pre-merge-quality", "12345", harness);
    const log = harness.readLog();

    // Should have called gh run view to get logs
    assert.ok(log.includes("run view"), "should call gh run view for logs");

    // Should have called gh issue list to search for existing
    assert.ok(log.includes("issue list"), "should search for existing issues");
    assert.ok(log.includes("--label bug"), "should filter by bug label");
    assert.ok(log.includes("--state all"), "should search all issues for dedup");

    // Should have called gh issue create (not comment)
    assert.ok(log.includes("issue create"), "should create a new issue");
    assert.ok(log.includes("CI: pre-merge-quality failed on main"), "title should include job name and branch");
    assert.ok(log.includes("--label bug"), "issue should have bug label");

    // Should NOT have called issue comment
    const lines = log.split("\n").filter(l => l.includes("issue comment"));
    assert.equal(lines.length, 0, "should not comment when no existing issue");
  } finally {
    harness.cleanup();
  }
});

test("ci-failure-ticket: comments on existing issue when duplicate found", () => {
  const harness = createHarness({
    ghBehavior: {
      "issue list": { stdout: '[{"number":42,"state":"OPEN","title":"CI: docs-quality failed on main","closedAt":null}]', exitCode: 0 },
    },
  });
  try {
    runScript("docs-quality", "67890", harness);
    const log = harness.readLog();

    // Should have searched for existing
    assert.ok(log.includes("issue list"), "should search for existing issues");

    // Should comment on existing issue #42, not create new
    assert.ok(log.includes("issue comment"), "should comment on existing issue");
    assert.ok(log.includes("42"), "should reference existing issue number");

    // Should NOT create a new issue
    const createLines = log.split("\n").filter(l => l.includes("issue create"));
    assert.equal(createLines.length, 0, "should not create when existing issue found");
  } finally {
    harness.cleanup();
  }
});

test("ci-failure-ticket: reopens latest matching closed issue instead of creating a duplicate", () => {
  const harness = createHarness({
    ghBehavior: {
      "issue list": {
        stdout: "",
        exitCode: 0,
      },
      "issue list --jq-number": { stdout: "41", exitCode: 0 },
      "issue list --jq-state": { stdout: "CLOSED", exitCode: 0 },
    },
  });
  try {
    runScript("pre-merge-quality", "12345", harness);
    const log = harness.readLog();

    assert.ok(log.includes("issue reopen 41"), "should reopen latest matching closed issue");
    assert.ok(log.includes("issue comment 41"), "should comment on reopened issue");
    const createLines = log.split("\n").filter((l) => l.includes("issue create"));
    assert.equal(createLines.length, 0, "should not create a duplicate issue when a closed match exists");
  } finally {
    harness.cleanup();
  }
});

test("ci-failure-ticket: uses correct branch from GITHUB_REF_NAME", () => {
  const harness = createHarness();
  try {
    runScript("build", "99999", {
      ...harness,
      env: { GITHUB_REF_NAME: "feat/my-branch" },
    });
    const log = harness.readLog();

    assert.ok(
      log.includes("CI: build failed on feat/my-branch"),
      "title should reflect the actual branch name",
    );
  } finally {
    harness.cleanup();
  }
});

test("ci-failure-ticket: includes run URL in issue body", () => {
  const harness = createHarness();
  try {
    runScript("publish", "55555", {
      ...harness,
      env: {
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "recallnet/astrochicken",
      },
    });
    const log = harness.readLog();

    // The body passed to gh issue create should contain the run URL
    assert.ok(
      log.includes("https://github.com/recallnet/astrochicken/actions/runs/55555"),
      "body should include the full run URL",
    );
  } finally {
    harness.cleanup();
  }
});

test("ci-failure-ticket: survives gh failures gracefully", () => {
  const harness = createHarness({
    ghBehavior: {
      "issue list": { stdout: "", exitCode: 1 },
      "issue create": { stdout: "", exitCode: 1 },
      "run view": { stdout: "", exitCode: 1 },
    },
  });
  try {
    // Should not throw even when gh commands fail
    runScript("pre-merge-quality", "11111", harness);
    const log = harness.readLog();
    // Should still attempt to create (falls through to create since list returned empty)
    assert.ok(log.includes("issue create") || log.includes("issue comment"),
      "should attempt create or comment even on partial failure");
  } finally {
    harness.cleanup();
  }
});

test("ci-failure-ticket: search query includes job name and branch for dedup", () => {
  const harness = createHarness();
  try {
    runScript("pre-merge-quality", "12345", {
      ...harness,
      env: { GITHUB_REF_NAME: "main" },
    });
    const log = harness.readLog();

    // The search argument to gh issue list should include the job+branch pattern
    const listLine = log.split("\n").find(l => l.includes("issue list"));
    assert.ok(listLine, "should have an issue list call");
    assert.ok(
      listLine.includes("CI: pre-merge-quality failed on main"),
      "search should include job name and branch for dedup matching",
    );
    assert.ok(listLine.includes("in:title"), "search should target exact title matches");
  } finally {
    harness.cleanup();
  }
});
