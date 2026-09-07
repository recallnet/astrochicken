import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { listActiveIntentGraphPaths } from "../../src/lib/active-graphs.ts";

const HATCH_PARSE_ARTIFACT = resolve("apps/hatch/dist/pipeline/parse.js");
const DOT_LINT_SCRIPT = resolve("scripts/dot-lint.mjs");
const COMPAT_EMPTY = resolve("scripts/test/fixtures/dot-lint/compat-empty.json");

let ensuredHatchBuild = false;

function ensureHatchBuild() {
  if (ensuredHatchBuild) return;
  if (!existsSync(HATCH_PARSE_ARTIFACT)) {
    const build = spawnSync("pnpm", ["--filter", "hatch", "build"], {
      encoding: "utf8",
    });
    assert.equal(build.status, 0, `hatch build failed: ${build.stderr || build.stdout}`);
  }
  ensuredHatchBuild = true;
}

function parseTelemetry(stderr) {
  return String(stderr || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[dot-lint] inline_script_"));
}

function runDotLint(args) {
  ensureHatchBuild();
  const run = spawnSync("node", [DOT_LINT_SCRIPT, ...args], {
    encoding: "utf8",
  });

  const stdout = String(run.stdout || "").trim();
  const diagnostics = stdout ? JSON.parse(stdout) : [];
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  return {
    ...run,
    diagnostics,
    errors,
    warnings,
    telemetry: parseTelemetry(run.stderr),
  };
}

function runDotLintSource(name, source) {
  const tempDir = mkdtempSync(join(tmpdir(), "inline-script-lint-"));
  const dotPath = join(tempDir, `${name}.dot`);
  writeFileSync(dotPath, source, "utf8");
  return runDotLint([dotPath, "--compat-file", COMPAT_EMPTY]);
}

function buildSingleNodeDot({ nodeId, nodeType, prompt, extraAttrs = "" }) {
  const normalizedNodeId = String(nodeId || "node_case");
  const baseAttrs = [`label="${normalizedNodeId}"`];

  if (nodeType === "tool") {
    baseAttrs.push("output_key=\"tool_output\"");
    baseAttrs.push("governance=\"irreversible\"");
  }

  if (nodeType === "stack.manager_loop" || nodeType === "agent.worktree" || nodeType === "agent.kw") {
    baseAttrs.push("governance=\"irreversible\"");
  }

  const terminalEdge = nodeType === "tool"
    ? `${normalizedNodeId} -> done [condition="tool_output=true"]`
    : `${normalizedNodeId} -> done`;

  return `digraph ${normalizedNodeId} {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  ${normalizedNodeId} [type="${nodeType}" ${baseAttrs.join(" ")} ${extraAttrs}prompt="${prompt}"]\n  start -> ${normalizedNodeId}\n  ${terminalEdge}\n}`;
}

test("active production graphs have no unsuppressed inline executable patterns", () => {
  const run = runDotLint([
    ...listActiveIntentGraphPaths(),
    "--compat-file",
    COMPAT_EMPTY,
  ]);

  // Guard against false-pass: if dot-lint exits non-zero, it must still emit structured diagnostics.
  assert.ok(
    run.status === 0 || run.errors.length > 0,
    `dot-lint exited non-zero without machine-readable diagnostics: ${run.stderr || run.stdout}`,
  );
  const parserErrors = run.errors.filter((diagnostic) => diagnostic.rule_id === "parser.syntax");
  assert.deepEqual(parserErrors, [], run.stderr || run.stdout);

  const inlineDiagnostics = run.diagnostics.filter((diagnostic) => diagnostic.rule_id === "prompt.inline_script");
  assert.deepEqual(inlineDiagnostics, [], run.stderr || run.stdout);
});

const MATRIX_CASES = [
  {
    name: "tool-heredoc-unsuppressed",
    nodeType: "tool",
    prompt: "python3 - <<'PY'\\nprint('x')\\nPY",
    suppressed: false,
  },
  {
    name: "tool-heredoc-suppressed",
    nodeType: "tool",
    prompt: "# hatch:no-inline-script-ok\\npython3 - <<'PY'\\nprint('x')\\nPY",
    suppressed: true,
  },
  {
    name: "assert-heredoc-unsuppressed",
    nodeType: "assert",
    prompt: "python - <<'PY'\\nprint('x')\\nPY",
    suppressed: false,
  },
  {
    name: "assert-heredoc-suppressed",
    nodeType: "assert",
    prompt: "# hatch:no-inline-script-ok\\npython - <<'PY'\\nprint('x')\\nPY",
    suppressed: true,
  },
  {
    name: "manager-node-e-unsuppressed",
    nodeType: "stack.manager_loop",
    prompt: "Run this command: node -e \\\"console.log('x')\\\"",
    suppressed: false,
  },
  {
    name: "manager-node-e-suppressed",
    nodeType: "stack.manager_loop",
    prompt: "# hatch:no-inline-script-ok\\nnode -e \\\"console.log('x')\\\"",
    suppressed: true,
  },
  {
    name: "worktree-heredoc-unsuppressed",
    nodeType: "agent.worktree",
    extraAttrs: 'repo="." branch="wave/test" ',
    prompt: "bash - <<'SH'\\necho hi\\nSH",
    suppressed: false,
  },
  {
    name: "worktree-heredoc-suppressed",
    nodeType: "agent.worktree",
    extraAttrs: 'repo="." branch="wave/test" ',
    prompt: "# hatch:no-inline-script-ok\\nbash - <<'SH'\\necho hi\\nSH",
    suppressed: true,
  },
];

for (const testCase of MATRIX_CASES) {
  test(`inline-script matrix: ${testCase.name}`, () => {
    const source = buildSingleNodeDot({
      ...testCase,
      nodeId: testCase.name.replace(/[^A-Za-z0-9_]+/g, "_"),
    });
    const run = runDotLintSource(testCase.name, source);
    const inlineScriptErrors = run.errors.filter((diagnostic) => diagnostic.rule_id === "prompt.inline_script");
    const policyErrors = run.errors.filter((diagnostic) => diagnostic.rule_id === "tool.prompt.declarative_policy");

    if (testCase.suppressed) {
      // The marker suppresses inline_script, shell_metasyntax, AND declarative_policy
      assert.equal(run.status, 0, run.stderr || run.stdout);
      assert.deepEqual(inlineScriptErrors, []);
      assert.equal(policyErrors.length, 0, "marker suppresses declarative_policy");
      assert.deepEqual(run.errors, []);
      assert.equal(run.telemetry.length, 1);
      assert.match(run.telemetry[0], /inline_script_skip/);
      assert.match(run.telemetry[0], /reason=marker_present/);
    } else {
      // hasInlineScripts=true suppresses declarative_policy even without marker
      assert.equal(run.status, 1, "unsuppressed inline script should fail");
      assert.equal(inlineScriptErrors.length, 1);
      assert.equal(inlineScriptErrors[0].rule_id, "prompt.inline_script");
      assert.equal(policyErrors.length, 0, "hasInlineScripts suppresses declarative_policy");
      assert.equal(run.telemetry.length, 1);
      assert.match(run.telemetry[0], /inline_script_violation/);
    }
  });
}

test("suppression marker is node-scoped and does not suppress neighboring node", () => {
  const source = `digraph neighbor_scope {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  marked [type="tool" label="Marked" output_key="out_marked" governance="irreversible" prompt="# hatch:no-inline-script-ok\\npython3 - <<'PY'\\nprint('x')\\nPY"]\n  neighbor [type="tool" label="Neighbor" output_key="out_neighbor" governance="irreversible" prompt="python3 - <<'PY'\\nprint('x')\\nPY"]\n  start -> marked -> neighbor -> done\n}`;

  const run = runDotLintSource("neighbor-scope", source);
  assert.equal(run.status, 1, "neighbor node without marker must still fail");
  const inlineScriptErrors = run.errors.filter((diagnostic) => diagnostic.rule_id === "prompt.inline_script");
  assert.equal(inlineScriptErrors.length, 1);
  assert.equal(inlineScriptErrors[0].node, "neighbor");

  // Both nodes have actual inline scripts (heredoc), so hasInlineScripts is true for both,
  // suppressing declarative_policy on both. The marker additionally suppresses inline_script
  // on 'marked', but 'neighbor' still gets the inline_script violation.
  const policyErrors = run.errors.filter((diagnostic) => diagnostic.rule_id === "tool.prompt.declarative_policy");
  assert.equal(policyErrors.length, 0, "hasInlineScripts suppresses declarative_policy on both nodes");

  assert.equal(run.telemetry.length, 2);
  assert.ok(run.telemetry.some((line) => line.includes("inline_script_skip") && line.includes('node_id="marked"')));
  assert.ok(run.telemetry.some((line) => line.includes("inline_script_violation") && line.includes('node_id="neighbor"')));
});
