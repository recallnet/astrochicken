import assert from "node:assert/strict";
import test from "node:test";

import {
  isAutoExecutable,
  autoExecuteActionItem,
  processActionItems,
} from "../../src/commands/supervisor-auto-execute.ts";

// ── helpers ────────────────────────────────────────────────────────

function makeItem(overrides = {}) {
  return {
    problem: "STALLED_WAVE: wave #1961 inactive",
    ownership_decision: "local_fix",
    ownership_reason: "default",
    remediation_packet: {
      schema_version: "remediation_packet/v1",
      packet_type: "stalled_wave_recovery",
      execution_commands: [
        "gh issue edit 1961 --repo r/a --remove-label wave-in-progress --add-label ready",
      ],
      verify_commands: [
        "gh issue view 1961 --repo r/a --json labels",
      ],
      requires_commit: false,
      requires_repo_fix: false,
    },
    ...overrides,
  };
}

function okExec() {
  return { ok: true, stdout: "", stderr: "" };
}

function failExec(stderr = "command failed") {
  return { ok: false, stdout: "", stderr };
}

// ── isAutoExecutable ───────────────────────────────────────────────

test("isAutoExecutable returns true for deterministic local_fix with execution_commands", () => {
  assert.equal(isAutoExecutable(makeItem()), true);
});

test("isAutoExecutable returns false when ownership_decision is wait", () => {
  assert.equal(isAutoExecutable(makeItem({ ownership_decision: "wait" })), false);
});

test("isAutoExecutable returns false when ownership_decision is control_plane", () => {
  assert.equal(isAutoExecutable(makeItem({ ownership_decision: "control_plane" })), false);
});

test("isAutoExecutable returns false when no remediation_packet", () => {
  assert.equal(isAutoExecutable(makeItem({ remediation_packet: null })), false);
  assert.equal(isAutoExecutable(makeItem({ remediation_packet: undefined })), false);
});

test("isAutoExecutable returns false when execution_commands is empty", () => {
  assert.equal(isAutoExecutable(makeItem({
    remediation_packet: { ...makeItem().remediation_packet, execution_commands: [] },
  })), false);
});

test("isAutoExecutable returns false when requires_commit is true", () => {
  assert.equal(isAutoExecutable(makeItem({
    remediation_packet: { ...makeItem().remediation_packet, requires_commit: true },
  })), false);
});

test("isAutoExecutable returns false when requires_repo_fix is true", () => {
  assert.equal(isAutoExecutable(makeItem({
    remediation_packet: { ...makeItem().remediation_packet, requires_repo_fix: true },
  })), false);
});

test("isAutoExecutable returns false when requiresRepoFix (camelCase) is true", () => {
  assert.equal(isAutoExecutable(makeItem({
    remediation_packet: { ...makeItem().remediation_packet, requiresRepoFix: true },
  })), false);
});

test("isAutoExecutable returns false for null/undefined/non-object input", () => {
  assert.equal(isAutoExecutable(null), false);
  assert.equal(isAutoExecutable(undefined), false);
  assert.equal(isAutoExecutable("string"), false);
});

test("isAutoExecutable returns false when remediation_packet is a string", () => {
  assert.equal(isAutoExecutable(makeItem({ remediation_packet: "not an object" })), false);
});

// ── autoExecuteActionItem ──────────────────────────────────────────

test("autoExecuteActionItem runs execution_commands and verify_commands in order", () => {
  const log = [];
  const execFn = (cmd) => { log.push(cmd); return okExec(); };
  const item = makeItem();
  const result = autoExecuteActionItem(item, { execFn });
  assert.equal(result.ok, true);
  assert.equal(log.length, 2); // 1 exec + 1 verify
  assert.match(log[0], /--remove-label/);
  assert.match(log[1], /--json labels/);
});

test("autoExecuteActionItem returns ok:false when execution_command fails", () => {
  const execFn = () => failExec("network error");
  const result = autoExecuteActionItem(makeItem(), { execFn });
  assert.equal(result.ok, false);
  assert.match(result.error, /exec_failed/);
  assert.match(result.error, /network error/);
});

test("autoExecuteActionItem returns ok:false with verify_error when verify fails", () => {
  let callNum = 0;
  const execFn = () => {
    callNum++;
    return callNum === 1 ? okExec() : failExec("label not applied");
  };
  const result = autoExecuteActionItem(makeItem(), { execFn });
  assert.equal(result.ok, false);
  assert.ok(result.verify_error);
  assert.match(result.verify_error, /verify_failed/);
});

test("autoExecuteActionItem returns ok:false when no remediation_packet", () => {
  const result = autoExecuteActionItem({ problem: "x" }, { execFn: okExec });
  assert.equal(result.ok, false);
  assert.equal(result.error, "no_remediation_packet");
});

test("autoExecuteActionItem returns ok:false when execution_commands is empty", () => {
  const item = makeItem({
    remediation_packet: { execution_commands: [], verify_commands: [] },
  });
  const result = autoExecuteActionItem(item, { execFn: () => okExec() });
  assert.equal(result.ok, false);
  assert.equal(result.error, "no_execution_commands");
});

