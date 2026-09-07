import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { closeBrainstormIssue } from "../src/commands/brainstorm-close-issue.ts";
import { createBrainstormGoalIssue } from "../src/commands/brainstorm-create-goal.ts";
import { certifyHostRuntimeIntake } from "../src/commands/host-runtime-intake-certify.ts";

test("brainstorm lifecycle contract: create routes to destination repo, comment/close route to home repo", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "create") {
      return { ok: true, status: 0, stdout: "https://github.com/recallnet/astrochicken/issues/3030\n", stderr: "" };
    }
    if (args[0] === "issue" && args[1] === "comment") {
      return { ok: true, status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "issue" && args[1] === "close") {
      return { ok: true, status: 0, stdout: "", stderr: "" };
    }
    return { ok: false, status: 1, stdout: "", stderr: `unexpected:${args.join(" ")}` };
  };

  const created = createBrainstormGoalIssue({
    destinationsJson: JSON.stringify({
      goal_issues: {
        repo: "recallnet/astrochicken",
        labels: ["goal", "source:brainstorm", "managed"],
      },
    }),
    brainstormIssueNumber: "2019",
    seedPrompt: "highest ROI goal given current state",
    finalRound: "3",
    finalReportRaw: JSON.stringify({
      proposal: "Improve deterministic brainstorm loop",
      success_criteria: ["loop exits early on convergence"],
      scope_in: ["bump-round contract"],
      scope_out: ["consumer integration"],
      risks: ["review latency"],
    }),
    ghExec,
  });

  const closed = closeBrainstormIssue({
    repo: "example-org/example-notes",
    brainstormIssueNumber: "2019",
    goalIssueUrl: created.goal_issue_url,
    goalIssueNumber: created.goal_issue_number,
    ghExec,
  });

  assert.equal(created.ok, true);
  assert.equal(created.goal_issue_number, "3030");
  assert.equal(closed.ok, true);
  assert.equal(closed.closed, "true");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((entry) => entry.slice(0, 2)), [
    ["issue", "create"],
    ["issue", "comment"],
    ["issue", "close"],
  ]);

  const createArgs = calls[0];
  const createRepoIndex = createArgs.indexOf("--repo");
  assert.equal(createArgs[createRepoIndex + 1], "recallnet/astrochicken");

  const createLabels = [];
  for (let i = 0; i < createArgs.length; i += 1) {
    if (createArgs[i] === "--label") createLabels.push(createArgs[i + 1]);
  }
  assert.deepEqual(createLabels.sort(), ["goal", "managed", "source:brainstorm"].sort());

  for (const actionArgs of [calls[1], calls[2]]) {
    const repoIndex = actionArgs.indexOf("--repo");
    assert.equal(actionArgs[repoIndex + 1], "example-org/example-notes");
  }

  const commentArgs = calls[1];
  const bodyIndex = commentArgs.indexOf("--body");
  const body = commentArgs[bodyIndex + 1];
  assert.match(body, /#3030/);
  assert.match(body, /https:\/\/github\.com\/recallnet\/astrochicken\/issues\/3030/);
});

test("brainstorm lifecycle contract: create failure short-circuits close path", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: false, status: 1, stdout: "", stderr: "create denied" };
  };

  assert.throws(() => createBrainstormGoalIssue({
    repo: "recallnet/astrochicken",
    brainstormIssueNumber: "2019",
    seedPrompt: "seed",
    finalReportRaw: JSON.stringify({ proposal: "X", success_criteria: ["A"], scope_in: ["B"], scope_out: ["C"] }),
    ghExec,
  }), /issue_create_failed:create denied/);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["issue", "create"]);
});

test("brainstorm lifecycle contract: comment failure blocks close", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "comment") {
      return { ok: false, status: 1, stdout: "", stderr: "comment denied" };
    }
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  assert.throws(() => closeBrainstormIssue({
    repo: "example-org/example-notes",
    brainstormIssueNumber: "2019",
    goalIssueUrl: "https://github.com/recallnet/astrochicken/issues/3030",
    goalIssueNumber: "3030",
    ghExec,
  }), /comment_failed:comment denied/);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["issue", "comment"]);
});

