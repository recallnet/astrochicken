import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import test from "node:test";


import { loadResumePolicy } from "../../src/commands/factory-resume-gate.ts";
import { validateResumePolicy } from "../../src/lib/resume-policy-schema.ts";

test("release command wiring includes validate-policy and rollout-events", () => {
  const text = readFileSync("packages/factory-ops/src/cli/commands/release-policy-cmds.ts", "utf8");
  assert.match(text, /class ReleaseValidatePolicyCommand/);
  assert.match(text, /static paths = \[\["release", "validate-policy"\]\]/);
  assert.match(text, /class ReleaseRolloutEventsCommand/);
  assert.match(text, /static paths = \[\["release", "rollout-events"\]\]/);
});

test("hatch-ops release --help lists validate-policy and rollout-events", () => {
  const run = spawnOpsCli([
      "release",
      "--help"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const help = `${run.stdout || ""}\n${run.stderr || ""}`;
  assert.match(help, /validate-policy/);
  assert.match(help, /rollout-events/);
});

test("validateResumePolicy accepts a valid policy and returns no errors", () => {
  const policy = {
    control_plane_repo: "recallnet/astrochicken",
    rollout: {
      default_channel: "stable",
      repo_channels: {
        "example/factory": "canary",
      },
    },
    pins: {
      repos: {
        "example/factory": "2.1.0",
      },
    },
    factory_releases: {
      repos: {
        "example/factory": "2.1.0",
      },
      default_release: "2.0.0",
    },
    localReleaseCmdByFactory: {
      "example/factory-id": "printf '2.1.0\\n'",
    },
  };

  const out = validateResumePolicy(policy);
  assert.equal(out.ok, true);
  assert.deepEqual(out.errors, []);
});

test("validateResumePolicy reports unknown top-level keys", () => {
  const out = validateResumePolicy({
    control_plane_repo: "recallnet/astrochicken",
    bad_key: true,
  });

  assert.equal(out.ok, false);
  assert.ok(out.errors.some((entry) => String(entry).includes("Unknown top-level key `bad_key`")));
});

test("validateResumePolicy reports missing control_plane_repo", () => {
  const out = validateResumePolicy({
    rollout: {
      default_channel: "stable",
    },
  });

  assert.equal(out.ok, false);
  assert.ok(out.errors.includes("control_plane_repo is required"));
});

test("validateResumePolicy reports invalid rollout repo channel values", () => {
  const out = validateResumePolicy({
    control_plane_repo: "recallnet/astrochicken",
    rollout: {
      default_channel: "stable",
      repo_channels: {
        "example/factory": "beta",
      },
    },
  });

  assert.equal(out.ok, false);
  assert.ok(out.errors.some((entry) => String(entry).includes("rollout.repo_channels.example/factory must be one of ['stable','canary','pinned']")));
});

test("loadResumePolicy always returns policy_validation_errors array", () => {
  const valid = loadResumePolicy({
    policyJson: JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: { default_channel: "stable" },
    }),
  });
  assert.deepEqual(valid.policy_validation_errors, []);

  const invalid = loadResumePolicy({ policyJson: JSON.stringify({ bad_key: true }) });
  assert.ok(Array.isArray(invalid.policy_validation_errors));
  assert.ok(invalid.policy_validation_errors.some((entry) => String(entry).includes("Unknown top-level key `bad_key`")));
});

test("release validate-policy CLI prints ok for a valid policy", () => {
  const run = spawnOpsCli([
      "release",
      "validate-policy",
      "--policy-json",
      '{"control_plane_repo":"recallnet/astrochicken"}'
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal((run.stdout || "").trim(), "ok");
});

test("release validate-policy CLI prints unknown key errors and exits non-zero", () => {
  const run = spawnOpsCli([
      "release",
      "validate-policy",
      "--policy-json",
      '{"bad_key":true}'
    ]);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /Unknown top-level key `bad_key`/);
});
