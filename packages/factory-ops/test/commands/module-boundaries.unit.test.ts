import assert from "node:assert/strict";
import test from "node:test";

import { analyzeModuleBoundaries } from "../../../../scripts/check-module-boundaries.ts";

function mockReadFile(contentMap) {
  return (filePath) => {
    if (contentMap[filePath] === undefined) throw new Error("not found");
    return contentMap[filePath];
  };
}

test("rejects apps/hatch importing from factory-ops via relative path", () => {
  const files = ["apps/hatch/src/pipeline/engine.ts"];
  const readFile = mockReadFile({
    "apps/hatch/src/pipeline/engine.ts":
      'import { foo } from "../../../../packages/factory-ops/src/commands/bar.mjs";',
  });
  const result = analyzeModuleBoundaries({ files, readFile });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].rule_id, "hatch_imports_ops");
});

test("rejects apps/hatch importing from factory-ops via package name", () => {
  const files = ["apps/hatch/src/cli.ts"];
  const readFile = mockReadFile({
    "apps/hatch/src/cli.ts":
      'import { wave } from "@hatch/factory-ops/src/commands/wave.mjs";',
  });
  const result = analyzeModuleBoundaries({ files, readFile });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].rule_id, "hatch_imports_ops");
});

test("rejects factory-ops importing from apps/hatch/src", () => {
  const files = ["packages/factory-ops/src/commands/status.mjs"];
  const readFile = mockReadFile({
    "packages/factory-ops/src/commands/status.mjs":
      'import { Engine } from "../../../../apps/hatch/src/pipeline/engine.ts";',
  });
  const result = analyzeModuleBoundaries({ files, readFile });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].rule_id, "ops_imports_hatch_src");
});

test("rejects factory-telemetry importing from factory-ops", () => {
  const files = ["packages/factory-telemetry/src/bus.ts"];
  const readFile = mockReadFile({
    "packages/factory-telemetry/src/bus.ts":
      'import { x } from "../../factory-ops/src/lib/util.mjs";',
  });
  const result = analyzeModuleBoundaries({ files, readFile });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].rule_id, "telemetry_imports_ops");
});

test("rejects factory-telemetry importing from apps/hatch", () => {
  const files = ["packages/factory-telemetry/src/trace.ts"];
  const readFile = mockReadFile({
    "packages/factory-telemetry/src/trace.ts":
      'import { run } from "../../../apps/hatch/src/pipeline/run.ts";',
  });
  const result = analyzeModuleBoundaries({ files, readFile });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].rule_id, "telemetry_imports_hatch");
});

test("allows legitimate same-package imports", () => {
  const files = ["apps/hatch/src/pipeline/handler/tool.ts"];
  const readFile = mockReadFile({
    "apps/hatch/src/pipeline/handler/tool.ts":
      'import { Engine } from "../engine.ts";\nimport { EventBus } from "@recallnet/factory-telemetry";',
  });
  const result = analyzeModuleBoundaries({ files, readFile });
  assert.equal(result.violations.length, 0);
});

test("allows factory-ops importing from factory-telemetry", () => {
  const files = ["packages/factory-ops/src/lib/trace.mjs"];
  const readFile = mockReadFile({
    "packages/factory-ops/src/lib/trace.mjs":
      'import { EventBus } from "@recallnet/factory-telemetry";',
  });
  const result = analyzeModuleBoundaries({ files, readFile });
  assert.equal(result.violations.length, 0);
});

test("exempts contract test files from boundary checks", () => {
  const files = ["apps/hatch/src/pipeline/reviewer-prompt-contract.contract.test.ts"];
  const readFile = mockReadFile({
    "apps/hatch/src/pipeline/reviewer-prompt-contract.contract.test.ts":
      'import { REVIEWER_CONTEXT_REQUIRED_KEYS } from "../../../../packages/factory-ops/src/commands/reviewer-context-contract.ts";',
  });
  const result = analyzeModuleBoundaries({ files, readFile });
  assert.equal(result.violations.length, 0);
});

test("skips non-source files", () => {
  const files = ["apps/hatch/src/pipeline/README.md"];
  const readFile = mockReadFile({
    "apps/hatch/src/pipeline/README.md": "import factory-ops everywhere",
  });
  const result = analyzeModuleBoundaries({ files, readFile });
  assert.equal(result.checked, 0);
  assert.equal(result.violations.length, 0);
});

test("handles require() imports", () => {
  const files = ["apps/hatch/src/legacy.ts"];
  const readFile = mockReadFile({
    "apps/hatch/src/legacy.ts":
      'const ops = require("@hatch/factory-ops/src/lib/util.mjs");',
  });
  const result = analyzeModuleBoundaries({ files, readFile });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].rule_id, "hatch_imports_ops");
});

test("handles dynamic import()", () => {
  const files = ["apps/hatch/src/lazy.ts"];
  const readFile = mockReadFile({
    "apps/hatch/src/lazy.ts":
      'const mod = await import("../../../../packages/factory-ops/src/commands/foo.mjs");',
  });
  const result = analyzeModuleBoundaries({ files, readFile });
  assert.equal(result.violations.length, 1);
});

test("reports multiple violations in one file", () => {
  const files = ["apps/hatch/src/bad.ts"];
  const readFile = mockReadFile({
    "apps/hatch/src/bad.ts":
      'import { a } from "../../../../packages/factory-ops/src/a.mjs";\nimport { b } from "../../../../packages/factory-ops/src/b.mjs";',
  });
  const result = analyzeModuleBoundaries({ files, readFile });
  assert.equal(result.violations.length, 2);
});

test("returns zero violations for empty input", () => {
  const result = analyzeModuleBoundaries({ files: [], readFile: () => "" });
  assert.equal(result.checked, 0);
  assert.equal(result.violations.length, 0);
});
