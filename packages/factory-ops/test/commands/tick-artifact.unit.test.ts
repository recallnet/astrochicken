import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  stableStringify,
  writeTickArtifact,
} from "../../src/commands/tick-artifact.ts";

describe("stableStringify", () => {
  it("sorts keys alphabetically", () => {
    const result = stableStringify({ z: 1, a: 2 });
    assert.equal(result, '{\n  "a": 2,\n  "z": 1\n}');
  });

  it("sorts nested objects recursively", () => {
    const result = stableStringify({ z: { d: 3, b: 4 }, a: 1 });
    assert.equal(
      result,
      '{\n  "a": 1,\n  "z": {\n    "b": 4,\n    "d": 3\n  }\n}',
    );
  });

  it("preserves array order (does not sort elements)", () => {
    const result = stableStringify({ items: [3, 1, 2] });
    assert.equal(result, '{\n  "items": [\n    3,\n    1,\n    2\n  ]\n}');
  });

  it("passes through primitives unchanged", () => {
    assert.equal(stableStringify("hello"), '"hello"');
    assert.equal(stableStringify(42), "42");
    assert.equal(stableStringify(true), "true");
    assert.equal(stableStringify(null), "null");
  });

  it("produces deterministic output regardless of key insertion order", () => {
    const obj1 = { c: 1, a: 2, b: 3 };
    const obj2 = { a: 2, b: 3, c: 1 };
    const obj3 = { b: 3, c: 1, a: 2 };
    assert.equal(stableStringify(obj1), stableStringify(obj2));
    assert.equal(stableStringify(obj2), stableStringify(obj3));
  });
});

describe("writeTickArtifact", () => {
  function makeTmpRunsDir() {
    return mkdtempSync(join(tmpdir(), "tick-artifact-test-"));
  }

  it("returns empty string when runId is missing", () => {
    const result = writeTickArtifact({ runId: "", tick: {} });
    assert.equal(result, "");
  });

  it("creates tick-000001.json on first write", () => {
    const runsDir = makeTmpRunsDir();
    const path = writeTickArtifact({
      runId: "run-1",
      runsDir,
      tick: { status: "ok" },
    });
    assert.ok(path.endsWith("tick-000001.json"));
  });

  it("auto-increments to tick-000002.json on second write", () => {
    const runsDir = makeTmpRunsDir();
    const opts = { runId: "run-2", runsDir, tick: { n: 1 } };
    writeTickArtifact(opts);
    const path2 = writeTickArtifact({ ...opts, tick: { n: 2 } });
    assert.ok(path2.endsWith("tick-000002.json"));
  });

  it("writes stable-stringified tick content with trailing newline", () => {
    const runsDir = makeTmpRunsDir();
    const tick = { z: 1, a: 2 };
    const path = writeTickArtifact({ runId: "run-3", runsDir, tick });
    const content = readFileSync(path, "utf8");
    assert.equal(content, stableStringify(tick) + "\n");
  });

  it("creates parent directories recursively", () => {
    const runsDir = makeTmpRunsDir();
    const path = writeTickArtifact({
      runId: "deep/nested/run",
      runsDir,
      tick: { ok: true },
    });
    assert.ok(path.includes("deep/nested/run/ticks/tick-000001.json"));
    // File should exist and be readable
    const content = readFileSync(path, "utf8");
    assert.ok(content.length > 0);
  });
});
