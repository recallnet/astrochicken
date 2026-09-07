import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { waveComplexityEstimate, COMPLEXITY_ESTIMATE_FALLBACK } from "../src/commands/wave-complexity-estimate.ts";

test("waveComplexityEstimate returns structured telemetry on success", () => {
  const binDir = mkdtempSync(join(tmpdir(), "wave-complexity-success-"));
  const hatchPath = join(binDir, "hatch");
  writeFileSync(
    hatchPath,
    "#!/bin/sh\ncat <<'JSON'\n{\"complexity_class\":\"medium\",\"signals\":{\"diff_size\":\"medium\"},\"reason\":\"class=medium;score=3\",\"otel_dimension_key\":\"hatch.complexity.class\"}\nJSON\n",
    "utf8",
  );
  chmodSync(hatchPath, 0o755);

  const priorPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${priorPath}`;
  try {
    const out = waveComplexityEstimate({
      issueTitle: "Refactor",
      estimatedLinesAdded: "23",
      changedFiles: "[\"src/a.ts\"]",
    });
    assert.equal(out.ok, true);
    assert.equal(out.complexity_class, "medium");
    assert.equal(out.complexity_otel_key, "hatch.complexity.class");
    assert.equal(out.telemetry["hatch.complexity.class"], "medium");
    assert.equal(out.telemetry.complexity_reason, "class=medium;score=3");
  } finally {
    process.env.PATH = priorPath;
  }
});

test("waveComplexityEstimate flattens structured estimator signal objects into deterministic telemetry", () => {
  const binDir = mkdtempSync(join(tmpdir(), "wave-complexity-structured-signals-"));
  const hatchPath = join(binDir, "hatch");
  writeFileSync(
    hatchPath,
    "#!/bin/sh\ncat <<'JSON'\n{\"complexity_class\":\"medium\",\"signals\":{\"diff_size\":{\"value\":\"medium\",\"reason\":\"line_change_total=120\",\"score\":1,\"_unknown\":false}},\"reason\":\"class=medium;score=3\",\"otel_dimension_key\":\"hatch.complexity.class\"}\nJSON\n",
    "utf8",
  );
  chmodSync(hatchPath, 0o755);

  const priorPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${priorPath}`;
  try {
    const out = waveComplexityEstimate({ issueTitle: "Refactor parser" });
    assert.equal(out.ok, true);
    assert.equal(out.complexity_class, "medium");
    assert.equal(
      out.telemetry.complexity_signals,
      "{\"diff_size\":\"medium\",\"diff_size.reason\":\"line_change_total=120\",\"diff_size.score\":\"1\",\"diff_size._unknown\":\"false\"}",
    );
  } finally {
    process.env.PATH = priorPath;
  }
});

test("waveComplexityEstimate forwards all optional estimate inputs", () => {
  const binDir = mkdtempSync(join(tmpdir(), "wave-complexity-flags-"));
  const hatchPath = join(binDir, "hatch");
  const argsPath = join(binDir, "args.txt");
  writeFileSync(
    hatchPath,
    `#!/bin/sh\nprintf '%s' "$*" > "${argsPath}"\ncat <<'JSON'\n{\"complexity_class\":\"low\",\"signals\":{},\"reason\":\"class=low;score=1\",\"otel_dimension_key\":\"hatch.complexity.class\"}\nJSON\n`,
    "utf8",
  );
  chmodSync(hatchPath, 0o755);

  const priorPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${priorPath}`;
  try {
    const out = waveComplexityEstimate({
      input: "{\"x\":1}",
      issueTitle: "Refactor",
      issueBody: "Body",
      changedFiles: "[\"a.ts\"]",
      estimatedLinesAdded: "10",
      estimatedLinesDeleted: "4",
      estimatedFileCount: "2",
      dependencyCount: "1",
      blockedByCount: "3",
      blocksCount: "5",
      qaCommand: "npm test",
    });
    assert.equal(out.ok, true);
    assert.equal(out.complexity_class, "low");

    const args = readFileSync(argsPath, "utf8");
    assert.match(args, /--input/);
    assert.match(args, /--issue-title/);
    assert.match(args, /--issue-body/);
    assert.match(args, /--changed-files/);
    assert.match(args, /--estimated-lines-added/);
    assert.match(args, /--estimated-lines-deleted/);
    assert.match(args, /--estimated-file-count/);
    assert.match(args, /--dependency-count/);
    assert.match(args, /--blocked-by-count/);
    assert.match(args, /--blocks-count/);
    assert.match(args, /--qa-command/);
  } finally {
    process.env.PATH = priorPath;
  }
});

test("waveComplexityEstimate preserves telemetry payload from hatch complexity estimate output", () => {
  const binDir = mkdtempSync(join(tmpdir(), "wave-complexity-telemetry-"));
  const hatchPath = join(binDir, "hatch");
  writeFileSync(
    hatchPath,
    "#!/bin/sh\ncat <<'JSON'\n{\"complexity_class\":\"high\",\"signals\":{\"diff_size\":\"large\"},\"reason\":\"class=high;score=6\",\"otel_dimension_key\":\"hatch.complexity.class\",\"telemetry\":{\"complexity_class\":\"high\",\"complexity_signals\":\"{\\\"diff_size\\\":\\\"large\\\"}\",\"complexity_reason\":\"class=high;score=6\",\"complexity_otel_key\":\"hatch.complexity.class\",\"hatch.complexity.class\":\"high\"}}\nJSON\n",
    "utf8",
  );
  chmodSync(hatchPath, 0o755);

  const priorPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${priorPath}`;
  try {
    const out = waveComplexityEstimate({ issueTitle: "Deploy migration" });
    assert.equal(out.ok, true);
    assert.equal(out.complexity_class, "high");
    assert.equal(out.complexity_reason, "class=high;score=6");
    assert.equal(out.telemetry.complexity_signals, "{\"diff_size\":\"large\"}");
    assert.equal(out.telemetry["hatch.complexity.class"], "high");
  } finally {
    process.env.PATH = priorPath;
  }
});

