import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FactoryOpsError,
  createFactoryOpsError,
  extractFactoryOpsErrorCode,
  normalizeFactoryOpsError,
  buildFactoryPathNamespaceErrorCode,
  buildAmbiguousFactorySubstringErrorCode,
  buildHostInstallMissingPathErrorCode,
  FACTORY_OPS_ERROR_CODES,
  FACTORY_OPS_ERROR_CATALOG,
} from "../../src/lib/error-catalog.ts";

describe("FactoryOpsError", () => {
  it("extends Error with name FactoryOpsError", () => {
    const err = new FactoryOpsError("missing_args", "boom");
    assert.ok(err instanceof Error);
    assert.equal(err.name, "FactoryOpsError");
  });

  it("normalizes code to snake_case token", () => {
    const err = new FactoryOpsError("missing_args", "boom");
    assert.equal(err.code, "missing_args");
  });

  it("falls back to catalog message when message is empty", () => {
    const err = new FactoryOpsError("gh_repo_required");
    assert.equal(err.message, "Unable to resolve GitHub repo");
  });

  it("falls back to generic when code has no catalog entry and message is empty", () => {
    const err = new FactoryOpsError("unknown_code_xyz");
    assert.equal(err.message, "factory_ops_error");
  });

  it("preserves cause when provided", () => {
    const cause = new Error("root");
    const err = new FactoryOpsError("missing_args", "boom", { cause });
    assert.equal(err.cause, cause);
  });

  it("omits cause when not provided", () => {
    const err = new FactoryOpsError("missing_args", "boom");
    assert.equal(err.cause, undefined);
  });

  it("defaults code to factory_ops_error for empty/invalid code", () => {
    const err = new FactoryOpsError("", "boom");
    assert.equal(err.code, "factory_ops_error");
  });
});

describe("createFactoryOpsError", () => {
  it("returns a FactoryOpsError instance", () => {
    const err = createFactoryOpsError("missing_args", "test");
    assert.ok(err instanceof FactoryOpsError);
    assert.equal(err.code, "missing_args");
    assert.equal(err.message, "test");
  });

  it("behaves the same as the constructor", () => {
    const cause = new Error("root");
    const err = createFactoryOpsError("gh_repo_required", "", { cause });
    assert.equal(err.message, "Unable to resolve GitHub repo");
    assert.equal(err.cause, cause);
  });
});

describe("extractFactoryOpsErrorCode", () => {
  it("extracts from error_code property", () => {
    assert.equal(extractFactoryOpsErrorCode({ error_code: "missing_args" }), "missing_args");
  });

  it("extracts from errorCode (camelCase) property", () => {
    assert.equal(extractFactoryOpsErrorCode({ errorCode: "missing_args" }), "missing_args");
  });

  it("extracts from code property", () => {
    assert.equal(extractFactoryOpsErrorCode({ code: "missing_args" }), "missing_args");
  });

  it("extracts code from message prefix", () => {
    assert.equal(
      extractFactoryOpsErrorCode({ message: "gh_repo_required: more info" }),
      "gh_repo_required",
    );
  });

  it("extracts code from error string property", () => {
    assert.equal(
      extractFactoryOpsErrorCode({ error: "missing_args: something" }),
      "missing_args",
    );
  });

  it("extracts code from a plain string", () => {
    assert.equal(extractFactoryOpsErrorCode("gh_repo_required: details"), "gh_repo_required");
  });

  it("returns empty string for null/undefined", () => {
    assert.equal(extractFactoryOpsErrorCode(null), "");
    assert.equal(extractFactoryOpsErrorCode(undefined), "");
  });

  it("returns empty string for invalid code characters", () => {
    assert.equal(extractFactoryOpsErrorCode({ code: "NOT-VALID!" }), "");
  });

  it("extracts code from message that is just a code (no colon)", () => {
    assert.equal(
      extractFactoryOpsErrorCode({ message: "missing_args" }),
      "missing_args",
    );
  });
});