test("autoExecuteActionItem succeeds when verify_commands is absent", () => {
  const item = makeItem({
    remediation_packet: {
      execution_commands: ["echo ok"],
      requires_commit: false,
      requires_repo_fix: false,
    },
  });
  const result = autoExecuteActionItem(item, { execFn: () => okExec() });
  assert.equal(result.ok, true);
});

test("autoExecuteActionItem stops on first failed execution_command", () => {
  const log = [];
  const item = makeItem({
    remediation_packet: {
      ...makeItem().remediation_packet,
      execution_commands: ["cmd1", "cmd2", "cmd3"],
    },
  });
  let callNum = 0;
  const execFn = (cmd) => {
    log.push(cmd);
    callNum++;
    return callNum === 2 ? failExec("boom") : okExec();
  };
  const result = autoExecuteActionItem(item, { execFn });
  assert.equal(result.ok, false);
  assert.equal(log.length, 2); // stopped at cmd2, never ran cmd3
});

// ── processActionItems ─────────────────────────────────────────────

test("processActionItems auto-executes deterministic items, returns empty needsJudgment", () => {
  const items = [makeItem()];
  const result = processActionItems(items, { execFn: () => okExec() });
  assert.equal(result.executed.length, 1);
  assert.equal(result.needsJudgment.length, 0);
  assert.equal(result.failed.length, 0);
  assert.equal(result.skipped.length, 0);
});

test("processActionItems skips wait items entirely", () => {
  const items = [makeItem({ ownership_decision: "wait" })];
  const result = processActionItems(items, { execFn: () => okExec() });
  assert.equal(result.executed.length, 0);
  assert.equal(result.needsJudgment.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "wait");
});

test("processActionItems skips control_plane items entirely", () => {
  const items = [makeItem({ ownership_decision: "control_plane" })];
  const result = processActionItems(items, { execFn: () => okExec() });
  assert.equal(result.executed.length, 0);
  assert.equal(result.needsJudgment.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "control_plane");
});

test("processActionItems skips non-blocking packet classes before judgment", () => {
  const items = [
    makeItem({
      remediation_packet: {
        packet_type: "goal_execution_path_packet",
        execution_commands: [],
      },
    }),
  ];
  const result = processActionItems(items, { execFn: () => okExec() });
  assert.equal(result.executed.length, 0);
  assert.equal(result.failed.length, 0);
  assert.equal(result.needsJudgment.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "non_blocking_packet");
});

test("processActionItems routes items without packet to needsJudgment", () => {
  const items = [{ problem: "orphan feature", ownership_decision: "local_fix" }];
  const result = processActionItems(items, { execFn: () => okExec() });
  assert.equal(result.executed.length, 0);
  assert.equal(result.needsJudgment.length, 1);
});

test("processActionItems escalates failed auto-exec to needsJudgment", () => {
  const items = [makeItem()];
  const result = processActionItems(items, { execFn: () => failExec("timeout") });
  assert.equal(result.executed.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(result.needsJudgment.length, 1);
});

test("processActionItems handles mixed batch: auto-exec + judgment + wait + control_plane", () => {
  const items = [
    makeItem(), // auto-executable
    makeItem({ ownership_decision: "wait" }), // skip
    makeItem({ ownership_decision: "control_plane" }), // skip
    { problem: "orphan", ownership_decision: "local_fix" }, // no packet → judgment
    makeItem({ remediation_packet: { ...makeItem().remediation_packet, requires_commit: true } }), // needs commit → judgment
  ];
  const result = processActionItems(items, { execFn: () => okExec() });
  assert.equal(result.executed.length, 1);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.needsJudgment.length, 2);
  assert.equal(result.failed.length, 0);
});

test("processActionItems returns all empty arrays for empty input", () => {
  const result = processActionItems([], { execFn: () => okExec() });
  assert.equal(result.executed.length, 0);
  assert.equal(result.needsJudgment.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.failed.length, 0);
});

test("processActionItems handles null/undefined input gracefully", () => {
  const result = processActionItems(null, { execFn: () => okExec() });
  assert.equal(result.executed.length, 0);
  assert.equal(result.needsJudgment.length, 0);
});

test("processActionItems: all items auto-executed means has_action_items should be false", () => {
  const items = [makeItem(), makeItem()];
  const result = processActionItems(items, { execFn: () => okExec() });
  assert.equal(result.needsJudgment.length, 0, "no items should need LLM judgment");
  assert.equal(result.needsJudgment.length > 0 ? "true" : "false", "false");
});

test("processActionItems: one auto-exec failure among many means has_action_items is true", () => {
  let callIdx = 0;
  const execFn = () => {
    callIdx++;
    return callIdx === 2 ? failExec("flake") : okExec();
  };
  const items = [makeItem(), makeItem()];
  const result = processActionItems(items, { execFn });
  assert.equal(result.needsJudgment.length, 1, "failed item escalates to LLM");
  assert.equal(result.executed.length, 1);
});
