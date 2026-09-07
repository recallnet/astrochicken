import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  gh,
  ghJson,
  ghJsonWithOptions,
  ghJsonPaginated,
  ghOrThrow,
  ghOrThrowWithOptions,
  parseJson,
  parseJsonLoose,
  readJsonFile,
  toCommandList,
  toEpochMs,
  toPlainObject,
  toPositiveInt,
  trim,
} from "../../src/lib/cli-helpers.ts";

function withTempPath(pathValue, fn) {
  const originalPath = process.env.PATH;
  process.env.PATH = pathValue;
  try {
    return fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

function withFakeGh(script, fn) {
  const dir = mkdtempSync(join(tmpdir(), "cli-helpers-gh-"));
  const ghPath = join(dir, "gh");
  writeFileSync(ghPath, `#!/bin/sh\n${script}\n`, "utf8");
  chmodSync(ghPath, 0o755);
  try {
    return withTempPath(dir, fn);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("gh returns non-throwing failure object for non-zero exit", () => {
  const result = withFakeGh(
    "echo stdout-nonzero\necho stderr-nonzero 1>&2\nexit 2",
    () => gh(["issue", "list"]),
  );
  assert.equal(result.ok, false);
  assert.equal(typeof result.stdout, "string");
  assert.equal(typeof result.stderr, "string");
  assert.match(result.stdout, /stdout-nonzero/);
  assert.match(result.stderr, /stderr-nonzero/);
});

test("gh returns non-throwing failure object when gh binary is missing", () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "cli-helpers-no-gh-"));
  try {
    const result = withTempPath(emptyDir, () => gh(["issue", "list"]));
    assert.equal(result.ok, false);
    assert.equal(typeof result.stdout, "string");
    assert.equal(typeof result.stderr, "string");
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("gh returns success object with stdout string", () => {
  const result = withFakeGh(
    "echo success-output\nexit 0",
    () => gh(["api", "repos/example/repo"]),
  );
  assert.equal(result.ok, true);
  assert.equal(typeof result.stdout, "string");
  assert.match(result.stdout, /success-output/);
  assert.equal(typeof result.stderr, "string");
});

test("ghOrThrow throws with stderr when gh exits non-zero", () => {
  assert.throws(
    () => withFakeGh("echo explicit-failure 1>&2\nexit 1", () => ghOrThrow(["issue", "list"])),
    /explicit-failure/,
  );
});

test("ghOrThrow returns result object on success", () => {
  const result = withFakeGh("echo all-good\nexit 0", () => ghOrThrow(["issue", "list"]));
  assert.equal(result.ok, true);
  assert.match(result.stdout, /all-good/);
});

test("ghJson returns fallback when gh exits non-zero", () => {
  const fallback = { fallback: true };
  const out = withFakeGh("echo bad 1>&2\nexit 1", () => ghJson(["api", "x"], fallback));
  assert.equal(out, fallback);
});

test("ghJson returns fallback when stdout is invalid JSON", () => {
  const fallback = { invalid: true };
  const out = withFakeGh("echo '{bad-json'\nexit 0", () => ghJson(["api", "x"], fallback));
  assert.equal(out, fallback);
});

test("ghJson parses valid JSON payload", () => {
  const out = withFakeGh("echo '{\"ok\":true,\"count\":2}'\nexit 0", () => ghJson(["api", "x"], {}));
  assert.deepEqual(out, { ok: true, count: 2 });
});

test("ghJsonPaginated parses multi-page output using ][ normalization", () => {
  const out = withFakeGh(
    "echo '[{\"page\":1}]'\necho '[{\"page\":2}]'\nexit 0",
    () => ghJsonPaginated("repos/example/repo/issues?per_page=100", []),
  );
  assert.deepEqual(out, [{ page: 1 }, { page: 2 }]);
});

test("parseJson returns fallback for malformed JSON", () => {
  assert.equal(parseJson("{bad", 42), 42);
});

test("parseJson parses valid JSON", () => {
  assert.deepEqual(parseJson('{"a":1}', {}), { a: 1 });
});

test("trim handles null/undefined/number/string", () => {
  assert.equal(trim(null), "");
  assert.equal(trim(undefined), "");
  assert.equal(trim(123), "123");
  assert.equal(trim("  hello  "), "hello");
});

test("toEpochMs returns ms for valid ISO and NaN for invalid", () => {
  const valid = toEpochMs("2026-01-01T00:00:00.000Z");
  assert.equal(typeof valid, "number");
  assert.equal(Number.isNaN(valid), false);

  const invalid = toEpochMs("not-a-date");
  assert.equal(Number.isNaN(invalid), true);
});

test("toPositiveInt parses and validates numbers", () => {
  assert.equal(toPositiveInt("7"), 7);
  assert.equal(toPositiveInt("-7"), 0);
  assert.equal(toPositiveInt("0"), 0);
  assert.equal(toPositiveInt("9.8"), 9);
  assert.equal(toPositiveInt("NaN"), 0);
});

test("toPlainObject returns spread copy for plain objects", () => {
  const source = { a: 1 };
  const out = toPlainObject(source);
  assert.deepEqual(out, { a: 1 });
  assert.notEqual(out, source);

  out.a = 2;
  assert.equal(source.a, 1);
});

test("toPlainObject returns empty object for non-plain values", () => {
  assert.deepEqual(toPlainObject([1, 2, 3]), {});
  assert.deepEqual(toPlainObject(null), {});
  assert.deepEqual(toPlainObject("text"), {});
});

test("toCommandList trims and filters command arrays", () => {
  assert.deepEqual(toCommandList([" echo 1 ", "", "   ", "echo 2"]), ["echo 1", "echo 2"]);
  assert.deepEqual(toCommandList("not-array"), []);
});

test("re-exported parseJsonLoose and readJsonFile are available", () => {
  assert.deepEqual(parseJsonLoose('{"ok":true}', {}), { ok: true });
  assert.deepEqual(parseJsonLoose("", { fallback: true }), { fallback: true });

  const dir = mkdtempSync(join(tmpdir(), "cli-helpers-io-"));
  const jsonFile = join(dir, "sample.json");
  try {
    writeFileSync(jsonFile, '{"value":5}\n', "utf8");
    assert.deepEqual(readJsonFile(jsonFile, {}), { value: 5 });
    assert.deepEqual(readJsonFile(join(dir, "missing.json"), { fallback: 1 }), { fallback: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
