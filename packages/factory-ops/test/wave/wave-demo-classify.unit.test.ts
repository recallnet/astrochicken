import assert from "node:assert/strict";
import test from "node:test";

import { classifyWaveDemoStrategy } from "../../src/commands/wave-demo-classify.ts";

test("classifyWaveDemoStrategy selects terminal in auto mode when CLI signals are present", () => {
  const mergedResultsRaw = JSON.stringify([
    {
      issue_number: "2551",
      issue_title: "Improve CLI output for wave command",
      merge_notes: "Updated terminal output formatting",
    },
  ]);

  const out = classifyWaveDemoStrategy({
    mergedResultsRaw,
    issueMetadataRaw: JSON.stringify({ labels: ["kind:cli"] }),
    demoStrategy: "auto",
    pipeline: "wave_execute",
  });

  assert.equal(out.demo_strategy, "terminal");
  assert.equal(out.demo_decision, "generate");
  assert.equal(out.no_demo, false);
  assert.deepEqual(out.reason_codes, ["DEMO_AUTO_TERMINAL_SIGNAL"]);
  assert.equal(out.telemetry["hatch.wave_demo.strategy"], "terminal");
  assert.equal(out.telemetry["hatch.wave_demo.decision"], "generate");
});

test("classifyWaveDemoStrategy selects browser in auto mode when UI/web signals are present", () => {
  const mergedResultsRaw = JSON.stringify([
    {
      issue_number: "3001",
      issue_title: "Polish dashboard UI",
      merge_notes: "Added screenshot test for web page",
    },
  ]);

  const out = classifyWaveDemoStrategy({
    mergedResultsRaw,
    issueMetadataRaw: JSON.stringify({
      labels: ["kind:web"],
      issue_title: "Improve browser workflow",
    }),
    demoStrategy: "auto",
  });

  assert.equal(out.demo_strategy, "browser");
  assert.equal(out.demo_decision, "generate");
  assert.equal(out.no_demo, false);
  assert.deepEqual(out.reason_codes, ["DEMO_AUTO_BROWSER_SIGNAL"]);
  assert.equal(out.telemetry["hatch.wave_demo.strategy"], "browser");
});

test("classifyWaveDemoStrategy honors forced none policy even when signals exist", () => {
  const out = classifyWaveDemoStrategy({
    mergedResultsRaw: JSON.stringify([{ issue_title: "CLI and UI updates" }]),
    issueMetadataRaw: JSON.stringify({ labels: ["kind:web", "kind:cli"] }),
    demoStrategy: "none",
  });

  assert.equal(out.demo_strategy, "none");
  assert.equal(out.demo_decision, "skip");
  assert.equal(out.no_demo, true);
  assert.deepEqual(out.reason_codes, ["DEMO_POLICY_FORCED_NONE"]);
  assert.equal(out.telemetry["hatch.wave_demo.no_demo"], "true");
});

test("classifyWaveDemoStrategy is deterministic for same inputs", () => {
  const input = {
    mergedResultsRaw: JSON.stringify([
      { issue_title: "Improve shell command ergonomics", merge_notes: "terminal output" },
    ]),
    issueMetadataRaw: JSON.stringify({ labels: ["kind:cli"] }),
    demoStrategy: "auto",
    pipeline: "wave_execute",
  };

  const first = classifyWaveDemoStrategy(input);
  const second = classifyWaveDemoStrategy(input);

  assert.deepEqual(second, first);
});

test("classifyWaveDemoStrategy always emits non-empty reason_codes", () => {
  const cases = [
    classifyWaveDemoStrategy({ demoStrategy: "none" }),
    classifyWaveDemoStrategy({ demoStrategy: "terminal" }),
    classifyWaveDemoStrategy({ demoStrategy: "browser" }),
    classifyWaveDemoStrategy({
      demoStrategy: "auto",
      mergedResultsRaw: "[]",
      issueMetadataRaw: "{}",
    }),
    classifyWaveDemoStrategy({
      demoStrategy: "auto",
      mergedResultsRaw: JSON.stringify([{ issue_title: "misc internal cleanup" }]),
      issueMetadataRaw: "{}",
    }),
  ];

  for (const out of cases) {
    assert.equal(Array.isArray(out.reason_codes), true);
    assert.equal(out.reason_codes.length > 0, true);
    assert.equal(typeof out.reason_codes[0], "string");
    assert.equal(out.reason_codes[0].length > 0, true);
  }
});
