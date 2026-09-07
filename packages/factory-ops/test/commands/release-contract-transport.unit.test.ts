import test from "node:test";
import assert from "node:assert/strict";

import {
  parseOptionalReleaseContractWithFallback,
  parseRequiredReleaseContractInput,
  parseRequiredReleaseContractPair,
} from "../../src/cli/release-contract-transport.ts";

function makeContext() {
  let stderr = "";
  return {
    stderr: {
      write(text) {
        stderr += String(text);
      },
    },
    getStderr() {
      return stderr;
    },
  };
}

test("parseRequiredReleaseContractPair resolves and validates both payloads", () => {
  const context = makeContext();
  const result = parseRequiredReleaseContractPair({
    context,
    operation: "release test-op",
    leftRaw: JSON.stringify({ ok: "left" }),
    leftB64: undefined,
    leftLabel: "context",
    leftValidate(value) {
      return { side: value.ok };
    },
    rightRaw: JSON.stringify({ ok: "right" }),
    rightB64: undefined,
    rightLabel: "narrative",
    rightValidate(value) {
      return { side: value.ok };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.left, { side: "left" });
  assert.deepEqual(result.right, { side: "right" });
  assert.equal(context.getStderr(), "");
});

test("parseRequiredReleaseContractInput writes the shared missing-transport error", () => {
  const context = makeContext();
  const result = parseRequiredReleaseContractInput({
    context,
    operation: "release update-dedup-cursor",
    raw: "",
    b64: undefined,
    label: "context",
    validate(value) {
      return value;
    },
  });

  assert.equal(result.ok, false);
  assert.match(context.getStderr(), /release update-dedup-cursor requires --context or --context-b64/);
});

test("parseOptionalReleaseContractWithFallback records warnings on missing and invalid payloads", () => {
  const warnings = [];
  const missing = parseOptionalReleaseContractWithFallback({
    raw: "",
    b64: "",
    label: "context",
    validate(value) {
      return value;
    },
    warnings,
  });
  const invalid = parseOptionalReleaseContractWithFallback({
    raw: "{not-json}",
    b64: "",
    label: "narrative",
    validate(value) {
      return value;
    },
    warnings,
  });

  assert.deepEqual(missing, {});
  assert.deepEqual(invalid, {});
  assert.deepEqual(warnings, [
    "fallback:context_missing",
    "fallback:narrative_json_parse_failed",
  ]);
});
