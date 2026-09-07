import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  resolveDefault,
  resolveFactoryConfigValue,
  resolveBoolean,
  normalizeApproved,
  normalizeDecision,
  incrementCounter,
  countJsonItems,
  stripMarkdownJsonFences,
  isPlainObject,
  slugify,
} from "../src/primitives.ts";

describe("resolveDefault", () => {
  it("returns value when non-empty", () => {
    assert.equal(resolveDefault("hello", "fallback"), "hello");
  });

  it("returns fallback when value is empty", () => {
    assert.equal(resolveDefault("", "fallback"), "fallback");
    assert.equal(resolveDefault(null, "fallback"), "fallback");
  });

  it("trims whitespace", () => {
    assert.equal(resolveDefault("  hello  ", ""), "hello");
  });
});

describe("resolveFactoryConfigValue", () => {
  let tmpDir;

  it("reads a top-level key from config", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "fc-test-"));
    const configPath = join(tmpDir, "factory.config.json");
    writeFileSync(configPath, JSON.stringify({ factory_repo: "org/repo", max: 5 }));

    assert.equal(
      resolveFactoryConfigValue({ key: "factory_repo", configPath }),
      "org/repo"
    );
    assert.equal(
      resolveFactoryConfigValue({ key: "max", configPath }),
      "5"
    );
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("supports dot-notation for nested keys", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "fc-test-"));
    const configPath = join(tmpDir, "factory.config.json");
    writeFileSync(configPath, JSON.stringify({ models: { primary: "gpt-4" } }));

    assert.equal(
      resolveFactoryConfigValue({ key: "models.primary", configPath }),
      "gpt-4"
    );
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns fallback for missing key", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "fc-test-"));
    const configPath = join(tmpDir, "factory.config.json");
    writeFileSync(configPath, JSON.stringify({ a: 1 }));

    assert.equal(
      resolveFactoryConfigValue({ key: "missing", fallback: "default", configPath }),
      "default"
    );
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns fallback for missing file", () => {
    assert.equal(
      resolveFactoryConfigValue({ key: "x", fallback: "fb", configPath: "/nonexistent" }),
      "fb"
    );
  });

  it("returns fallback for empty key", () => {
    assert.equal(resolveFactoryConfigValue({ key: "", fallback: "fb" }), "fb");
  });
});

describe("resolveBoolean", () => {
  it("recognizes truthy values", () => {
    assert.equal(resolveBoolean("true"), "true");
    assert.equal(resolveBoolean("1"), "true");
    assert.equal(resolveBoolean("yes"), "true");
    assert.equal(resolveBoolean("y"), "true");
    assert.equal(resolveBoolean("on"), "true");
  });

  it("returns false for other values", () => {
    assert.equal(resolveBoolean("false"), "false");
    assert.equal(resolveBoolean("no"), "false");
    assert.equal(resolveBoolean("0"), "false");
  });

  it("uses fallback for empty", () => {
    assert.equal(resolveBoolean("", true), "true");
    assert.equal(resolveBoolean("", false), "false");
  });
});

describe("normalizeApproved", () => {
  it("returns true for approval values", () => {
    assert.equal(normalizeApproved("true"), "true");
    assert.equal(normalizeApproved("1"), "true");
    assert.equal(normalizeApproved("yes"), "true");
  });

  it("returns false for other values", () => {
    assert.equal(normalizeApproved("false"), "false");
    assert.equal(normalizeApproved("no"), "false");
    assert.equal(normalizeApproved(""), "false");
  });
});

describe("normalizeDecision", () => {
  it("returns approved for approved", () => {
    assert.equal(normalizeDecision("approved"), "approved");
    assert.equal(normalizeDecision("APPROVED"), "approved");
  });

  it("returns revise for anything else", () => {
    assert.equal(normalizeDecision("rejected"), "revise");
    assert.equal(normalizeDecision(""), "revise");
    assert.equal(normalizeDecision("pending"), "revise");
  });
});

describe("incrementCounter", () => {
  it("increments a number string", () => {
    assert.equal(incrementCounter("0"), "1");
    assert.equal(incrementCounter("5"), "6");
    assert.equal(incrementCounter("99"), "100");
  });

  it("handles non-numeric input", () => {
    assert.equal(incrementCounter("abc"), "1");
    assert.equal(incrementCounter(""), "1");
  });
});

describe("countJsonItems", () => {
  it("counts array items", () => {
    assert.equal(countJsonItems('[1,2,3]'), "3");
    assert.equal(countJsonItems('[]'), "0");
  });

  it("returns 0 for non-array JSON", () => {
    assert.equal(countJsonItems('{"a":1}'), "0");
    assert.equal(countJsonItems('"hello"'), "0");
  });

  it("returns 0 for invalid JSON", () => {
    assert.equal(countJsonItems("not json"), "0");
    assert.equal(countJsonItems(""), "0");
  });
});

describe("stripMarkdownJsonFences", () => {
  it("strips json code fences", () => {
    const input = '```json\n{"a":1}\n```';
    assert.equal(stripMarkdownJsonFences(input), '{"a":1}');
  });

  it("strips plain code fences", () => {
    const input = '```\n[1,2]\n```';
    assert.equal(stripMarkdownJsonFences(input), '[1,2]');
  });

  it("returns plain text unchanged", () => {
    assert.equal(stripMarkdownJsonFences('{"a":1}'), '{"a":1}');
  });

  it("handles empty input", () => {
    assert.equal(stripMarkdownJsonFences(""), "");
  });
});

describe("isPlainObject", () => {
  it("returns true for plain objects", () => {
    assert.equal(isPlainObject({}), true);
    assert.equal(isPlainObject({ a: 1 }), true);
  });

  it("returns false for non-objects", () => {
    assert.equal(isPlainObject(null), false);
    assert.equal(isPlainObject([]), false);
    assert.equal(isPlainObject("string"), false);
    assert.equal(isPlainObject(42), false);
    assert.equal(isPlainObject(undefined), false);
  });
});

describe("slugify", () => {
  it("converts to lowercase slug", () => {
    assert.equal(slugify("Hello World"), "hello-world");
  });

  it("removes special characters", () => {
    assert.equal(slugify("foo@bar!baz"), "foo-bar-baz");
  });

  it("trims leading/trailing hyphens", () => {
    assert.equal(slugify("--hello--"), "hello");
  });

  it("truncates to 80 characters", () => {
    const long = "a".repeat(100);
    assert.equal(slugify(long).length, 80);
  });

  it("handles empty input", () => {
    assert.equal(slugify(""), "");
  });
});
