import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveManagedRecoverySweepScope,
  determineOwnershipDecision,
  addActionItem,
} from "../../src/commands/supervisor-ownership-routing.ts";

describe("determineOwnershipDecision", () => {
  it("returns local_fix by default for empty item", () => {
    const result = determineOwnershipDecision();
    assert.equal(result.decision, "local_fix");
    assert.match(result.reason, /default local ownership/);
  });

  it("routes remote CLI crash with REMOTE_FACTORY policy to control_plane", () => {
    const item = {
      problem: "CLI_RUNTIME_CRASH: something broke",
      diagnostics: { remediation_policy: "REMOTE_FACTORY_ESCALATE_AND_SUBSCRIBE" },
    };
    const result = determineOwnershipDecision(item);
    assert.equal(result.decision, "control_plane");
  });

  it("routes remote CLI crash with remote_factory in resolution text to control_plane", () => {
    const item = {
      problem: "CLI_RUNTIME_CRASH: x",
      possible_resolutions: [{ when: "always", resolution: "escalate to remote_factory" }],
    };
    const result = determineOwnershipDecision(item);
    assert.equal(result.decision, "control_plane");
  });

  it("routes remote CLI crash with control_plane in resolution to control_plane", () => {
    const item = {
      problem: "CLI_RUNTIME_CRASH: x",
      possible_resolutions: [{ when: "always", resolution: "hand off to control_plane" }],
    };
    const result = determineOwnershipDecision(item);
    assert.equal(result.decision, "control_plane");
  });

  it("routes remote CLI crash with supervisor emit-bug + remote repo context to control_plane", () => {
    const item = {
      problem: "CLI_RUNTIME_CRASH: x",
      suggested_action: "supervisor emit-bug",
    };
    const result = determineOwnershipDecision(item, {
      targetRepo: "org/target-repo",
      controlPlaneRepo: "org/control-plane-repo",
    });
    assert.equal(result.decision, "control_plane");
  });

  it("routes CLI crash without remote signal to local_fix", () => {
    const item = {
      problem: "CLI_RUNTIME_CRASH: local issue",
    };
    const result = determineOwnershipDecision(item);
    assert.equal(result.decision, "local_fix");
  });

  it("routes remote_cli_runtime_crash packet type to control_plane", () => {
    const item = {
      remediation_packet: { packet_type: "remote_cli_runtime_crash" },
    };
    const result = determineOwnershipDecision(item);
    assert.equal(result.decision, "control_plane");
    assert.match(result.reason, /control-plane takeover/);
  });

  it("routes local_cli_runtime_crash packet type to local_fix", () => {
    const item = {
      remediation_packet: { packet_type: "local_cli_runtime_crash" },
    };
    const result = determineOwnershipDecision(item);
    assert.equal(result.decision, "local_fix");
    assert.match(result.reason, /local in-repo repair/);
  });

  it("routes suggested_action containing 'defer' to wait", () => {
    const item = { suggested_action: "defer until next cycle" };
    const result = determineOwnershipDecision(item);
    assert.equal(result.decision, "wait");
  });

  it("routes suggested_action containing 'waiting' to wait", () => {
    const item = { suggested_action: "waiting for upstream" };
    const result = determineOwnershipDecision(item);
    assert.equal(result.decision, "wait");
  });

  it("routes cooldown signal to wait", () => {
    const item = { suggested_action: "cooldown period active" };
    const result = determineOwnershipDecision(item);
    assert.equal(result.decision, "wait");
  });

  it("does NOT route cooldown + unscheduled_wave_requeue to wait", () => {
    const item = {
      suggested_action: "cooldown period active",
      remediation_packet: { packet_type: "unscheduled_wave_requeue" },
    };
    const result = determineOwnershipDecision(item);
    assert.notEqual(result.decision, "wait");
  });

  it("routes requiresRepoFix=true to local_fix with repo fix reason", () => {
    const item = {
      remediation_packet: { requiresRepoFix: true },
    };
    const result = determineOwnershipDecision(item);
    assert.equal(result.decision, "local_fix");
    assert.match(result.reason, /in-repo code fix/);
  });

  it("routes requires_repo_fix=true (snake_case) to local_fix", () => {
    const item = {
      remediation_packet: { requires_repo_fix: true },
    };
    const result = determineOwnershipDecision(item);
    assert.equal(result.decision, "local_fix");
    assert.match(result.reason, /in-repo code fix/);
  });

  it("routes LOCAL_FACTORY_IMMEDIATE_FIX policy to local_fix", () => {
    const item = {
      diagnostics: { remediation_policy: "LOCAL_FACTORY_IMMEDIATE_FIX" },
    };
    const result = determineOwnershipDecision(item);
    assert.equal(result.decision, "local_fix");
    assert.match(result.reason, /local factory ownership/);
  });
});

describe("resolveManagedRecoverySweepScope", () => {
  it("returns empty repoPath and skipWorktreeScan=true for api_only workspace mode", () => {
    const result = resolveManagedRecoverySweepScope({
      config: { workspace_mode: "api_only" },
    });
    assert.equal(result.repoPath, "");
    assert.equal(result.skipWorktreeScan, true);
  });

  it("uses FACTORY_CONTEXT_REPO_PATH env when set", () => {
    const result = resolveManagedRecoverySweepScope({
      env: { FACTORY_CONTEXT_REPO_PATH: "/some/path" },
    });
    assert.equal(result.repoPath, "/some/path");
  });

  it("sets skipWorktreeScan=true when managed and env path is used", () => {
    const result = resolveManagedRecoverySweepScope({
      config: { managed: true },
      env: { FACTORY_CONTEXT_REPO_PATH: "/some/path" },
    });
    assert.equal(result.repoPath, "/some/path");
    assert.equal(result.skipWorktreeScan, true);
  });

  it("sets skipWorktreeScan=false when not managed and env path is used", () => {
    const result = resolveManagedRecoverySweepScope({
      config: { managed: false },
      env: { FACTORY_CONTEXT_REPO_PATH: "/some/path" },
    });
    assert.equal(result.skipWorktreeScan, false);
  });

  it("uses absolute work_dir as-is", () => {
    const result = resolveManagedRecoverySweepScope({
      config: { work_dir: "/absolute/work/dir" },
      env: {},
    });
    assert.equal(result.repoPath, "/absolute/work/dir");
  });

  it("joins relative work_dir with cwd", () => {
    const result = resolveManagedRecoverySweepScope({
      config: { work_dir: "relative/dir" },
      cwd: "/base",
      env: {},
    });
    assert.equal(result.repoPath, "/base/relative/dir");
  });

  it("defaults to cwd with skipWorktreeScan based on managed flag", () => {
    const result = resolveManagedRecoverySweepScope({
      config: { managed: true },
      cwd: "/my/cwd",
      env: {},
    });
    assert.equal(result.repoPath, "/my/cwd");
    assert.equal(result.skipWorktreeScan, true);
  });
});

describe("addActionItem", () => {
  it("appends item with ownership_decision and ownership_reason", () => {
    const items = [];
    addActionItem(items, { problem: "something" });
    assert.equal(items.length, 1);
    assert.equal(items[0].ownership_decision, "local_fix");
    assert.equal(typeof items[0].ownership_reason, "string");
  });

  it("preserves original item fields", () => {
    const items = [];
    addActionItem(items, { problem: "test", custom_field: 42 });
    assert.equal(items[0].problem, "test");
    assert.equal(items[0].custom_field, 42);
    assert.ok(items[0].ownership_decision);
  });
});
