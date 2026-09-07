import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BACKEND_ADAPTER_METHODS,
  isBackendAdapter,
  assertBackendAdapterContract,
} from "../src/backend-adapter-contract.ts";

function makeAdapter(overrides = {}) {
  const base = { repo: "owner/repo" };
  for (const method of BACKEND_ADAPTER_METHODS) {
    base[method] = () => {};
  }
  return { ...base, ...overrides };
}

describe("BACKEND_ADAPTER_METHODS", () => {
  it("is a frozen array with 11 methods", () => {
    assert.ok(Object.isFrozen(BACKEND_ADAPTER_METHODS));
    assert.equal(BACKEND_ADAPTER_METHODS.length, 11);
  });

  it("contains expected method names", () => {
    const expected = [
      "issueList", "issueView", "issueComment", "issueEdit",
      "issueClose", "issueCreate", "addSubIssue", "listSubIssues", "issueBlockedBy",
      "issueComments", "labelCreate",
    ];
    assert.deepStrictEqual([...BACKEND_ADAPTER_METHODS], expected);
  });
});

describe("isBackendAdapter", () => {
  it("returns true for a valid adapter", () => {
    assert.equal(isBackendAdapter(makeAdapter()), true);
  });

  it("returns false for null", () => {
    assert.equal(isBackendAdapter(null), false);
  });

  it("returns false for undefined", () => {
    assert.equal(isBackendAdapter(undefined), false);
  });

  it("returns false for a string", () => {
    assert.equal(isBackendAdapter("not an adapter"), false);
  });

  it("returns false when repo is missing", () => {
    const adapter = makeAdapter();
    delete adapter.repo;
    assert.equal(isBackendAdapter(adapter), false);
  });

  it("returns false when repo is empty string", () => {
    assert.equal(isBackendAdapter(makeAdapter({ repo: "" })), false);
  });

  it("returns false when repo is whitespace-only", () => {
    assert.equal(isBackendAdapter(makeAdapter({ repo: "   " })), false);
  });

  it("returns false when one method is missing", () => {
    const adapter = makeAdapter();
    delete adapter.issueClose;
    assert.equal(isBackendAdapter(adapter), false);
  });

  it("returns false when a method is not a function", () => {
    assert.equal(isBackendAdapter(makeAdapter({ issueList: "not a fn" })), false);
  });
});

describe("assertBackendAdapterContract", () => {
  it("returns the value for a valid adapter", () => {
    const adapter = makeAdapter();
    assert.equal(assertBackendAdapterContract(adapter), adapter);
  });

  it("throws listing all missing members for null", () => {
    assert.throws(() => assertBackendAdapterContract(null), (err) => {
      assert.ok(err.message.includes("missing repo"));
      assert.ok(err.message.includes("issueList"));
      return true;
    });
  });

  it("throws mentioning repo when only repo is missing", () => {
    const adapter = makeAdapter();
    delete adapter.repo;
    assert.throws(() => assertBackendAdapterContract(adapter), (err) => {
      assert.ok(err.message.includes("repo"));
      // should not mention any method since they are all present
      assert.ok(!err.message.includes("issueList"));
      return true;
    });
  });

  it("throws mentioning the missing method when one method is absent", () => {
    const adapter = makeAdapter();
    delete adapter.labelCreate;
    assert.throws(() => assertBackendAdapterContract(adapter), (err) => {
      assert.ok(err.message.includes("labelCreate"));
      assert.ok(!err.message.includes("repo"));
      return true;
    });
  });

  it("uses custom context in error message", () => {
    assert.throws(
      () => assertBackendAdapterContract(null, { context: "my custom ctx" }),
      (err) => {
        assert.ok(err.message.startsWith("my custom ctx does not satisfy"));
        return true;
      },
    );
  });

  it("uses default context 'backend adapter'", () => {
    assert.throws(
      () => assertBackendAdapterContract(null),
      (err) => {
        assert.ok(err.message.startsWith("backend adapter does not satisfy"));
        return true;
      },
    );
  });
});