describe("normalizeFactoryOpsError", () => {
  it("returns code, message, rawMessage for FactoryOpsError instance", () => {
    const err = new FactoryOpsError("missing_args", "custom msg");
    const result = normalizeFactoryOpsError(err);
    assert.equal(result.code, "missing_args");
    assert.equal(result.message, "custom msg");
    assert.equal(result.rawMessage, "custom msg");
  });

  it("uses catalog message for FactoryOpsError when rawMessage is empty", () => {
    const err = new FactoryOpsError("gh_repo_required");
    const result = normalizeFactoryOpsError(err);
    assert.equal(result.code, "gh_repo_required");
    // message falls back to catalog
    assert.equal(result.message, "Unable to resolve GitHub repo");
    assert.equal(result.rawMessage, "Unable to resolve GitHub repo");
  });

  it("extracts code from plain Error with code-like message", () => {
    const err = new Error("missing_args: bad input");
    const result = normalizeFactoryOpsError(err);
    assert.equal(result.code, "missing_args");
    assert.equal(result.rawMessage, "missing_args: bad input");
  });

  it("extracts code from a string error", () => {
    const result = normalizeFactoryOpsError("gh_repo_required: nope");
    assert.equal(result.code, "gh_repo_required");
    assert.equal(result.rawMessage, "gh_repo_required: nope");
  });

  it("uses fallback code for null", () => {
    const result = normalizeFactoryOpsError(null, "my_fallback");
    assert.equal(result.code, "my_fallback");
    assert.equal(result.rawMessage, "");
  });

  it("uses catalog message when rawMessage is empty", () => {
    const result = normalizeFactoryOpsError(null, "missing_args");
    assert.equal(result.code, "missing_args");
    assert.equal(result.message, FACTORY_OPS_ERROR_CATALOG.missing_args.message);
  });

  it("defaults fallback to factory_ops_error", () => {
    const result = normalizeFactoryOpsError(null);
    assert.equal(result.code, "factory_ops_error");
  });
});

describe("buildFactoryPathNamespaceErrorCode", () => {
  it("converts camelCase label to snake_case error code", () => {
    assert.equal(
      buildFactoryPathNamespaceErrorCode("factoryRoot"),
      "factory_root_must_include_factory_id",
    );
  });

  it("returns empty string for empty input", () => {
    assert.equal(buildFactoryPathNamespaceErrorCode(""), "");
  });
});

describe("buildAmbiguousFactorySubstringErrorCode", () => {
  it("converts camelCase label to snake_case error code", () => {
    assert.equal(
      buildAmbiguousFactorySubstringErrorCode("configPath"),
      "config_path_contains_ambiguous_factory_substring",
    );
  });

  it("returns empty string for empty input", () => {
    assert.equal(buildAmbiguousFactorySubstringErrorCode(""), "");
  });
});

describe("buildHostInstallMissingPathErrorCode", () => {
  it("converts camelCase key to snake_case error code", () => {
    assert.equal(
      buildHostInstallMissingPathErrorCode("runsDir"),
      "host_install_missing_runs_dir",
    );
  });

  it("returns empty string for empty input", () => {
    assert.equal(buildHostInstallMissingPathErrorCode(""), "");
  });
});

describe("FACTORY_OPS_ERROR_CODES", () => {
  it("is a frozen object", () => {
    assert.ok(Object.isFrozen(FACTORY_OPS_ERROR_CODES));
  });

  it("has expected keys", () => {
    const expectedKeys = [
      "missing_args",
      "factory_context_resolve_failed",
      "gh_repo_required",
      "factory_id_required",
      "path_collision",
    ];
    for (const key of expectedKeys) {
      assert.ok(key in FACTORY_OPS_ERROR_CODES, `missing key: ${key}`);
    }
  });

  it("all values are snake_case strings matching their keys", () => {
    for (const [key, value] of Object.entries(FACTORY_OPS_ERROR_CODES)) {
      assert.equal(key, value, `key ${key} does not match value ${value}`);
      assert.match(value, /^[a-z0-9_]+$/, `value ${value} is not snake_case`);
    }
  });
});

describe("FACTORY_OPS_ERROR_CATALOG", () => {
  it("every code in ERROR_CODES has a catalog entry", () => {
    for (const code of Object.values(FACTORY_OPS_ERROR_CODES)) {
      assert.ok(
        code in FACTORY_OPS_ERROR_CATALOG,
        `missing catalog entry for code: ${code}`,
      );
      assert.ok(
        FACTORY_OPS_ERROR_CATALOG[code].message,
        `empty message for code: ${code}`,
      );
    }
  });
});
