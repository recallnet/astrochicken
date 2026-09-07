import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestAdapter } from "../src/test-adapter.ts";

describe("createTestAdapter", () => {
  // --- Default behavior ---

  it("returns adapter with default repo 'test/repo'", () => {
    const adapter = createTestAdapter();
    assert.equal(adapter.repo, "test/repo");
  });

  it("uses custom repo when provided", () => {
    const adapter = createTestAdapter({ repo: "owner/custom" });
    assert.equal(adapter.repo, "owner/custom");
  });

  it("passes adapter contract assertion without throwing", () => {
    assert.doesNotThrow(() => createTestAdapter());
  });

  it("all backend methods exist and are functions", () => {
    const adapter = createTestAdapter();
    const methods = [
      "issueList",
      "issueView",
      "issueComment",
      "issueEdit",
      "issueClose",
      "issueCreate",
      "addSubIssue",
      "listSubIssues",
      "issueBlockedBy",
      "issueComments",
      "labelCreate",
    ];
    for (const m of methods) {
      assert.equal(typeof adapter[m], "function", `${m} should be a function`);
    }
  });

  // --- Default stubs ---

  describe("default stubs", () => {
    it("issueList() returns []", () => {
      const adapter = createTestAdapter();
      assert.deepEqual(adapter.issueList(), []);
    });

    it("issueView() returns {}", () => {
      const adapter = createTestAdapter();
      assert.deepEqual(adapter.issueView(), {});
    });

    it("issueComment() returns { ok: true }", () => {
      const adapter = createTestAdapter();
      assert.deepEqual(adapter.issueComment(), { ok: true });
    });

    it("issueEdit() returns { ok: true }", () => {
      const adapter = createTestAdapter();
      assert.deepEqual(adapter.issueEdit(), { ok: true });
    });

    it("issueClose() returns { ok: true }", () => {
      const adapter = createTestAdapter();
      assert.deepEqual(adapter.issueClose(), { ok: true });
    });

    it('issueCreate() returns { ok: true, url: "" }', () => {
      const adapter = createTestAdapter();
      assert.deepEqual(adapter.issueCreate(), { ok: true, url: "" });
    });

    it("listSubIssues() returns []", () => {
      const adapter = createTestAdapter();
      assert.deepEqual(adapter.listSubIssues(), []);
    });

    it("addSubIssue() returns { ok: true }", () => {
      const adapter = createTestAdapter();
      assert.deepEqual(adapter.addSubIssue(), { ok: true });
    });

    it("labelCreate() returns { ok: true }", () => {
      const adapter = createTestAdapter();
      assert.deepEqual(adapter.labelCreate(), { ok: true });
    });
  });

  // --- Call recording ---

  describe("call recording", () => {
    it("calls starts empty", () => {
      const adapter = createTestAdapter();
      assert.deepEqual(adapter.calls, []);
    });

    it("calling a method records { method, args }", () => {
      const adapter = createTestAdapter();
      adapter.issueView({ number: 42 });
      assert.equal(adapter.calls.length, 1);
      assert.deepEqual(adapter.calls[0], {
        method: "issueView",
        args: { number: 42 },
      });
    });

    it("multiple calls recorded in order", () => {
      const adapter = createTestAdapter();
      adapter.issueList({ state: "open" });
      adapter.issueClose({ number: 1 });
      adapter.issueComment({ number: 1, body: "done" });
      assert.equal(adapter.calls.length, 3);
      assert.equal(adapter.calls[0].method, "issueList");
      assert.equal(adapter.calls[1].method, "issueClose");
      assert.equal(adapter.calls[2].method, "issueComment");
    });

    it("callsTo filters by method name", () => {
      const adapter = createTestAdapter();
      adapter.issueList();
      adapter.issueView({ number: 1 });
      adapter.issueList({ state: "closed" });
      const filtered = adapter.callsTo("issueList");
      assert.equal(filtered.length, 2);
      assert.deepEqual(filtered[0].args, {});
      assert.deepEqual(filtered[1].args, { state: "closed" });
    });

    it("callsTo returns empty for uncalled methods", () => {
      const adapter = createTestAdapter();
      adapter.issueList();
      assert.deepEqual(adapter.callsTo("labelCreate"), []);
    });
  });

  // --- Custom stubs ---

  describe("custom stubs", () => {
    it("custom stub overrides default", () => {
      const adapter = createTestAdapter({
        stubs: { issueList: () => [{ number: 1 }] },
      });
      assert.deepEqual(adapter.issueList(), [{ number: 1 }]);
    });

    it("custom stub receives args", () => {
      const adapter = createTestAdapter({
        stubs: {
          issueView: (args) => ({ number: args.number, title: "stub" }),
        },
      });
      assert.deepEqual(adapter.issueView({ number: 7 }), {
        number: 7,
        title: "stub",
      });
    });

    it("non-overridden methods still use defaults", () => {
      const adapter = createTestAdapter({
        stubs: { issueList: () => [{ number: 99 }] },
      });
      // overridden
      assert.deepEqual(adapter.issueList(), [{ number: 99 }]);
      // default
      assert.deepEqual(adapter.issueView(), {});
      assert.deepEqual(adapter.issueComment(), { ok: true });
    });
  });
});
