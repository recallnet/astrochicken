import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  FIXTURES_DIR,
  assertDiagnosticShape,
  parseDebtTelemetry,
  parseInlineTelemetry,
  parseShellMetasyntaxTelemetry,
  parseToolPolicyTelemetry,
  runDotLint,
  runDotLintSource,
  warningDiagnostics,
  writeFixtureFiles,
  writeTmpDot,
} from "./dot-lint.test-support.mjs";

test("dot-lint clean fixture exits 0 with no diagnostics", () => {
  const run = runDotLint([`${FIXTURES_DIR}/clean.dot`]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(run.diagnostics, []);
});

test("dot-lint supports deterministic JS parser fallback for hook-safe execution", () => {
  const run = runDotLint([`${FIXTURES_DIR}/clean.dot`], {
    env: {
      HATCH_DOT_PARSER_FORCE_FALLBACK: "1",
    },
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(run.diagnostics, []);
});

test("dot-lint applies imported stylesheet defaults before lint rules", () => {
  const fixtureDir = writeFixtureFiles({
    "styles/defaults.stylesheet": `.coder { label = "Styled label"; trust_domain = "ops"; trust_role = "ops.tool" }\n`,
    "pipeline.dot": `@import "styles/defaults.stylesheet"
digraph imported_defaults {
  start [shape=Mdiamond]
  done [shape=Msquare]
  build [type="tool" class="coder" benchmark_job_id="wave.execute.issue.build" prompt_version="2026-03-09.r1" role_version="1.0.0" skill_id="wave.execute.issue" output_key="build_out" governance="irreversible" prompt="printf 'ok'"]
  start -> build -> done
}`,
  });

  const run = runDotLint([join(fixtureDir, "pipeline.dot"), "--compat-file", `${FIXTURES_DIR}/compat-empty.json`]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(run.errors, []);
});

test("dot-lint parser fallback preserves stylesheet import metadata", () => {
  const fixtureDir = writeFixtureFiles({
    "styles/defaults.stylesheet": `.coder { label = "Styled label" }\n`,
    "pipeline.dot": `@import "styles/defaults.stylesheet"
digraph imported_defaults_fallback {
  start [shape=Mdiamond]
  done [shape=Msquare]
  build [type="tool" class="coder" benchmark_job_id="wave.execute.issue.build" prompt_version="2026-03-09.r1" role_version="1.0.0" skill_id="wave.execute.issue" output_key="build_out" governance="irreversible" prompt="printf 'ok'"]
  start -> build -> done
}`,
  });

  const run = runDotLint([join(fixtureDir, "pipeline.dot"), "--compat-file", `${FIXTURES_DIR}/compat-empty.json`], {
    env: {
      HATCH_DOT_PARSER_FORCE_FALLBACK: "1",
    },
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(run.errors, []);
});

test("dot-lint reports missing stylesheet imports as parser.stylesheet_import", () => {
  const fixtureDir = writeFixtureFiles({
    "pipeline.dot": `@import "styles/missing.stylesheet"
digraph missing_import {
  start [shape=Mdiamond]
  done [shape=Msquare]
  start -> done
}`,
  });

  const run = runDotLint([join(fixtureDir, "pipeline.dot"), "--compat-file", `${FIXTURES_DIR}/compat-empty.json`]);
  assert.equal(run.status, 1, "missing import should fail lint");
  assert.equal(run.errors.length, 1);
  assert.equal(run.errors[0].rule_id, "parser.stylesheet_import");
  assert.match(run.errors[0].message, /unable to resolve import/);
});

test("dot-lint reports circular stylesheet imports as parser.stylesheet_import", () => {
  const fixtureDir = writeFixtureFiles({
    "styles/a.stylesheet": `@import "b.stylesheet"\n.coder { label = "A" }\n`,
    "styles/b.stylesheet": `@import "a.stylesheet"\n.coder { label = "B" }\n`,
    "pipeline.dot": `@import "styles/a.stylesheet"
digraph circular_import {
  start [shape=Mdiamond]
  done [shape=Msquare]
  build [type="tool" class="coder" benchmark_job_id="wave.execute.issue.build" prompt_version="2026-03-09.r1" role_version="1.0.0" skill_id="wave.execute.issue" output_key="build_out" governance="irreversible" prompt="printf 'ok'"]
  start -> build -> done
}`,
  });

  const run = runDotLint([join(fixtureDir, "pipeline.dot"), "--compat-file", `${FIXTURES_DIR}/compat-empty.json`]);
  assert.equal(run.status, 1, "cycle import should fail lint");
  assert.equal(run.errors.length, 1);
  assert.equal(run.errors[0].rule_id, "parser.stylesheet_import");
  assert.match(run.errors[0].message, /circular stylesheet import detected/);
});

test("dot-lint resolves repo-root stylesheet fallback from linted file path, not process cwd", () => {
  const fixtureDir = writeFixtureFiles({
    "shared/defaults.stylesheet": `.coder { label = "Styled label"; trust_domain = "ops"; trust_role = "ops.tool" }\n`,
    "graphs/pipeline.dot": `@import "shared/defaults.stylesheet"
digraph import_repo_root_fallback {
  start [shape=Mdiamond]
  done [shape=Msquare]
  build [type="tool" class="coder" benchmark_job_id="wave.execute.issue.build" prompt_version="2026-03-09.r1" role_version="1.0.0" skill_id="wave.execute.issue" output_key="build_out" governance="irreversible" prompt="printf 'ok'"]
  start -> build -> done
}`,
  });
  mkdirSync(join(fixtureDir, ".git"), { recursive: true });

  const graphFile = join(fixtureDir, "graphs", "pipeline.dot");
  const run = runDotLint([
    graphFile,
    "--compat-file",
    resolve(`${FIXTURES_DIR}/compat-empty.json`),
  ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(run.errors, []);
});

test("dot-lint syntax-error fixture emits exact parser.syntax diagnostic fields", () => {
  const run = runDotLint([`${FIXTURES_DIR}/syntax-error.txt`]);
  assert.equal(run.status, 1, "syntax fixture should fail lint");
  assert.equal(run.diagnostics.length, 1);

  const diagnostic = run.diagnostics[0];
  assertDiagnosticShape(diagnostic);
  assert.deepEqual(diagnostic, {
    file: "scripts/test/fixtures/dot-lint/syntax-error.txt",
    severity: "error",
    rule_id: "parser.syntax",
    message: "expected '=' in attribute",
    line: 3,
    column: 8,
    node: "",
  });
});

test("dot-lint legacy compat fixture suppresses alias errors but still applies non-alias rules", () => {
  const run = runDotLint([
    `${FIXTURES_DIR}/legacy-compat.dot`,
    "--compat-file",
    `${FIXTURES_DIR}/compat-legacy.json`,
  ]);

  assert.equal(run.status, 1, "legacy fixture should still fail non-alias rules");
  assert.deepEqual(run.diagnostics, [
    {
      file: "scripts/test/fixtures/dot-lint/legacy-compat.dot",
      severity: "error",
      rule_id: "node.label.required",
      message: "node \"legacy_tool\" must declare non-empty label (required for all non-start/exit nodes)",
      line: 4,
      column: 3,
      node: "legacy_tool",
    },
  ]);
});

test("dot-lint emits telemetry.benchmark_identity_required for LLM classes missing benchmark_job_id", () => {
  const run = runDotLint([`${FIXTURES_DIR}/benchmark-missing-attrs.txt`, "--compat-file", `${FIXTURES_DIR}/compat-empty.json`]);
  assert.equal(run.status, 1, "missing attrs fixture should fail lint");
  const diagnostic = run.errors.find((entry) => entry.rule_id === "telemetry.benchmark_identity_required");
  assert.ok(diagnostic, "expected telemetry.benchmark_identity_required diagnostic");
  assert.match(String(diagnostic.message || ""), /missing required "benchmark_job_id" annotation/);
  assert.equal(diagnostic.node, "build");
});

test("dot-lint emits benchmark_identity.missing_attributes for unregistered benchmark_job_id", () => {
  const run = runDotLint([`${FIXTURES_DIR}/benchmark-unregistered-job.txt`, "--compat-file", `${FIXTURES_DIR}/compat-empty.json`]);
  assert.equal(run.status, 1, "unregistered benchmark_job_id fixture should fail lint");
  const diagnostic = run.errors.find((entry) => entry.rule_id === "benchmark_identity.missing_attributes");
  assert.ok(diagnostic, "expected benchmark_identity.missing_attributes diagnostic");
  assert.match(String(diagnostic.message || ""), /is not registered in docs\/contracts\/benchmark-job-id-registry.json/);
  assert.equal(diagnostic.node, "review");
});

test("dot-lint deterministic-order fixture is stably sorted by file/severity/rule-id/line/column/node", () => {
  const run = runDotLint([
    `${FIXTURES_DIR}/order-b.dot`,
    `${FIXTURES_DIR}/order-a.dot`,
    "--compat-file",
    `${FIXTURES_DIR}/compat-empty.json`,
  ]);

  assert.equal(run.status, 1, "order fixture should fail lint");
  assert.equal(run.diagnostics.length, 8);

  for (const diagnostic of run.diagnostics) {
    assertDiagnosticShape(diagnostic);
  }

  const expected = [
    {
      file: "scripts/test/fixtures/dot-lint/order-a.dot",
      severity: "error",
      rule_id: "node.label.required",
      message: "node \"zeta\" must declare non-empty label (required for all non-start/exit nodes)",
      line: 4,
      column: 3,
      node: "zeta",
    },
    {
      file: "scripts/test/fixtures/dot-lint/order-a.dot",
      severity: "error",
      rule_id: "node.label.required",
      message: "node \"eta\" must declare non-empty label (required for all non-start/exit nodes)",
      line: 5,
      column: 3,
      node: "eta",
    },
    {
      file: "scripts/test/fixtures/dot-lint/order-a.dot",
      severity: "error",
      rule_id: "trust.compat.alias",
      message: "node \"zeta\" uses legacy trust_participant; prefer trust_domain/trust_role or declare explicit compat",
      line: 4,
      column: 56,
      node: "zeta",
    },
    {
      file: "scripts/test/fixtures/dot-lint/order-a.dot",
      severity: "error",
      rule_id: "trust.compat.domain_role_pair",
      message: "node \"eta\" must declare trust_domain and trust_role together",
      line: 5,
      column: 3,
      node: "eta",
    },
    {
      file: "scripts/test/fixtures/dot-lint/order-b.dot",
      severity: "error",
      rule_id: "node.label.required",
      message: "node \"beta\" must declare non-empty label (required for all non-start/exit nodes)",
      line: 4,
      column: 3,
      node: "beta",
    },
    {
      file: "scripts/test/fixtures/dot-lint/order-b.dot",
      severity: "error",
      rule_id: "node.label.required",
      message: "node \"alpha\" must declare non-empty label (required for all non-start/exit nodes)",
      line: 5,
      column: 3,
      node: "alpha",
    },
    {
      file: "scripts/test/fixtures/dot-lint/order-b.dot",
      severity: "error",
      rule_id: "trust.compat.alias",
      message: "node \"alpha\" uses legacy trust_participant; prefer trust_domain/trust_role or declare explicit compat",
      line: 5,
      column: 57,
      node: "alpha",
    },
    {
      file: "scripts/test/fixtures/dot-lint/order-b.dot",
      severity: "error",
      rule_id: "trust.compat.domain_role_pair",
      message: "node \"beta\" must declare trust_domain and trust_role together",
      line: 4,
      column: 3,
      node: "beta",
    },
  ];

  assert.deepEqual(run.diagnostics, expected);
});

test("dot-lint emits warning for undefined context reference but exits 0 when no errors", () => {
  const source = `digraph undefined_reference_warning {
  start [shape=Mdiamond]
  done [shape=Msquare]
  producer [type="tool" label="Producer" output_key="producer_output" governance="reversible" prompt="echo \${missing_key}"]
  start -> producer
  producer -> done [condition="producer_output=true"]
}`;

  const run = runDotLintSource({ name: "undefined-reference-warning", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const warnings = warningDiagnostics(run);
  assert.equal(warnings.length, 1);
  assertDiagnosticShape(warnings[0]);
  assert.equal(warnings[0].rule_id, "context_flow.undefined_reference");
  assert.equal(warnings[0].node, "producer");
  assert.match(warnings[0].message, /label="Producer"/);
  assert.match(warnings[0].message, /undefined context key "missing_key"/);
  assert.match(warnings[0].message, /node_attr\.prompt/);
});

test("dot-lint emits warning for unused tool output_key in simple chain", () => {
  const source = `digraph unused_output_key_simple {
  start [shape=Mdiamond]
  done [shape=Msquare]
  producer [type="tool" label="Producer" output_key="orphan_key" governance="reversible" prompt="printf 'ok'"]
  reader [type="codergen" label="Reader" prompt="No context refs"]
  start -> producer -> reader -> done
}`;

  const run = runDotLintSource({ name: "unused-output-key-simple", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const warnings = warningDiagnostics(run);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].rule_id, "context_flow.unused_output_key");
  assert.equal(warnings[0].node, "producer");
  assert.match(warnings[0].message, /output_key "orphan_key"/);
});

test("dot-lint warns for unused output_key in branch graphs", () => {
  const source = `digraph unused_output_key_branch {
  start [shape=Mdiamond]
  done [shape=Msquare]
  gate [shape=diamond label="Gate"]
  left_producer [type="tool" label="Left producer" output_key="left_only" governance="reversible" prompt="printf 'ok'"]
  right_path [type="codergen" label="Right path" prompt="Nothing"]
  join [type="codergen" label="Join" prompt="Joined"]
  start -> gate
  gate -> left_producer [condition="outcome=success"]
  gate -> right_path [condition="outcome!=success"]
  left_producer -> join
  right_path -> join
  join -> done
}`;

  const run = runDotLintSource({ name: "unused-output-key-branch", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const warnings = warningDiagnostics(run);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].rule_id, "context_flow.unused_output_key");
  assert.equal(warnings[0].node, "left_producer");
});

test("dot-lint treats context_keys as downstream consumption for pipeline nodes", () => {
  const source = `digraph pipeline_context_keys {
  start [shape=Mdiamond]
  done [shape=Msquare]
  producer [type="tool" label="Producer" output_key="shared_key" governance="reversible" prompt="printf 'ok'"]
  child [type="pipeline" label="Child graph" pipeline="child.dot" context_keys="shared_key"]
  start -> producer -> child -> done
}`;

  const run = runDotLintSource({ name: "pipeline-context-keys", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(warningDiagnostics(run), []);
});

test("dot-lint treats action_* placeholder references as downstream consumption", () => {
  const source = `digraph action_attr_consumption {
  start [shape=Mdiamond]
  done [shape=Msquare]
  producer [type="tool" label="Producer" output_key="shared_key" governance="reversible" prompt="printf 'ok'"]
  consumer [type="tool" label="Consumer" output_key="consumer_result" governance="reversible" action_value="\${shared_key}" prompt="printf 'ok'"]
  start -> producer -> consumer -> done
}`;

  const run = runDotLintSource({ name: "action-attr-consumption", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const warnings = warningDiagnostics(run);
  assert.equal(
    warnings.filter((warning) => warning.node === "producer" && warning.rule_id === "context_flow.unused_output_key").length,
    0,
  );
});

test("dot-lint treats source_key as downstream consumption", () => {
  const source = `digraph fanout_source_key {
  start [shape=Mdiamond]
  done [shape=Msquare]
  producer [type="tool" label="Producer" output_key="shared_key" governance="reversible" prompt="printf 'ok'"]
  child [type="parallel" label="Fan out" source_key="shared_key"]
  start -> producer -> child -> done
}`;

  const run = runDotLintSource({ name: "source-key-consumption", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(warningDiagnostics(run), []);
});

test("dot-lint treats pipeline export_keys as produced context", () => {
  const source = `digraph pipeline_export_keys {
  start [shape=Mdiamond]
  done [shape=Msquare]
  child [type="pipeline" label="Child graph" pipeline="child.dot" export_keys="shared_result"]
  consumer [type="tool" label="Consumer" output_key="__consumer_result" governance="reversible" prompt="echo '\${shared_result}'"]
  start -> child -> consumer -> done
}`;

  const run = runDotLintSource({ name: "pipeline-export-keys", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(
    warningDiagnostics(run).filter((warning) => warning.node === "consumer" && warning.rule_id === "context_flow.undefined_reference").length,
    0,
  );
});

test("dot-lint treats intake_json as managed shell seed context", () => {
  const source = `digraph managed_domain_seed {
  start [shape=Mdiamond]
  done [shape=Msquare]
  intake [type="tool" label="Intake" output_key="__intake_result" governance="reversible" action_runtime="in_process" action_id="brainstorm.build_intake_context" action_intake_json="\${intake_json}"]
  start -> intake -> done
}`;

  const run = runDotLintSource({ name: "managed-domain-seed", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(
    warningDiagnostics(run).filter((warning) => warning.node === "intake" && warning.rule_id === "context_flow.undefined_reference").length,
    0,
  );
});

test("dot-lint accepts terminal domain_result contract outputs", () => {
  const source = `digraph managed_domain_contract {
  start [shape=Mdiamond]
  done [shape=Msquare]
  emit [type="tool" label="Emit domain result" output_key="domain_result" governance="reversible" prompt="echo '{}'"]
  start -> emit -> done
}`;

  const run = runDotLintSource({ name: "managed-domain-contract-output", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(
    warningDiagnostics(run).filter((warning) => warning.node === "emit" && warning.rule_id === "context_flow.unused_output_key").length,
    0,
  );
});

test("dot-lint accepts terminal goal_terminal_path contract outputs", () => {
  const source = `digraph goal_terminal_contract {
  start [shape=Mdiamond]
  done [shape=Msquare]
  emit [type="tool" label="Emit goal terminal path" output_key="goal_terminal_path" governance="reversible" prompt="echo 'no_merge'"]
  start -> emit -> done
}`;

  const run = runDotLintSource({ name: "goal-terminal-contract-output", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(
    warningDiagnostics(run).filter((warning) => warning.node === "emit" && warning.rule_id === "context_flow.unused_output_key").length,
    0,
  );
});

test("dot-lint accepts terminal impl_result contract outputs", () => {
  const source = `digraph issue_impl_contract {
  start [shape=Mdiamond]
  done [shape=Msquare]
  emit [type="tool" label="Emit impl result" output_key="impl_result" governance="reversible" prompt="echo '{}'"]
  start -> emit -> done
}`;

  const run = runDotLintSource({ name: "issue-impl-contract-output", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(
    warningDiagnostics(run).filter((warning) => warning.node === "emit" && warning.rule_id === "context_flow.unused_output_key").length,
    0,
  );
});

test("dot-lint ignores receipt-only __result output keys", () => {
  const source = `digraph receipt_only_output {
  start [shape=Mdiamond]
  done [shape=Msquare]
  receipt [type="tool" label="Receipt" output_key="__receipt_result" governance="irreversible" prompt="printf 'ok'"]
  start -> receipt -> done
}`;

  const run = runDotLintSource({ name: "receipt-only-output", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(warningDiagnostics(run), []);
});

test("dot-lint treats managed factory context keys as seeded inputs", () => {
  const source = `digraph managed_seed_keys {
  start [shape=Mdiamond]
  done [shape=Msquare]
  consumer [type="tool" label="Consumer" output_key="consumer_output" governance="reversible" prompt="echo \${target_repo} \${control_plane_repo} \${factory_root} \${instance_id} \${gh_repo} \${source_repos}"]
  start -> consumer
  consumer -> done [condition="consumer_output=true"]
}`;

  const run = runDotLintSource({ name: "managed-seed-keys", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(warningDiagnostics(run), []);
});

test("dot-lint ignores seed-normalization outputs for managed factory resolver nodes", () => {
  const source = `digraph seed_normalization_outputs {
  start [shape=Mdiamond]
  done [shape=Msquare]
  normalize [type="tool" label="Normalize control plane" governance="reversible" action_id="common.resolve_factory_config" action_key="control_plane_repo" action_fallback="\${target_repo}" output_key="control_plane_repo" prompt="printf 'ok'"]
  start -> normalize -> done
}`;

  const run = runDotLintSource({ name: "seed-normalization-outputs", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(
    warningDiagnostics(run).filter((warning) => warning.node === "normalize" && warning.rule_id === "context_flow.unused_output_key").length,
    0,
  );
});

test("dot-lint does not warn for allowlisted undefined-reference keys", () => {
  const source = `digraph allowlisted_refs {
  start [shape=Mdiamond]
  done [shape=Msquare]
  producer [type="tool" label="Producer" output_key="producer_output" governance="reversible" prompt="echo \${goal} \${goal_statement} \${issue_number}"]
  start -> producer
  producer -> done [condition="producer_output=true"]
}`;

  const run = runDotLintSource({ name: "allowlisted-refs", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(warningDiagnostics(run), []);
});

test("dot-lint ignores unused output_key when structured outputs are consumed downstream", () => {
  const source = `digraph structured_output_consumption {
  start [shape=Mdiamond]
  done [shape=Msquare]
  produce [type="tool" label="Produce" output_key="judge_result" outputs="disposition,confidence" governance="reversible" prompt="echo '{}'"]
  consume [type="tool" label="Consume" output_key="__consume_result" governance="reversible" prompt="echo '\${disposition}'"]
  start -> produce -> consume -> done
}`;

  const run = runDotLintSource({ name: "structured-output-consumption", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(
    warningDiagnostics(run).filter((warning) => warning.node === "produce" && warning.rule_id === "context_flow.unused_output_key").length,
    0,
  );
});

test("dot-lint ignores emitter receipt outputs without downstream consumers", () => {
  const source = `digraph emitter_receipt_output {
  start [shape=Mdiamond]
  done [shape=Msquare]
  emit [type="tool" label="Emit telemetry" output_key="resolution_failure_event" governance="reversible" action_runtime="in_process" action_id="merge.emit_resolution_failure"]
  start -> emit -> done
}`;

  const run = runDotLintSource({ name: "emitter-receipt-output", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(
    warningDiagnostics(run).filter((warning) => warning.node === "emit" && warning.rule_id === "context_flow.unused_output_key").length,
    0,
  );
});

test("dot-lint allows resolve_default self-bootstrap placeholders for action_value", () => {
  const source = `digraph resolve_default_self_bootstrap {
  start [shape=Mdiamond]
  done [shape=Msquare]
  bind_backoff [type="tool" label="Bind backoff" output_key="dispatch_retry_backoff_seconds" governance="reversible" action_runtime="in_process" action_id="common.resolve_default" action_value="\${dispatch_retry_backoff_seconds}" action_fallback="60"]
  start -> bind_backoff -> done
}`;

  const run = runDotLintSource({ name: "resolve-default-self-bootstrap", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(
    warningDiagnostics(run).filter((warning) => warning.node === "bind_backoff" && warning.rule_id === "context_flow.undefined_reference").length,
    0,
  );
});

test("dot-lint ignores malformed placeholder shapes without crashing or duplicate false positives", () => {
  const source = `digraph malformed_placeholders {
  start [shape=Mdiamond]
  done [shape=Msquare]
  producer [type="tool" label="Producer" output_key="producer_output" governance="reversible" prompt="echo \${} \${bad \${nested\${x}} \${unterminated"]
  start -> producer
  producer -> done [condition="producer_output=true"]
}`;

  const run = runDotLintSource({ name: "malformed-placeholders", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(warningDiagnostics(run), []);
});

test("dot-lint requires label on non-start/exit nodes", () => {
  const source = `digraph missing_label {
  start [shape=Mdiamond]
  done [shape=Msquare]
  unlabeled [type="tool" output_key="unlabeled_out" governance="irreversible" prompt="printf 'ok'"]
  start -> unlabeled -> done
}`;

  const run = runDotLintSource({ name: "missing-label", source });
  assert.equal(run.status, 1, "missing label should fail lint");
  assert.equal(run.errors.length, 1);
  assert.equal(run.errors[0].rule_id, "node.label.required");
  assert.equal(run.errors[0].node, "unlabeled");
});

test("dot-lint accepts tool output metadata aliases with deterministic precedence", () => {
  const source = `digraph output_metadata_aliases {
  start [shape=Mdiamond]
  done [shape=Msquare]
  preferred [type="tool" label="Preferred" output_key="preferred_out" output_keys="legacy_list" outputs="legacy_fields" governance="irreversible" prompt="printf 'ok'"]
  alias_output_keys [type="tool" label="Alias output_keys" output_keys="legacy_one" governance="irreversible" prompt="printf 'ok'"]
  alias_outputs [type="tool" label="Alias outputs" outputs="field_one,field_two" governance="irreversible" prompt="printf 'ok'"]
  start -> preferred
  preferred -> alias_output_keys [condition="preferred_out=ok"]
  alias_output_keys -> alias_outputs -> done
}`;

  const run = runDotLintSource({ name: "output-metadata-aliases", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(run.errors, []);
});

test("dot-lint enforces tool output metadata unless prompt is allowlisted no-op/router", () => {
  const source = `digraph output_metadata_required {
  start [shape=Mdiamond]
  done [shape=Msquare]
  missing_output_metadata [type="tool" label="Missing output metadata" governance="irreversible" prompt="printf 'ok'"]
  allowlisted_router [type="tool" label="Allowlisted router" governance="reversible" prompt=" : ; "]
  start -> missing_output_metadata -> allowlisted_router -> done
}`;

  const run = runDotLintSource({ name: "output-metadata-required", source });
  assert.equal(run.status, 1, "non-allowlisted tool without output metadata should fail");
  assert.equal(run.diagnostics.length, 1);
  assert.equal(run.diagnostics[0].rule_id, "tool.output_metadata.required");
  assert.equal(run.diagnostics[0].node, "missing_output_metadata");
});

test("dot-lint classifies mutable commands deterministically and enforces irreversible governance", () => {
  const source = `digraph mutable_governance {
  start [shape=Mdiamond]
  done [shape=Msquare]
  mutable_missing_governance [type="tool" label="Missing governance" output_key="out_missing" prompt="gh issue close 1 --repo octo/example"]
  mutable_reversible [type="tool" label="Reversible mutable" output_key="out_reversible" governance="reversible" prompt="gh issue close 2 --repo octo/example"]
  mutable_irreversible [type="tool" label="Irreversible mutable" output_key="out_irreversible" governance="irreversible" prompt="gh issue close 3 --repo octo/example"]
  start -> mutable_missing_governance -> mutable_reversible -> mutable_irreversible -> done
}`;

  const run = runDotLintSource({ name: "mutable-governance", source });
  assert.equal(run.status, 1, "mutable governance mismatches should fail");

  const ruleIds = run.errors.map((diagnostic) => diagnostic.rule_id);
  assert.ok(ruleIds.includes("tool.governance.missing_for_mutable"));
  assert.ok(ruleIds.includes("tool.governance.mutable_requires_irreversible"));
  assert.equal(ruleIds.includes("tool.output_metadata.required"), false);
  assert.equal(ruleIds.includes("tool.prompt.declarative_policy"), false);

  const byNodeRuleSet = new Map();
  for (const diagnostic of run.errors) {
    const set = byNodeRuleSet.get(diagnostic.node) || new Set();
    set.add(diagnostic.rule_id);
    byNodeRuleSet.set(diagnostic.node, set);
  }
  assert.ok(byNodeRuleSet.get("mutable_missing_governance")?.has("tool.governance.missing_for_mutable"));
  assert.ok(byNodeRuleSet.get("mutable_reversible")?.has("tool.governance.mutable_requires_irreversible"));
  assert.equal(byNodeRuleSet.has("mutable_irreversible"), false);
});

test("dot-lint accepts clean shell-metasyntax fixture including judge_context placeholders", () => {
  const run = runDotLint([
    `${FIXTURES_DIR}/shell-metasyntax-clean.dot`,
    "--compat-file",
    `${FIXTURES_DIR}/compat-empty.json`,
  ]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.diagnostics.some((diagnostic) => diagnostic.rule_id === "prompt.shell_metasyntax"), false);
});

test("dot-lint flags shell metasyntax with node/file context and judge-context-safe clean prompts", () => {
  const run = runDotLint([
    `${FIXTURES_DIR}/shell-metasyntax-invalid.txt`,
    `${FIXTURES_DIR}/shell-metasyntax-clean.dot`,
    "--compat-file",
    `${FIXTURES_DIR}/compat-empty.json`,
  ]);
  assert.equal(run.status, 1, "shell metasyntax fixture should fail lint");

  const shellDiagnostics = run.errors.filter((diagnostic) => diagnostic.rule_id === "prompt.shell_metasyntax");
  assert.equal(shellDiagnostics.length, 8);
  const shellByNode = new Map(shellDiagnostics.map((diagnostic) => [diagnostic.node, diagnostic]));
  assert.match(shellByNode.get("invalid_pipe")?.message || "", /token="\|"/);
  assert.match(shellByNode.get("invalid_and")?.message || "", /token="&&"/);
  assert.match(shellByNode.get("invalid_semicolon")?.message || "", /token=";"/);
  assert.match(shellByNode.get("invalid_redirect_write")?.message || "", /token=">"/);
  assert.match(shellByNode.get("invalid_redirect_read")?.message || "", /token="<"/);
  assert.match(shellByNode.get("invalid_heredoc")?.message || "", /token="<<"/);
  assert.match(shellByNode.get("invalid_subshell")?.message || "", /token="\$\("/);
  assert.match(shellByNode.get("invalid_backticks")?.message || "", /token="`"/);
  assert.equal(shellByNode.has("judge_context_ok"), false, "${context.judge_context} should not trigger false positives");

  for (const diagnostic of shellDiagnostics) {
    assert.equal(typeof diagnostic.file, "string");
    assert.equal(diagnostic.file, "scripts/test/fixtures/dot-lint/shell-metasyntax-invalid.txt");
    assert.equal(typeof diagnostic.line, "number");
    assert.equal(typeof diagnostic.column, "number");
    assert.ok(diagnostic.line > 0);
    assert.ok(diagnostic.column > 0);
  }

  const telemetry = parseShellMetasyntaxTelemetry(run.stderr);
  assert.equal(telemetry.length, 8);
  assert.ok(telemetry.some((line) => line.includes('node="invalid_pipe"') && line.includes('token="|"') && line.includes('file="scripts/test/fixtures/dot-lint/shell-metasyntax-invalid.txt"')));
  assert.ok(telemetry.some((line) => line.includes('node_id="invalid_pipe"') && line.includes('forbidden_token="|"') && line.includes('file="scripts/test/fixtures/dot-lint/shell-metasyntax-invalid.txt"')));
  assert.ok(telemetry.some((line) => line.includes('node_id="invalid_and"') && line.includes('forbidden_token="&&"')));
  assert.ok(telemetry.some((line) => line.includes('node_id="invalid_semicolon"') && line.includes('forbidden_token=";"')));
  assert.ok(telemetry.some((line) => line.includes('node_id="invalid_redirect_write"') && line.includes('forbidden_token=">"')));
  assert.ok(telemetry.some((line) => line.includes('node_id="invalid_redirect_read"') && line.includes('forbidden_token="<"')));
  assert.ok(telemetry.some((line) => line.includes('node_id="invalid_heredoc"') && line.includes('forbidden_token="<<"')));
  assert.ok(telemetry.some((line) => line.includes('node_id="invalid_subshell"') && line.includes('forbidden_token="$("')));
  assert.ok(telemetry.some((line) => line.includes('node_id="invalid_backticks"') && line.includes('forbidden_token="`"')));

  const cleanDiagnostics = run.diagnostics.filter((diagnostic) => diagnostic.file === "scripts/test/fixtures/dot-lint/shell-metasyntax-clean.dot");
  assert.equal(cleanDiagnostics.some((diagnostic) => diagnostic.rule_id === "prompt.shell_metasyntax"), false);
});

test("dot-lint flags expanded shell metasyntax token set used by active graphs", () => {
  const source = `digraph expanded_shell_tokens {
  start [shape=Mdiamond]
  done [shape=Msquare]
  invalid_or [type="tool" label="Invalid or" output_key="out_or" governance="reversible" prompt="echo foo || echo bar"]
  invalid_append [type="tool" label="Invalid append" output_key="out_append" governance="reversible" prompt="echo foo >> /tmp/out.log"]
  invalid_stderr_redirect [type="tool" label="Invalid stderr redirect" output_key="out_stderr_redirect" governance="reversible" prompt="echo foo 2> /tmp/err.log"]
  invalid_stderr_merge [type="tool" label="Invalid stderr merge" output_key="out_stderr_merge" governance="reversible" prompt="echo foo 2>&1"]
  invalid_heredoc_strip_tabs [type="tool" label="Invalid heredoc strip tabs" output_key="out_heredoc_tabs" governance="reversible" prompt="cat <<-EOF"]
  start -> invalid_or -> invalid_append -> invalid_stderr_redirect -> invalid_stderr_merge -> invalid_heredoc_strip_tabs -> done
}`;

  const run = runDotLintSource({ name: "expanded-shell-tokens", source });
  assert.equal(run.status, 1, "expanded shell token fixture should fail lint");

  const shellDiagnostics = run.errors.filter((diagnostic) => diagnostic.rule_id === "prompt.shell_metasyntax");
  assert.equal(shellDiagnostics.length, 5);

  const tokensByNode = new Map(shellDiagnostics.map((diagnostic) => {
    const tokenMatch = diagnostic.message.match(/token="([^"]+)"/);
    return [diagnostic.node, tokenMatch?.[1] || ""];
  }));

  assert.equal(tokensByNode.get("invalid_or"), "||");
  assert.equal(tokensByNode.get("invalid_append"), ">>");
  assert.equal(tokensByNode.get("invalid_stderr_redirect"), "2>");
  assert.equal(tokensByNode.get("invalid_stderr_merge"), "2>&1");
  assert.equal(tokensByNode.get("invalid_heredoc_strip_tabs"), "<<-");

  const telemetry = parseShellMetasyntaxTelemetry(run.stderr);
  assert.equal(telemetry.length, 5);
  assert.ok(telemetry.some((line) => line.includes('node="invalid_or"') && line.includes('token="||"')));
  assert.ok(telemetry.some((line) => line.includes('node="invalid_append"') && line.includes('token=">>"')));
  assert.ok(telemetry.some((line) => line.includes('node="invalid_stderr_redirect"') && line.includes('token="2>"')));
  assert.ok(telemetry.some((line) => line.includes('node="invalid_stderr_merge"') && line.includes('token="2>&1"')));
  assert.ok(telemetry.some((line) => line.includes('node="invalid_heredoc_strip_tabs"') && line.includes('token="<<-"')));
});

test("dot-lint rejects focused shell-policy fixtures with deterministic diagnostics + telemetry", () => {
  const fixtures = [
    {
      file: "tool-prompt-shell-chain.txt",
      node: "shell_chain",
      token: "&&",
    },
    {
      file: "tool-prompt-heredoc.txt",
      node: "heredoc_prompt",
      token: "<<",
    },
    {
      file: "tool-prompt-subshell.txt",
      node: "subshell_prompt",
      token: "$(",
    },
  ];

  for (const fixture of fixtures) {
    const run = runDotLint([
      `${FIXTURES_DIR}/${fixture.file}`,
      "--compat-file",
      `${FIXTURES_DIR}/compat-empty.json`,
    ]);

    assert.equal(run.status, 1, `${fixture.file} should fail lint`);

    const shellDiagnostics = run.errors.filter((diagnostic) => diagnostic.rule_id === "prompt.shell_metasyntax" && diagnostic.node === fixture.node);
    assert.equal(shellDiagnostics.length, 1, `${fixture.file} should emit one shell metasyntax error`);
    assert.equal(shellDiagnostics[0].file, `scripts/test/fixtures/dot-lint/${fixture.file}`);
    assert.match(shellDiagnostics[0].message, new RegExp(`token=\"${fixture.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\"`));

    const policyDiagnostics = run.errors.filter((diagnostic) => diagnostic.rule_id === "tool.prompt.declarative_policy" && diagnostic.node === fixture.node);
    assert.equal(policyDiagnostics.length, 1, `${fixture.file} should emit one declarative policy error`);

    const shellTelemetry = parseShellMetasyntaxTelemetry(run.stderr);
    assert.ok(shellTelemetry.some((line) => line.includes(`node=\"${fixture.node}\"`) && line.includes(`file=\"scripts/test/fixtures/dot-lint/${fixture.file}\"`) && line.includes(`token=\"${fixture.token}\"`)));

    const policyTelemetry = parseToolPolicyTelemetry(run.stderr);
    assert.ok(policyTelemetry.some((line) => line.includes(`node=\"${fixture.node}\"`) && line.includes(`file=\"scripts/test/fixtures/dot-lint/${fixture.file}\"`) && line.includes(`token=\"${fixture.token}\"`)));
  }
});

test("dot-lint accepts declarative single-command fixture with ${context.*} placeholder", () => {
  const run = runDotLint([
    `${FIXTURES_DIR}/tool-prompt-declarative-valid.dot`,
    "--compat-file",
    `${FIXTURES_DIR}/compat-empty.json`,
  ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.errors.some((diagnostic) => diagnostic.rule_id === "prompt.shell_metasyntax"), false);
  assert.equal(run.errors.some((diagnostic) => diagnostic.rule_id === "tool.prompt.declarative_policy"), false);
  assert.equal(parseShellMetasyntaxTelemetry(run.stderr).length, 0);
  assert.equal(parseToolPolicyTelemetry(run.stderr).length, 0);
});

test("dot-lint rejects newline-separated tool commands with deterministic token", () => {
  const source = `digraph declarative_policy_newline {
  start [shape=Mdiamond]
  done [shape=Msquare]
  newline_command [type="tool" label="Newline command" output_key="out_newline" governance="reversible" prompt="node ops/cli.mjs wave report --repo '\${context.repo}'\necho second"]
  start -> newline_command -> done
}`;

  const run = runDotLintSource({ name: "declarative-policy-newline", source });
  assert.equal(run.status, 1, "newline-separated commands should fail lint");

  const policyDiagnostics = run.errors.filter((diagnostic) => diagnostic.rule_id === "tool.prompt.declarative_policy");
  assert.equal(policyDiagnostics.length, 1);
  assert.equal(policyDiagnostics[0].node, "newline_command");
  assert.match(policyDiagnostics[0].message, /forbidden token="newline_separator"/);

  const telemetry = parseToolPolicyTelemetry(run.stderr);
  assert.equal(telemetry.length, 1);
  assert.ok(telemetry[0].includes('node="newline_command"'));
  assert.ok(telemetry[0].includes('token="newline_separator"'));
  assert.ok(telemetry[0].includes('node_id="newline_command"'));
  assert.ok(telemetry[0].includes('forbidden_token="newline_separator"'));
});

test("dot-lint rejects non-literal command tokens and command-position placeholders", () => {
  const source = `digraph declarative_policy_command_token {
  start [shape=Mdiamond]
  done [shape=Msquare]
  placeholder_command [type="tool" label="Placeholder command" output_key="out_placeholder" governance="reversible" prompt="\${context.command} --repo '\${context.repo}'"]
  quoted_command [type="tool" label="Quoted command" output_key="out_quoted" governance="reversible" prompt="'node' ops/cli.mjs run --repo '\${context.repo}'"]
  start -> placeholder_command -> quoted_command -> done
}`;

  const run = runDotLintSource({ name: "declarative-policy-command-token", source });
  assert.equal(run.status, 1, "invalid command tokens should fail lint");

  const policyDiagnostics = run.errors.filter((diagnostic) => diagnostic.rule_id === "tool.prompt.declarative_policy");
  assert.equal(policyDiagnostics.length, 2);
  const policyByNode = new Map(policyDiagnostics.map((diagnostic) => [diagnostic.node, diagnostic.message]));
  assert.match(policyByNode.get("placeholder_command") || "", /forbidden token="placeholder_command_token"/);
  assert.match(policyByNode.get("quoted_command") || "", /forbidden token="non_literal_command_token"/);

  const telemetry = parseToolPolicyTelemetry(run.stderr);
  assert.equal(telemetry.length, 2);
  assert.ok(telemetry.some((line) => line.includes('node="placeholder_command"') && line.includes('token="placeholder_command_token"')));
  assert.ok(telemetry.some((line) => line.includes('node="quoted_command"') && line.includes('token="non_literal_command_token"')));
  assert.ok(telemetry.some((line) => line.includes('node_id="placeholder_command"') && line.includes('forbidden_token="placeholder_command_token"')));
  assert.ok(telemetry.some((line) => line.includes('node_id="quoted_command"') && line.includes('forbidden_token="non_literal_command_token"')));
});

test("dot-lint inline executable violations emit deterministic diagnostics and violation telemetry", () => {
  const source = `digraph inline_unsuppressed {
  start [shape=Mdiamond]
  done [shape=Msquare]
  tool_py_heredoc [type="tool" label="Tool python heredoc" output_key="out_py_h" governance="irreversible" prompt="python - <<'PY'\\nprint('x')\\nPY"]
  tool_py3_heredoc [type="tool" label="Tool python3 heredoc" output_key="out_py3_h" governance="irreversible" prompt="python3 - <<'PY'\\nprint('x')\\nPY"]
  tool_py_c [type="tool" label="Tool python -c" output_key="out_py_c" governance="irreversible" prompt="python -c \\\"print('x')\\\""]
  tool_py3_c [type="tool" label="Tool python3 -c" output_key="out_py3_c" governance="irreversible" prompt="python3 -c \\\"print('x')\\\""]
  tool_sh_c [type="tool" label="Tool sh -c" output_key="out_sh_c" governance="irreversible" prompt="sh -c \\\"echo hi\\\""]
  tool_bash_c [type="tool" label="Tool bash -c" output_key="out_bash_c" governance="irreversible" prompt="bash -c \\\"echo hi\\\""]
  manager_node_e [type="stack.manager_loop" label="Manager node -e" governance="irreversible" prompt="Run: node -e \\\"console.log('x')\\\""]
  start -> tool_py_heredoc -> tool_py3_heredoc -> tool_py_c -> tool_py3_c -> tool_sh_c -> tool_bash_c -> manager_node_e -> done
}`;

  const run = runDotLintSource({ name: "inline-unsuppressed", source });
  assert.equal(run.status, 1, run.stderr || run.stdout);

  const inlineScriptErrors = run.errors.filter((diagnostic) => diagnostic.rule_id === "prompt.inline_script");
  assert.equal(inlineScriptErrors.length, 7);

  const messages = inlineScriptErrors.map((diagnostic) => diagnostic.message);
  assert.ok(messages.some((message) => message.includes('"python - <<\'PY\'"') && message.includes("match_type=heredoc")));
  assert.ok(messages.some((message) => message.includes('"python3 - <<\'PY\'"') && message.includes("match_type=heredoc")));
  assert.ok(messages.some((message) => message.includes('"python -c"') && message.includes("match_type=flag")));
  assert.ok(messages.some((message) => message.includes('"python3 -c"') && message.includes("match_type=flag")));
  assert.ok(messages.some((message) => message.includes('"sh -c"') && message.includes("match_type=flag")));
  assert.ok(messages.some((message) => message.includes('"bash -c"') && message.includes("match_type=flag")));
  assert.ok(messages.some((message) => message.includes('"node -e"') && message.includes("match_type=flag")));

  const telemetry = parseInlineTelemetry(run.stderr);
  assert.equal(telemetry.length, 7);
  for (const line of telemetry) {
    assert.match(line, /inline_script_violation/);
    assert.match(line, /file=".*inline-unsuppressed\.dot"/);
    assert.match(line, /node_id="[^"]+"/);
    assert.match(line, /node_label="[^"]+"/);
    assert.match(line, /match_type=(heredoc|flag)/);
    assert.match(line, /pattern="[^"]+"/);
  }
});

test("dot-lint inline marker suppresses only canonical line and emits skip telemetry", () => {
  const source = `digraph inline_suppressed {
  start [shape=Mdiamond]
  done [shape=Msquare]
  tool_ok [type="tool" label="Tool suppressed" output_key="out_tool_ok" governance="irreversible" prompt="# hatch:no-inline-script-ok\\npython3 - <<'PY'\\nprint('x')\\nPY"]
  assert_ok [type="assert" label="Assert suppressed" governance="reversible" prompt="# hatch:no-inline-script-ok\\npython - <<'PY'\\nprint('x')\\nPY"]
  manager_ok [type="stack.manager_loop" label="Manager suppressed" governance="irreversible" prompt="# hatch:no-inline-script-ok\\nnode -e \\\"console.log('x')\\\""]
  worktree_ok [type="agent.worktree" label="Worktree suppressed" repo="." branch="wave/test" governance="irreversible" prompt="# hatch:no-inline-script-ok\\nbash - <<'SH'\\necho hi\\nSH"]
  start -> tool_ok -> assert_ok -> manager_ok -> worktree_ok -> done
}`;

  const run = runDotLintSource({ name: "inline-suppressed", source });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.errors.length, 0, "marker suppresses both shell_metasyntax and declarative_policy");

  const policyTelemetry = parseToolPolicyTelemetry(run.stderr);
  assert.equal(policyTelemetry.length, 0, "marker suppresses declarative_policy telemetry");

  const telemetry = parseInlineTelemetry(run.stderr);
  assert.equal(telemetry.length, 4);
  for (const line of telemetry) {
    assert.match(line, /inline_script_skip/);
    assert.match(line, /reason=marker_present/);
  }
});

test("dot-lint inline marker is node-scoped and does not suppress neighboring nodes", () => {
  const source = `digraph inline_neighbor_scope {
  start [shape=Mdiamond]
  done [shape=Msquare]
  marked [type="tool" label="Marked" output_key="out_marked" governance="irreversible" prompt="# hatch:no-inline-script-ok\\npython3 - <<'PY'\\nprint('x')\\nPY"]
  neighbor [type="tool" label="Neighbor" output_key="out_neighbor" governance="irreversible" prompt="python3 - <<'PY'\\nprint('x')\\nPY"]
  start -> marked -> neighbor -> done
}`;

  const run = runDotLintSource({ name: "inline-neighbor-scope", source });
  assert.equal(run.status, 1, "neighbor node must still fail without its own marker");

  const inlineScriptErrors = run.errors.filter((diagnostic) => diagnostic.rule_id === "prompt.inline_script");
  assert.equal(inlineScriptErrors.length, 1);
  assert.equal(inlineScriptErrors[0].node, "neighbor");

  // Both nodes have actual inline scripts (heredoc), so hasInlineScripts is true for both,
  // suppressing declarative_policy on both. The difference: marker suppresses inline_script
  // on 'marked', but 'neighbor' still gets inline_script violation.
  const policyErrors = run.errors.filter((diagnostic) => diagnostic.rule_id === "tool.prompt.declarative_policy");
  assert.equal(policyErrors.length, 0, "hasInlineScripts suppresses declarative_policy on both nodes");

  const telemetry = parseInlineTelemetry(run.stderr);
  assert.equal(telemetry.length, 2);
  assert.ok(telemetry.some((line) => line.includes("inline_script_skip") && line.includes('node_id="marked"')));
  assert.ok(telemetry.some((line) => line.includes("inline_script_violation") && line.includes('node_id="neighbor"')));
});

test("dot-lint rejects non-canonical suppression marker spellings", () => {
  const source = `digraph inline_bad_marker {
  start [shape=Mdiamond]
  done [shape=Msquare]
  bad_marker [type="tool" label="Bad marker" output_key="out_bad_marker" governance="irreversible" prompt="# hatch:no-inline-script-okay\\npython3 - <<'PY'\\nprint('x')\\nPY"]
  start -> bad_marker -> done
}`;

  const run = runDotLintSource({ name: "inline-bad-marker", source });
  assert.equal(run.status, 1, "only canonical marker should suppress");

  const inlineScriptErrors = run.errors.filter((diagnostic) => diagnostic.rule_id === "prompt.inline_script");
  assert.equal(inlineScriptErrors.length, 1);

  // bad marker doesn't suppress inline_script, but hasInlineScripts is true
  // (the node has actual inline scripts), so declarative_policy is suppressed
  const policyErrors = run.errors.filter((diagnostic) => diagnostic.rule_id === "tool.prompt.declarative_policy");
  assert.equal(policyErrors.length, 0, "hasInlineScripts suppresses declarative_policy even with bad marker");

  const telemetry = parseInlineTelemetry(run.stderr);
  assert.equal(telemetry.length, 1);
  assert.match(telemetry[0], /inline_script_violation/);
});

test("dot-lint fails deterministically when inline-script ignore debt grows beyond baseline", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dot-lint-baseline-"));
  const baselinePath = join(tempDir, "baseline.json");
  writeFileSync(baselinePath, JSON.stringify({
    schema: "dot_inline_script_ignore_baseline/v1",
    markers: [],
  }, null, 2));

  // Use tracked fixture (debt enforcement requires git-tracked files via listTrackedDotFiles)
  const run = runDotLint([
    `${FIXTURES_DIR}/inline-script-debt.dot`,
    "--inline-script-baseline-file",
    baselinePath,
    "--compat-file", `${FIXTURES_DIR}/compat-empty.json`,
  ]);

  assert.equal(run.status, 1, "baseline growth must fail lint");
  const debtDiagnostics = run.errors.filter((diagnostic) => diagnostic.rule_id === "prompt.inline_script_ignore_debt");
  assert.equal(debtDiagnostics.length, 1);
  assert.equal(debtDiagnostics[0].node, "marked");

  const debtTelemetry = parseDebtTelemetry(run.stderr);
  assert.ok(debtTelemetry.some((line) => line.includes("inline_script_debt_violation_summary")));
  assert.ok(debtTelemetry.some((line) => line.includes("inline_script_debt_added") && line.includes('node_id="marked"')));
});

test("dot-lint baseline diff mode is dry-run and emits machine+human review output", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dot-lint-baseline-diff-"));
  const baselinePath = join(tempDir, "baseline.json");
  const seed = JSON.stringify({
    schema: "dot_inline_script_ignore_baseline/v1",
    markers: [],
  }, null, 2) + "\n";
  writeFileSync(baselinePath, seed);

  const run = runDotLint([
    "--inline-script-baseline-diff",
    "--inline-script-baseline-file",
    baselinePath,
  ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(Array.isArray(run.payload), false, "diff mode must emit report object payload");
  assert.equal(run.payload.schema, "dot_inline_script_ignore_baseline_diff/v1");
  assert.equal(run.payload.baseline_file, baselinePath.replace(/\\/g, "/"));
  // At least the tracked test fixture carries inline-script debt; production graphs may add more
  assert.ok(run.payload.summary.added >= 1, `expected at least 1 added marker, got ${run.payload.summary.added}`);
  assert.equal(run.payload.summary.removed, 0);
  assert.equal(Array.isArray(run.payload.per_file.added), true);

  const debtTelemetry = parseDebtTelemetry(run.stderr);
  assert.ok(debtTelemetry.some((line) => line.includes("inline_script_debt_diff_summary")));
  assert.ok(debtTelemetry.some((line) => line.includes("inline_script_debt_added")));

  const after = readFileSync(baselinePath, "utf8");
  assert.equal(after, seed, "dry-run diff must not mutate baseline artifact");
});

test("dot-lint baseline refresh writes deterministic baseline and subsequent diff is clean", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dot-lint-baseline-refresh-"));
  const baselinePath = join(tempDir, "baseline.json");

  const refreshRun = runDotLint([
    "--inline-script-baseline-refresh",
    "--inline-script-baseline-file",
    baselinePath,
  ]);

  assert.equal(refreshRun.status, 0, refreshRun.stderr || refreshRun.stdout);
  assert.equal(existsSync(baselinePath), true);

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.equal(baseline.schema, "dot_inline_script_ignore_baseline/v1");
  assert.equal(Array.isArray(baseline.markers), true);
  // At least the tracked test fixture carries inline-script debt; production graphs may add more
  assert.ok(baseline.markers.length >= 1, `expected at least 1 marker, got ${baseline.markers.length}`);
  for (const marker of baseline.markers) {
    assert.equal(typeof marker.file, "string");
    assert.equal(typeof marker.node_id, "string");
    assert.equal(typeof marker.node_label, "string");
    assert.equal(typeof marker.identity, "string");
    assert.match(marker.identity, /^[a-f0-9]{64}$/);
  }

  const diffRun = runDotLint([
    "--inline-script-baseline-diff",
    "--inline-script-baseline-file",
    baselinePath,
  ]);
  assert.equal(diffRun.status, 0, diffRun.stderr || diffRun.stdout);
  assert.equal(diffRun.payload.summary.added, 0);
  assert.equal(diffRun.payload.summary.removed, 0);
  assert.ok(diffRun.payload.summary.unchanged >= 1, `expected at least 1 unchanged marker, got ${diffRun.payload.summary.unchanged}`);
});

// ── Shell-unsafe arg lint rule ───────────────────────────────────────────────

test("shell_unsafe_arg: flags review_notes in single-quoted CLI arg", () => {
  const dot = writeTmpDot(`digraph g {
    start [shape=Mdiamond]
    a [type="tool" label="Test" output_key="x"
       prompt="node cli.mjs run --review-notes '\${review_notes}'" trust_domain="t" trust_role="t.tool"]
    exit [shape=Msquare]
    start -> a -> exit
  }`);
  const run = runDotLint([dot]);
  assert.equal(run.status, 1, "should fail");
  const shellUnsafe = run.diagnostics.filter(d => d.rule_id === "prompt.shell_unsafe_arg");
  assert.equal(shellUnsafe.length, 1);
  assert.match(shellUnsafe[0].message, /review_notes/);
});

test("shell_unsafe_arg: allows review_notes via base64 encoding", () => {
  const dot = writeTmpDot(`digraph g {
    start [shape=Mdiamond]
    a [type="tool" label="Test" output_key="x"
       prompt="node cli.mjs run --review-notes-b64 \\"$(printf '%s' \\"\${review_notes}\\" | base64)\\"" trust_domain="t" trust_role="t.tool"]
    exit [shape=Msquare]
    start -> a -> exit
  }`);
  const run = runDotLint([dot]);
  const shellUnsafe = run.diagnostics.filter(d => d.rule_id === "prompt.shell_unsafe_arg");
  assert.equal(shellUnsafe.length, 0, "base64-encoded args should not trigger shell_unsafe_arg");
});

test("shell_unsafe_arg: flags issue_title but not issue_number", () => {
  const dot = writeTmpDot(`digraph g {
    start [shape=Mdiamond]
    a [type="tool" label="Test" output_key="x"
       prompt="node cli.mjs run --issue '\${issue_number}' --title '\${issue_title}'" trust_domain="t" trust_role="t.tool"]
    exit [shape=Msquare]
    start -> a -> exit
  }`);
  const run = runDotLint([dot]);
  const shellUnsafe = run.diagnostics.filter(d => d.rule_id === "prompt.shell_unsafe_arg");
  assert.equal(shellUnsafe.length, 1, "only issue_title should be flagged");
  assert.match(shellUnsafe[0].message, /issue_title/);
});