test("waveComplexityEstimate derives class/reason from telemetry map when top-level fields are missing", () => {
  const binDir = mkdtempSync(join(tmpdir(), "wave-complexity-telemetry-derived-"));
  const hatchPath = join(binDir, "hatch");
  writeFileSync(
    hatchPath,
    "#!/bin/sh\ncat <<'JSON'\n{\"telemetry\":{\"complexity_class\":\"medium\",\"complexity_reason\":\"class=medium;score=4\",\"complexity_otel_key\":\"hatch.complexity.class\",\"hatch.complexity.class\":\"medium\",\"complexity_signals\":\"{\\\"diff_size\\\":\\\"medium\\\"}\"}}\nJSON\n",
    "utf8",
  );
  chmodSync(hatchPath, 0o755);

  const priorPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${priorPath}`;
  try {
    const out = waveComplexityEstimate({ issueTitle: "Telemetry only" });
    assert.equal(out.ok, true);
    assert.equal(out.complexity_class, "medium");
    assert.equal(out.complexity_reason, "class=medium;score=4");
    assert.equal(out.complexity_otel_key, "hatch.complexity.class");
    assert.equal(out.telemetry["hatch.complexity.class"], "medium");
  } finally {
    process.env.PATH = priorPath;
  }
});

test("waveComplexityEstimate handles non-JSON hatch output deterministically", () => {
  const binDir = mkdtempSync(join(tmpdir(), "wave-complexity-non-json-"));
  const hatchPath = join(binDir, "hatch");
  writeFileSync(hatchPath, "#!/bin/sh\necho 'not-json'\n", "utf8");
  chmodSync(hatchPath, 0o755);

  const priorPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${priorPath}`;
  try {
    const out = waveComplexityEstimate({ issueTitle: "Refactor" });
    assert.equal(out.ok, true);
    assert.equal(out.complexity_class, "high");
    assert.equal(out.complexity_reason, "class=high;reason=missing_reason");
    assert.equal(out.complexity_otel_key, "hatch.complexity.class");
    assert.equal(out.telemetry["hatch.complexity.class"], "high");
  } finally {
    process.env.PATH = priorPath;
  }
});

test("waveComplexityEstimate fails closed to high on hatch failure", () => {
  const binDir = mkdtempSync(join(tmpdir(), "wave-complexity-fail-"));
  const hatchPath = join(binDir, "hatch");
  writeFileSync(hatchPath, "#!/bin/sh\necho 'boom' 1>&2\nexit 12\n", "utf8");
  chmodSync(hatchPath, 0o755);

  const priorPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${priorPath}`;
  try {
    const out = waveComplexityEstimate({ issueTitle: "Refactor" });
    assert.equal(out.ok, false);
    assert.equal(out.exit_code, "12");
    assert.equal(out.complexity_class, "high");
    assert.equal(out.complexity_reason, "class=high;reason=complexity_estimate_failed");
    assert.equal(out.complexity_otel_key, COMPLEXITY_ESTIMATE_FALLBACK.complexity_otel_key);
    assert.equal(out.telemetry[COMPLEXITY_ESTIMATE_FALLBACK.complexity_otel_key], "high");
  } finally {
    process.env.PATH = priorPath;
  }
});
