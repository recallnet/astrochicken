import assert from "node:assert/strict";
import test from "node:test";

import {
  FACTORY_OPS_ERROR_CATALOG,
  FACTORY_OPS_ERROR_CODES,
  buildAmbiguousFactorySubstringErrorCode,
  buildFactoryPathNamespaceErrorCode,
  buildHostInstallMissingPathErrorCode,
  createFactoryOpsError,
  normalizeFactoryOpsError,
} from "../src/lib/error-catalog.ts";

test("factory ops error catalog codes are unique", () => {
  const codes = Object.values(FACTORY_OPS_ERROR_CODES);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) {
    assert.equal(typeof FACTORY_OPS_ERROR_CATALOG[code]?.message, "string");
    assert.ok(FACTORY_OPS_ERROR_CATALOG[code].message.length > 0);
  }
});

test("factory ops error helpers build stable host lifecycle codes", () => {
  assert.equal(buildFactoryPathNamespaceErrorCode("runs_dir"), "runs_dir_must_include_factory_id");
  assert.equal(buildAmbiguousFactorySubstringErrorCode("logs_root"), "logs_root_contains_ambiguous_factory_substring");
  assert.equal(buildHostInstallMissingPathErrorCode("pidFile"), "host_install_missing_pid_file");
});

test("normalizeFactoryOpsError keeps explicit code and human message", () => {
  const error = createFactoryOpsError(
    FACTORY_OPS_ERROR_CODES.gh_repo_required,
    "Unable to resolve GitHub repo: provide --repo",
  );
  const normalized = normalizeFactoryOpsError(error);
  assert.equal(normalized.code, FACTORY_OPS_ERROR_CODES.gh_repo_required);
  assert.equal(normalized.message, "Unable to resolve GitHub repo: provide --repo");
});

test("normalizeFactoryOpsError extracts code prefixes from legacy string messages", () => {
  const normalized = normalizeFactoryOpsError(new Error("runs_dir_contains_ambiguous_factory_substring:alpha"));
  assert.equal(normalized.code, "runs_dir_contains_ambiguous_factory_substring");
  assert.equal(normalized.message, "runs_dir_contains_ambiguous_factory_substring:alpha");
});
