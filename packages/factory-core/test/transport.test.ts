import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeBase64Utf8,
  encodeBase64Utf8,
  decodeBase64Utf8OrRaw,
  resolveB64OrRaw,
  parseBoolFlag,
  parsePositiveNumber,
  parseNonNegativeNumber,
} from "../src/transport.ts";

describe("decodeBase64Utf8", () => {
  it("decodes valid base64", () => {
    const encoded = Buffer.from("hello world", "utf8").toString("base64");
    assert.equal(decodeBase64Utf8(encoded), "hello world");
  });

  it("returns empty string for empty input", () => {
    assert.equal(decodeBase64Utf8(""), "");
    assert.equal(decodeBase64Utf8(null), "");
    assert.equal(decodeBase64Utf8(undefined), "");
  });

  it("strips whitespace before decoding", () => {
    const encoded = Buffer.from("test", "utf8").toString("base64");
    assert.equal(decodeBase64Utf8(`  ${encoded}  `), "test");
  });
});

describe("encodeBase64Utf8", () => {
  it("encodes to base64", () => {
    const result = encodeBase64Utf8("hello world");
    assert.equal(Buffer.from(result, "base64").toString("utf8"), "hello world");
  });

  it("handles empty input", () => {
    assert.equal(encodeBase64Utf8(""), "");
    assert.equal(encodeBase64Utf8(null), "");
  });
});

describe("decodeBase64Utf8OrRaw", () => {
  it("decodes valid base64", () => {
    const encoded = Buffer.from("hello", "utf8").toString("base64");
    assert.equal(decodeBase64Utf8OrRaw(encoded), "hello");
  });

  it("returns raw string if not valid base64", () => {
    assert.equal(decodeBase64Utf8OrRaw("not base64!"), "not base64!");
  });

  it("returns raw string if contains whitespace", () => {
    assert.equal(decodeBase64Utf8OrRaw("has spaces"), "has spaces");
  });

  it("returns raw string if length not multiple of 4", () => {
    assert.equal(decodeBase64Utf8OrRaw("abc"), "abc");
  });

  it("returns empty for empty input", () => {
    assert.equal(decodeBase64Utf8OrRaw(""), "");
  });
});

describe("resolveB64OrRaw", () => {
  it("returns raw value when provided", () => {
    assert.equal(resolveB64OrRaw("hello", undefined), "hello");
  });

  it("decodes b64 when provided", () => {
    const encoded = Buffer.from("world", "utf8").toString("base64");
    assert.equal(resolveB64OrRaw(undefined, encoded), "world");
  });

  it("throws when both raw and b64 provided", () => {
    assert.throws(
      () => resolveB64OrRaw("raw", "b64", "test"),
      /test accepts one transport/
    );
  });

  it("returns empty string when neither provided", () => {
    assert.equal(resolveB64OrRaw(undefined, undefined), "");
    assert.equal(resolveB64OrRaw(null, null), "");
  });
});

describe("parseBoolFlag", () => {
  it("parses true values", () => {
    assert.equal(parseBoolFlag("true"), true);
    assert.equal(parseBoolFlag("1"), true);
    assert.equal(parseBoolFlag("yes"), true);
    assert.equal(parseBoolFlag("YES"), true);
    assert.equal(parseBoolFlag("True"), true);
  });

  it("parses false values", () => {
    assert.equal(parseBoolFlag("false"), false);
    assert.equal(parseBoolFlag("0"), false);
    assert.equal(parseBoolFlag("no"), false);
    assert.equal(parseBoolFlag("anything"), false);
  });

  it("uses fallback for empty/null/undefined", () => {
    assert.equal(parseBoolFlag("", true), true);
    assert.equal(parseBoolFlag(null, true), true);
    assert.equal(parseBoolFlag(undefined, false), false);
  });
});

describe("parsePositiveNumber", () => {
  it("parses valid positive numbers", () => {
    assert.equal(parsePositiveNumber("5", 0), 5);
    assert.equal(parsePositiveNumber("0.5", 0), 0.5);
  });

  it("returns fallback for zero", () => {
    assert.equal(parsePositiveNumber("0", 10), 10);
  });

  it("returns fallback for negative", () => {
    assert.equal(parsePositiveNumber("-1", 10), 10);
  });

  it("returns fallback for non-numeric", () => {
    assert.equal(parsePositiveNumber("abc", 10), 10);
  });
});

describe("parseNonNegativeNumber", () => {
  it("parses zero", () => {
    assert.equal(parseNonNegativeNumber("0", 10), 0);
  });

  it("parses positive", () => {
    assert.equal(parseNonNegativeNumber("3", 0), 3);
  });

  it("returns fallback for negative", () => {
    assert.equal(parseNonNegativeNumber("-1", 10), 10);
  });
});