test("host runtime intake certification: verifies goal creation, backlink, and source closure", async () => {
  const hostBaseDir = mkdtempSync(join(tmpdir(), "host-runtime-intake-certify-pass-"));
  const installationDir = join(hostBaseDir, "brainstorm");
  mkdirSync(join(installationDir, "runs", "run_123"), { recursive: true });

  writeFileSync(join(installationDir, "installation.json"), `${JSON.stringify({
    installation_id: "inst_brainstorm",
    instance_id: "brainstorm",
    host_id: "host_test_01",
    workspace_mode: "api_only",
    work_dir: null,
    log_dir: join(installationDir, "logs"),
    artifact_dir: join(installationDir, "artifacts"),
    runtime_version: "0.1.0",
  }, null, 2)}\n`);

  writeFileSync(join(installationDir, "runs", "run_123", "state.json"), `${JSON.stringify({
    runId: "run_123",
    status: "completed",
    context: {
      domain_result: JSON.stringify({
        brainstorm_issue_number: "1201",
        goal_issue_number: "3030",
        goal_issue_url: "https://github.com/recallnet/astrochicken/issues/3030",
      }),
    },
  }, null, 2)}\n`);

  const registryPath = join(hostBaseDir, "factory-registry.json");
  writeFileSync(registryPath, `${JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "brainstorm",
        target_repo: "example-org/example-notes",
        destinations_json: JSON.stringify({
          goal_issues: {
            repo: "recallnet/astrochicken",
            labels: ["goal", "source:brainstorm"],
          },
        }),
      },
    ],
  }, null, 2)}\n`);

  try {
    const out = await certifyHostRuntimeIntake({
      repo: "example-org/example-notes",
      issueNumber: "1201",
      instanceId: "brainstorm",
      hostBaseDir,
      registryPath,
      registryCwd: hostBaseDir,
      runHostRuntimeOnceFn: async () => ({
        ok: true,
        status: "ok",
        error: "",
        exit_code: 0,
        stderr: "",
        stdout: "",
        payload: {
          status: "ok",
          host_id: "host_test_01",
          runtime_version: "0.1.0",
          log_file: "/tmp/hatch-host.log",
          execution_results: [
            {
              installation_id: "inst_brainstorm",
              instance_id: "brainstorm",
              run_id: "run_123",
              tick_id: "tick_987",
              tick_log_path: "/tmp/tick-987.log",
              exit_code: 0,
              tick_idle: false,
            },
          ],
        },
      }),
      ghJsonExec: (args) => {
        if (args[0] === "issue" && args[1] === "view" && args.includes("--repo") && args.includes("recallnet/astrochicken")) {
          return {
            number: 3030,
            url: "https://github.com/recallnet/astrochicken/issues/3030",
            state: "OPEN",
          };
        }

        if (args[0] === "issue" && args[1] === "view" && args.includes("--repo") && args.includes("example-org/example-notes")) {
          return {
            number: 1201,
            state: "CLOSED",
            url: "https://github.com/example-org/example-notes/issues/1201",
            comments: [
              {
                body: "Brainstorm complete. Created goal issue #3030: https://github.com/recallnet/astrochicken/issues/3030",
              },
            ],
          };
        }

        return null;
      },
    });

    assert.equal(out.ok, true);
    assert.equal(out.status, "certified");
    assert.equal(out.run_metadata.run_id, "run_123");
    assert.equal(out.run_metadata.tick_id, "tick_987");
    assert.equal(out.markers.goal_created, "pass");
    assert.equal(out.markers.source_backlink, "pass");
    assert.equal(out.markers.source_closed, "pass");

    const failed = out.invariants.filter((entry) => !entry.ok);
    assert.deepEqual(failed, []);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("host runtime intake certification: fails when backlink/closure invariants are missing", async () => {
  const hostBaseDir = mkdtempSync(join(tmpdir(), "host-runtime-intake-certify-fail-"));
  const installationDir = join(hostBaseDir, "brainstorm");
  mkdirSync(join(installationDir, "runs", "run_456"), { recursive: true });

  writeFileSync(join(installationDir, "installation.json"), `${JSON.stringify({
    installation_id: "inst_brainstorm",
    instance_id: "brainstorm",
    host_id: "host_test_01",
    workspace_mode: "api_only",
    work_dir: null,
    log_dir: join(installationDir, "logs"),
    artifact_dir: join(installationDir, "artifacts"),
    runtime_version: "0.1.0",
  }, null, 2)}\n`);

  writeFileSync(join(installationDir, "runs", "run_456", "state.json"), `${JSON.stringify({
    runId: "run_456",
    status: "completed",
    context: {
      domain_result: JSON.stringify({
        brainstorm_issue_number: "1202",
        goal_issue_number: "4040",
        goal_issue_url: "https://github.com/recallnet/astrochicken/issues/4040",
      }),
    },
  }, null, 2)}\n`);

  const registryPath = join(hostBaseDir, "factory-registry.json");
  writeFileSync(registryPath, `${JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "brainstorm",
        target_repo: "example-org/example-notes",
        destinations_json: JSON.stringify({
          goal_issues: {
            repo: "recallnet/astrochicken",
            labels: ["goal", "source:brainstorm"],
          },
        }),
      },
    ],
  }, null, 2)}\n`);

  try {
    const out = await certifyHostRuntimeIntake({
      repo: "example-org/example-notes",
      issueNumber: "1202",
      instanceId: "brainstorm",
      hostBaseDir,
      registryPath,
      registryCwd: hostBaseDir,
      runHostRuntimeOnceFn: async () => ({
        ok: true,
        status: "ok",
        error: "",
        exit_code: 0,
        stderr: "",
        stdout: "",
        payload: {
          status: "ok",
          host_id: "host_test_01",
          runtime_version: "0.1.0",
          log_file: "/tmp/hatch-host.log",
          execution_results: [
            {
              installation_id: "inst_brainstorm",
              instance_id: "brainstorm",
              run_id: "run_456",
              tick_id: "tick_654",
              tick_log_path: "/tmp/tick-654.log",
              exit_code: 0,
              tick_idle: false,
            },
          ],
        },
      }),
      ghJsonExec: (args) => {
        if (args[0] === "issue" && args[1] === "view" && args.includes("--repo") && args.includes("recallnet/astrochicken")) {
          return {
            number: 4040,
            url: "https://github.com/recallnet/astrochicken/issues/4040",
            state: "OPEN",
          };
        }

        if (args[0] === "issue" && args[1] === "view" && args.includes("--repo") && args.includes("example-org/example-notes")) {
          return {
            number: 1202,
            state: "OPEN",
            url: "https://github.com/example-org/example-notes/issues/1202",
            comments: [],
          };
        }

        return null;
      },
    });

    assert.equal(out.ok, false);
    assert.equal(out.status, "certification_failed");
    assert.equal(out.markers.goal_created, "pass");
    assert.equal(out.markers.source_backlink, "fail");
    assert.equal(out.markers.source_closed, "fail");
    assert.equal(out.run_metadata.run_id, "run_456");

    const failingIds = out.invariants.filter((entry) => !entry.ok).map((entry) => entry.id).sort();
    assert.deepEqual(failingIds, ["source_backlink", "source_closed"]);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("host runtime intake certification: surfaces host runtime run failure and exits non-certified", async () => {
  const hostBaseDir = mkdtempSync(join(tmpdir(), "host-runtime-intake-certify-run-fail-"));
  const installationDir = join(hostBaseDir, "brainstorm");
  mkdirSync(installationDir, { recursive: true });

  writeFileSync(join(installationDir, "installation.json"), `${JSON.stringify({
    installation_id: "inst_brainstorm",
    instance_id: "brainstorm",
    host_id: "host_test_01",
    workspace_mode: "api_only",
    work_dir: null,
    log_dir: join(installationDir, "logs"),
    artifact_dir: join(installationDir, "artifacts"),
    runtime_version: "0.1.0",
  }, null, 2)}\n`);

  const registryPath = join(hostBaseDir, "factory-registry.json");
  writeFileSync(registryPath, `${JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "brainstorm",
        target_repo: "example-org/example-notes",
        destinations_json: JSON.stringify({
          goal_issues: {
            repo: "recallnet/astrochicken",
            labels: ["goal", "source:brainstorm"],
          },
        }),
      },
    ],
  }, null, 2)}\n`);

  try {
    const out = await certifyHostRuntimeIntake({
      repo: "example-org/example-notes",
      issueNumber: "1203",
      instanceId: "brainstorm",
      hostBaseDir,
      registryPath,
      registryCwd: hostBaseDir,
      runHostRuntimeOnceFn: async () => ({
        ok: false,
        status: "host_runtime_once_failed",
        error: "host_runtime_once_failed:non_zero_exit_code",
        exit_code: 1,
        stderr: "tick failed",
        stdout: "",
        payload: {
          log_file: "/tmp/hatch-host.log",
        },
      }),
      ghJsonExec: () => {
        throw new Error("ghJson should not be called when host run fails");
      },
    });

    assert.equal(out.ok, false);
    assert.equal(out.status, "host_runtime_run_failed");
    assert.match(out.error, /host_runtime_once_failed/);
    assert.equal(out.host_runtime.mode, "once");
    assert.equal(out.host_runtime.log_file, "/tmp/hatch-host.log");
    assert.equal(Array.isArray(out.invariants), true);
    assert.equal(out.invariants.length, 0);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});
