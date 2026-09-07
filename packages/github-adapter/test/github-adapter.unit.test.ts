import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createAuditEmitter, createGhApiClient, createGhCliAdapter, runGhCli } from "../src/github-adapter.ts";
import { createLocalFsAdapter } from "../src/local-fs-adapter.ts";
import {
  BACKEND_ADAPTER_METHODS,
  BACKEND_SELECTION_SCHEMA,
  BACKEND_TYPES,
  createBackend,
  resolveBackendSelection,
  validateBackendSelectionConfig,
} from "../src/create-backend.ts";
import { createTestAdapter } from "../src/test-adapter.ts";

function validMutationContext(overrides = {}) {
  return {
    instance_id: "fac_01TEST",
    installation_id: "inst_01TEST",
    host_id: "host_test_01",
    run_id: "run_01",
    tick_id: "tick_01",
    destinations: {
      goal_issues: { repo: "o/r" },
    },
    capability_version: "capability.v1",
    policy_profile: "policy_pack:v1",
    runtime_version: "1.2.3",
    ...overrides,
  };
}

function createAuditedAdapter(overrides = {}) {
  return createGhCliAdapter({
    repo: "o/r",
    mutationContext: validMutationContext(),
    appendAuditRecordFn: () => ({ ok: true }),
    ...overrides,
  });
}

function withTempStore(fn) {
  const storeRoot = mkdtempSync(path.join(tmpdir(), "github-adapter-test-"));
  try {
    fn(storeRoot);
  } finally {
    rmSync(storeRoot, { recursive: true, force: true });
  }
}

test("runGhCli forwards spawn options to the provided gh function", () => {
  const calls = [];
  const result = runGhCli(["issue", "view", "1"], {
    ghFn: (args, options) => {
      calls.push({ args, options });
      return { ok: true, status: 0, stdout: "{}", stderr: "" };
    },
    options: { input: "payload" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], {
    args: ["issue", "view", "1"],
    options: { input: "payload" },
  });
});

test("createGhApiClient reads JSON with headers and writes JSON payloads", () => {
  const calls = [];
  const api = createGhApiClient({
    ghFn: (args, options) => {
      calls.push({ args, options });
      if (args[1] === "-i" && args[2] === "repos/o/r/issues/1") {
        return {
          ok: true,
          status: 0,
          stdout: 'etag: "7"\ndate: Thu, 01 Jan 2026 00:00:00 GMT\n\n{"number":1}',
          stderr: "",
        };
      }
      return {
        ok: true,
        status: 0,
        stdout: 'etag: "8"\ndate: Thu, 01 Jan 2026 00:00:05 GMT\n\n{"ok":true}',
        stderr: "",
      };
    },
  });

  const read = api.apiReadJson({ apiPath: "repos/o/r/issues/1", includeHeaders: true, fallback: null });
  assert.equal(read.ok, true);
  assert.equal(read.etag, '"7"');
  assert.equal(read.json.number, 1);

  const write = api.apiWriteJson({
    apiPath: "repos/o/r/issues/1",
    method: "PATCH",
    payload: { body: "updated" },
    includeHeaders: true,
    payloadMode: "input",
  });
  assert.equal(write.ok, true);
  assert.equal(write.etag, '"8"');
  assert.equal(calls[1].options.input, JSON.stringify({ body: "updated" }));
});

test("createBackend resolves github adapter contract", () => {
  const adapter = createBackend({
    type: "github",
    repo: "o/r",
    ghFn: () => ({ ok: true, stdout: "[]", stderr: "" }),
    ghPaginatedFn: () => [],
    mutationContext: validMutationContext(),
    appendAuditRecordFn: () => ({ ok: true }),
  });

  assert.equal(adapter.repo, "o/r");
  for (const method of BACKEND_ADAPTER_METHODS) {
    assert.equal(typeof adapter[method], "function", `missing backend method: ${method}`);
  }
});

test("createBackend throws for local_fs without storeRoot", () => {
  assert.throws(
    () => createBackend({ type: "local_fs", repo: "o/r", env: {} }),
    /storeRoot is required for local_fs backend/,
  );
});

test("createBackend throws for unknown backend type", () => {
  assert.throws(
    () => createBackend({ type: "not-a-backend", repo: "o/r" }),
    /unknown backend type: not-a-backend\. supported types: github, local_fs/,
  );
});

test("createBackend local_fs resolves when storeRoot is provided", () => {
  withTempStore((storeRoot) => {
    const adapter = createBackend({ type: "local_fs", repo: "o/r", storeRoot });
    assert.equal(adapter.repo, "o/r");
    for (const method of BACKEND_ADAPTER_METHODS) {
      assert.equal(typeof adapter[method], "function", `missing backend method: ${method}`);
    }
    assert.deepEqual(adapter.issueList({}), []);
  });
});

test("createBackend resolves type/storeRoot from backend config", () => {
  withTempStore((storeRoot) => {
    const adapter = createBackend({
      repo: "o/r",
      env: {},
      backend: {
        type: "local_fs",
        store_root: storeRoot,
      },
    });
    assert.equal(adapter.repo, "o/r");
    assert.deepEqual(adapter.issueList({}), []);
  });
});

test("createBackend explicit options override backend config", () => {
  const adapter = createBackend({
    type: "github",
    repo: "o/r",
    backend: {
      type: "local_fs",
      store_root: "/tmp/backend-store",
    },
    ghFn: () => ({ ok: true, stdout: "[]", stderr: "" }),
    ghPaginatedFn: () => [],
    mutationContext: validMutationContext(),
    appendAuditRecordFn: () => ({ ok: true }),
  });

  assert.equal(adapter.repo, "o/r");
  assert.equal(typeof adapter.issueList, "function");
});

test("createBackend validates backend config shape", () => {
  assert.throws(
    () => createBackend({ repo: "o/r", backend: "github" }),
    /backend config validation failed: backend config must be an object/,
  );

  assert.throws(
    () => createBackend({ repo: "o/r", backend: { type: "invalid" } }),
    /backend config validation failed: unknown backend type: invalid\. supported types: github, local_fs/,
  );

  assert.throws(
    () => createBackend({ repo: "o/r", env: {}, backend: { type: "local_fs" } }),
    /storeRoot is required for local_fs backend/,
  );
});

test("validateBackendSelectionConfig validates backend config contract", () => {
  assert.equal(BACKEND_SELECTION_SCHEMA.env.type, "HATCH_BACKEND_TYPE");
  assert.equal(BACKEND_SELECTION_SCHEMA.env.store_root, "HATCH_BACKEND_STORE_ROOT");
  assert.deepEqual(BACKEND_TYPES, ["github", "local_fs"]);

  assert.deepEqual(validateBackendSelectionConfig(), { ok: true, errors: [] });
  assert.deepEqual(validateBackendSelectionConfig(null), { ok: true, errors: [] });

  assert.deepEqual(validateBackendSelectionConfig({ type: "github" }), { ok: true, errors: [] });
  assert.deepEqual(validateBackendSelectionConfig({ type: "local_fs", store_root: "/tmp/store" }), { ok: true, errors: [] });
  assert.deepEqual(validateBackendSelectionConfig({ type: "local_fs", storeRoot: "/tmp/store" }), { ok: true, errors: [] });

  assert.deepEqual(validateBackendSelectionConfig("not-an-object"), {
    ok: false,
    errors: ["backend config must be an object"],
  });

  assert.deepEqual(validateBackendSelectionConfig({ nope: true }), {
    ok: false,
    errors: ["unknown backend config key: nope"],
  });

  assert.deepEqual(validateBackendSelectionConfig({ type: "bad" }), {
    ok: false,
    errors: ["unknown backend type: bad. supported types: github, local_fs"],
  });

  assert.deepEqual(validateBackendSelectionConfig({ type: "local_fs" }), {
    ok: false,
    errors: ["storeRoot is required for local_fs backend"],
  });

  assert.deepEqual(
    validateBackendSelectionConfig({ storeRoot: "/tmp/a", store_root: "/tmp/b" }),
    {
      ok: false,
      errors: ["backend.storeRoot and backend.store_root must match when both are provided"],
    },
  );
});

test("resolveBackendSelection applies deterministic precedence", () => {
  assert.deepEqual(resolveBackendSelection({}), { type: "github", storeRoot: "" });

  assert.deepEqual(
    resolveBackendSelection({
      backend: { type: "local_fs", store_root: "/cfg/store" },
      env: {
        HATCH_BACKEND_TYPE: "github",
        HATCH_BACKEND_STORE_ROOT: "/env/store",
      },
    }),
    { type: "github", storeRoot: "/env/store" },
  );

  assert.deepEqual(
    resolveBackendSelection({
      type: "github",
      storeRoot: "/explicit/store",
      backend: { type: "local_fs", store_root: "/cfg/store" },
      env: {
        HATCH_BACKEND_TYPE: "local_fs",
        HATCH_BACKEND_STORE_ROOT: "/env/store",
      },
    }),
    { type: "github", storeRoot: "/explicit/store" },
  );

  assert.deepEqual(
    resolveBackendSelection({
      env: {
        HATCH_BACKEND_TYPE: "local_fs",
        HATCH_BACKEND_STORE_ROOT: "/env/store",
      },
    }),
    { type: "local_fs", storeRoot: "/env/store" },
  );

  assert.throws(
    () => resolveBackendSelection({ backend: { type: "bad" } }),
    /backend config validation failed: unknown backend type: bad\. supported types: github, local_fs/,
  );
});

test("backend adapters maintain parity for the covered operation surface", () => {
  withTempStore((storeRoot) => {
    const local = createLocalFsAdapter({
      repo: "o/r",
      storeRoot,
      mutationContext: validMutationContext(),
      nowIsoFn: () => "2026-03-19T00:00:00.000Z",
    });

    const createdLabels = [];
    const state = new Map();

    function ensureIssue(number) {
      if (!state.has(number)) {
        state.set(number, {
          number,
          title: `issue-${number}`,
          body: "",
          labels: [],
          state: "open",
          comments: [],
          milestone: "",
        });
      }
      return state.get(number);
    }

    const gh = createGhCliAdapter({
      repo: "o/r",
      mutationContext: validMutationContext(),
      appendAuditRecordFn: () => ({ ok: true }),
      ghPaginatedFn: (apiPath) => {
        if (apiPath.includes("/issues/1/sub_issues")) return [{ number: 7 }];
        return [];
      },
      ghFn: (args) => {
        const [entity, command] = args;

        if (entity === "issue" && command === "create") {
          const title = args[args.indexOf("--title") + 1] || "";
          const bodyIndex = args.indexOf("--body");
          const body = bodyIndex >= 0 ? args[bodyIndex + 1] : "";
          const labels = [];
          for (let i = 0; i < args.length; i += 1) {
            if (args[i] === "--label") labels.push(args[i + 1]);
          }
          const number = state.size + 1;
          state.set(number, {
            number,
            title,
            body,
            labels,
            state: "open",
            comments: [],
            milestone: "",
          });
          return { ok: true, stdout: `https://github.com/o/r/issues/${number}\n`, stderr: "" };
        }

        if (entity === "issue" && command === "list") {
          const list = [...state.values()].map((issue) => ({ number: issue.number, title: issue.title }));
          return { ok: true, stdout: JSON.stringify(list), stderr: "" };
        }

        if (entity === "issue" && command === "view") {
          const number = Number.parseInt(args[2], 10);
          const issue = ensureIssue(number);
          return {
            ok: true,
            stdout: JSON.stringify({
              number: issue.number,
              title: issue.title,
              state: issue.state,
              labels: issue.labels.map((name) => ({ name })),
              comments: issue.comments,
            }),
            stderr: "",
          };
        }

        if (entity === "issue" && command === "comment") {
          const number = Number.parseInt(args[2], 10);
          const body = args[args.indexOf("--body") + 1] || "";
          const issue = ensureIssue(number);
          issue.comments.push({ body });
          return { ok: true, stdout: "", stderr: "" };
        }

        if (entity === "issue" && command === "edit") {
          const number = Number.parseInt(args[2], 10);
          const issue = ensureIssue(number);
          for (let i = 0; i < args.length; i += 1) {
            if (args[i] === "--add-label") issue.labels.push(args[i + 1]);
            if (args[i] === "--remove-label") {
              issue.labels = issue.labels.filter((label) => label !== args[i + 1]);
            }
            if (args[i] === "--milestone") issue.milestone = args[i + 1];
          }
          issue.labels = [...new Set(issue.labels)];
          return { ok: true, stdout: "", stderr: "" };
        }

        if (entity === "issue" && command === "close") {
          const number = Number.parseInt(args[2], 10);
          const issue = ensureIssue(number);
          issue.state = "closed";
          return { ok: true, stdout: "", stderr: "" };
        }

        if (entity === "label" && command === "create") {
          createdLabels.push(args[2]);
          return { ok: true, stdout: "", stderr: "" };
        }

        return { ok: false, stdout: "", stderr: "unsupported" };
      },
    });

    const localCreate = local.issueCreate({ title: "parity", body: "body", labels: ["bug"] });
    const ghCreate = gh.issueCreate({ title: "parity", body: "body", labels: ["bug"] });
    assert.equal(localCreate.ok, ghCreate.ok);
    assert.equal(localCreate.number, 1);

    assert.deepEqual(
      local.issueList({ fields: "number,title" }),
      gh.issueList({ fields: "number,title" }),
    );

    const localView = local.issueView({ number: 1, fields: "number,title,state,labels,comments" });
    const ghView = gh.issueView({ number: 1, fields: "number,title,state,labels,comments" });
    assert.deepEqual(localView, ghView);

    assert.equal(local.issueComment({ number: 1, body: "comment" }).ok, gh.issueComment({ number: 1, body: "comment" }).ok);
    assert.equal(
      local.issueEdit({ number: 1, addLabels: ["ready"], removeLabels: ["bug"], milestone: "v1" }).ok,
      gh.issueEdit({ number: 1, addLabels: ["ready"], removeLabels: ["bug"], milestone: "v1" }).ok,
    );
    assert.equal(local.issueClose({ number: 1 }).ok, gh.issueClose({ number: 1 }).ok);

    assert.deepEqual(local.issueList({ state: "all", fields: "number,state" }), [{ number: 1, state: "closed" }]);

    assert.equal(local.labelCreate({ name: "triaged" }).ok, gh.labelCreate({ name: "triaged" }).ok);
    assert.deepEqual(createdLabels, ["triaged"]);

    assert.deepEqual(local.listSubIssues({ number: 1 }), []);
    assert.deepEqual(gh.listSubIssues({ number: 1 }), [{ number: 7 }]);
  });
});

// --- createGhCliAdapter ---

test("createGhCliAdapter requires repo", () => {
  assert.throws(() => createGhCliAdapter(), /repo is required/);
  assert.throws(() => createGhCliAdapter({}), /repo is required/);
});

test("createGhCliAdapter returns object with all interface methods", () => {
  const adapter = createGhCliAdapter({
    repo: "o/r",
    ghFn: () => ({ ok: true, stdout: "", stderr: "" }),
  });
  assert.equal(typeof adapter.issueList, "function");
  assert.equal(typeof adapter.issueView, "function");
  assert.equal(typeof adapter.issueComment, "function");
  assert.equal(typeof adapter.issueEdit, "function");
  assert.equal(typeof adapter.issueClose, "function");
  assert.equal(typeof adapter.issueCreate, "function");
  assert.equal(typeof adapter.listSubIssues, "function");
  assert.equal(typeof adapter.issueBlockedBy, "function");
  assert.equal(typeof adapter.issueComments, "function");
  assert.equal(typeof adapter.labelCreate, "function");
  assert.equal(adapter.repo, "o/r");
});

// --- issueList ---

test("issueList builds correct gh args", () => {
  const calls = [];
  const adapter = createGhCliAdapter({
    repo: "o/r",
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: JSON.stringify([{ number: 1 }]), stderr: "" }; },
  });
  const result = adapter.issueList({ state: "open", labels: ["bug", "ready"], limit: 10, fields: "number,title" });
  assert.equal(calls.length, 1);
  const a = calls[0];
  assert.deepEqual(a, [
    "issue", "list", "--repo", "o/r",
    "--state", "open",
    "--label", "bug,ready",
    "--limit", "10",
    "--json", "number,title",
  ]);
  assert.deepEqual(result, [{ number: 1 }]);
});

test("issueList uses defaults for missing options", () => {
  const calls = [];
  const adapter = createGhCliAdapter({
    repo: "o/r",
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "[]", stderr: "" }; },
  });
  adapter.issueList({});
  assert.deepEqual(calls[0], [
    "issue", "list", "--repo", "o/r",
    "--state", "open",
    "--limit", "50",
    "--json", "number,title",
  ]);
});

test("issueList returns fallback on failure", () => {
  const adapter = createGhCliAdapter({
    repo: "o/r",
    ghFn: () => ({ ok: false, stdout: "", stderr: "error" }),
  });
  assert.deepEqual(adapter.issueList({}), []);
});

test("issueList supports search parameter", () => {
  const calls = [];
  const adapter = createGhCliAdapter({
    repo: "o/r",
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "[]", stderr: "" }; },
  });
  adapter.issueList({ search: "is:open label:bug" });
  assert.ok(calls[0].includes("--search"));
  assert.ok(calls[0].includes("is:open label:bug"));
});

test("issueList supports milestone filtering", () => {
  const calls = [];
  const adapter = createGhCliAdapter({
    repo: "o/r",
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "[]", stderr: "" }; },
  });
  adapter.issueList({ milestone: "goal-1-wave-1", fields: "number,title,milestone" });
  assert.deepEqual(calls[0], [
    "issue", "list", "--repo", "o/r",
    "--state", "open",
    "--limit", "50",
    "--milestone", "goal-1-wave-1",
    "--json", "number,title,milestone",
  ]);
});

// --- issueView ---

test("issueView builds correct gh args", () => {
  const calls = [];
  const adapter = createGhCliAdapter({
    repo: "o/r",
    ghFn: (args) => {
      calls.push(args);
      return { ok: true, stdout: JSON.stringify({ number: 42, title: "Issue" }), stderr: "" };
    },
  });
  const result = adapter.issueView({ number: 42, fields: "number,title,labels,comments" });
  assert.deepEqual(calls[0], [
    "issue", "view", "42", "--repo", "o/r",
    "--json", "number,title,labels,comments",
  ]);
  assert.deepEqual(result, { number: 42, title: "Issue" });
});

test("issueView returns fallback on failure", () => {
  const adapter = createGhCliAdapter({
    repo: "o/r",
    ghFn: () => ({ ok: false, stdout: "", stderr: "not found" }),
  });
  assert.deepEqual(adapter.issueView({ number: 42 }), {});
});

test("issueBlockedBy queries GraphQL through the adapter boundary", () => {
  const calls = [];
  const adapter = createGhCliAdapter({
    repo: "o/r",
    ghFn: (args) => {
      calls.push(args);
      return {
        ok: true,
        stdout: JSON.stringify({
          data: {
            repository: {
              issue: {
                blockedBy: {
                  nodes: [{ number: 99, state: "OPEN", milestone: { title: "goal-1-wave-1" } }],
                },
              },
            },
          },
        }),
        stderr: "",
      };
    },
  });

  assert.deepEqual(adapter.issueBlockedBy({ number: 42 }), [
    { number: 99, state: "OPEN", milestone: { title: "goal-1-wave-1" } },
  ]);
  assert.equal(calls[0][0], "api");
  assert.equal(calls[0][1], "graphql");
});

test("issueComments reads issue comments through the adapter boundary", () => {
  const calls = [];
  const adapter = createGhCliAdapter({
    repo: "o/r",
    ghFn: (args) => {
      calls.push(args);
      return {
        ok: true,
        stdout: JSON.stringify([{ body: "hello", created_at: "2026-03-26T00:00:00.000Z" }]),
        stderr: "",
      };
    },
  });

  assert.deepEqual(adapter.issueComments({ number: 42 }), [
    { body: "hello", created_at: "2026-03-26T00:00:00.000Z" },
  ]);
  assert.deepEqual(calls[0], ["api", "repos/o/r/issues/42/comments?per_page=100"]);
});

// --- issueComment ---

test("issueComment builds correct gh args", () => {
  const calls = [];
  const adapter = createAuditedAdapter({
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },
  });
  const result = adapter.issueComment({ number: 42, body: "hello world" });
  assert.deepEqual(calls[0], [
    "issue", "comment", "42", "--repo", "o/r",
    "--body", "hello world",
  ]);
  assert.equal(result.ok, true);
});

// --- issueEdit ---

test("issueEdit with addLabels and removeLabels", () => {
  const calls = [];
  const adapter = createAuditedAdapter({
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },
  });
  adapter.issueEdit({ number: 42, addLabels: ["bug", "p1"], removeLabels: ["wontfix"] });
  assert.deepEqual(calls[0], [
    "issue", "edit", "42", "--repo", "o/r",
    "--add-label", "bug", "--add-label", "p1",
    "--remove-label", "wontfix",
  ]);
});

test("issueEdit with no labels produces minimal args", () => {
  const calls = [];
  const adapter = createAuditedAdapter({
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },
  });
  adapter.issueEdit({ number: 42 });
  assert.deepEqual(calls[0], ["issue", "edit", "42", "--repo", "o/r"]);
});

test("issueEdit with milestone", () => {
  const calls = [];
  const adapter = createAuditedAdapter({
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },
  });
  adapter.issueEdit({ number: 42, milestone: "v1.0" });
  assert.deepEqual(calls[0], ["issue", "edit", "42", "--repo", "o/r", "--milestone", "v1.0"]);
});

test("issueEdit forwards title and body through the adapter contract", () => {
  const calls = [];
  const adapter = createAuditedAdapter({
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },
  });
  adapter.issueEdit({ number: 42, title: "Retitle", body: "Updated body" });
  assert.deepEqual(calls[0], [
    "issue", "edit", "42", "--repo", "o/r", "--title", "Retitle", "--body", "Updated body",
  ]);
});

// --- issueClose ---

test("issueClose builds correct gh args", () => {
  const calls = [];
  const adapter = createAuditedAdapter({
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },
  });
  adapter.issueClose({ number: 42, reason: "not_planned" });
  assert.deepEqual(calls[0], [
    "issue", "close", "42", "--repo", "o/r",
    "--reason", "not_planned",
  ]);
});

test("issueClose defaults to completed reason", () => {
  const calls = [];
  const adapter = createAuditedAdapter({
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },
  });
  adapter.issueClose({ number: 42 });
  assert.deepEqual(calls[0], [
    "issue", "close", "42", "--repo", "o/r",
    "--reason", "completed",
  ]);
});

// --- issueCreate ---

test("issueCreate builds correct gh args", () => {
  const calls = [];
  const adapter = createAuditedAdapter({
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "https://github.com/o/r/issues/99\n", stderr: "" }; },
  });
  const result = adapter.issueCreate({ title: "New bug", body: "Details", labels: ["bug", "p1"] });
  assert.deepEqual(calls[0], [
    "issue", "create", "--repo", "o/r",
    "--title", "New bug",
    "--body", "Details",
    "--label", "bug", "--label", "p1",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://github.com/o/r/issues/99");
});

test("issueCreate with no body or labels", () => {
  const calls = [];
  const adapter = createAuditedAdapter({
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },
  });
  adapter.issueCreate({ title: "Simple" });
  assert.deepEqual(calls[0], [
    "issue", "create", "--repo", "o/r",
    "--title", "Simple",
  ]);
});

test("addSubIssue resolves node IDs and posts the GraphQL mutation", () => {
  const calls = [];
  const adapter = createAuditedAdapter({
    ghFn: (args) => {
      calls.push(args);
      if (args[1] === "repos/o/r/issues/10") return { ok: true, stdout: "NODE_PARENT\n", stderr: "" };
      if (args[1] === "repos/o/r/issues/11") return { ok: true, stdout: "NODE_CHILD\n", stderr: "" };
      return { ok: true, stdout: '{"data":{"addSubIssue":{"issue":{"number":10},"subIssue":{"number":11}}}}', stderr: "" };
    },
  });
  const result = adapter.addSubIssue({ parentNumber: 10, childNumber: 11 });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], ["api", "repos/o/r/issues/10", "--jq", ".node_id"]);
  assert.deepEqual(calls[1], ["api", "repos/o/r/issues/11", "--jq", ".node_id"]);
  assert.deepEqual(calls[2], [
    "api", "graphql",
    "-f", "query=mutation($parent:ID!,$child:ID!){addSubIssue(input:{issueId:$parent,subIssueId:$child}){issue{number} subIssue{number}}}",
    "-F", "parent=NODE_PARENT",
    "-F", "child=NODE_CHILD",
  ]);
});

// --- listSubIssues ---

test("listSubIssues builds correct API path", () => {
  const calls = [];
  const adapter = createGhCliAdapter({
    repo: "o/r",
    ghPaginatedFn: (path, fallback) => { calls.push(path); return [{ number: 1 }]; },
  });
  const result = adapter.listSubIssues({ number: 42 });
  assert.equal(calls[0], "repos/o/r/issues/42/sub_issues?per_page=100");
  assert.deepEqual(result, [{ number: 1 }]);
});

// --- labelCreate ---

test("labelCreate builds correct gh args", () => {
  const calls = [];
  const adapter = createAuditedAdapter({
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },
  });
  adapter.labelCreate({ name: "quarantined", description: "Cooldown state", color: "ff0000" });
  assert.deepEqual(calls[0], [
    "label", "create", "quarantined", "--repo", "o/r",
    "--description", "Cooldown state",
    "--color", "ff0000",
    "--force",
  ]);
});

test("labelCreate with no description or color", () => {
  const calls = [];
  const adapter = createAuditedAdapter({
    ghFn: (args) => { calls.push(args); return { ok: true, stdout: "", stderr: "" }; },
  });
  adapter.labelCreate({ name: "test" });
  assert.deepEqual(calls[0], [
    "label", "create", "test", "--repo", "o/r",
    "--force",
  ]);
});

// --- createTestAdapter ---

test("createTestAdapter returns adapter with all interface methods", () => {
  const adapter = createTestAdapter({ repo: "o/r" });
  assert.equal(typeof adapter.issueList, "function");
  assert.equal(typeof adapter.issueView, "function");
  assert.equal(typeof adapter.issueComment, "function");
  assert.equal(typeof adapter.issueEdit, "function");
  assert.equal(typeof adapter.issueClose, "function");
  assert.equal(typeof adapter.issueCreate, "function");
  assert.equal(typeof adapter.listSubIssues, "function");
  assert.equal(typeof adapter.labelCreate, "function");
  assert.equal(adapter.repo, "o/r");
});

test("createTestAdapter tracks all calls", () => {
  const adapter = createTestAdapter({ repo: "o/r" });
  adapter.issueList({ state: "open" });
  adapter.issueComment({ number: 1, body: "hi" });
  assert.equal(adapter.calls.length, 2);
  assert.equal(adapter.calls[0].method, "issueList");
  assert.deepEqual(adapter.calls[0].args, { state: "open" });
  assert.equal(adapter.calls[1].method, "issueComment");
});

test("createTestAdapter uses stubs for return values", () => {
  const adapter = createTestAdapter({
    repo: "o/r",
    stubs: {
      issueList: () => [{ number: 10, title: "A" }],
      issueView: ({ number }) => ({ number, title: "Issue " + number, labels: [], comments: [] }),
    },
  });
  const list = adapter.issueList({ state: "open" });
  assert.deepEqual(list, [{ number: 10, title: "A" }]);

  const view = adapter.issueView({ number: 42 });
  assert.equal(view.number, 42);
  assert.equal(view.title, "Issue 42");
});

test("createTestAdapter defaults return empty/ok for unstubbed methods", () => {
  const adapter = createTestAdapter({ repo: "o/r" });
  assert.deepEqual(adapter.issueList({}), []);
  assert.deepEqual(adapter.issueView({ number: 1 }), {});
  assert.deepEqual(adapter.issueComment({ number: 1, body: "" }), { ok: true });
  assert.deepEqual(adapter.issueEdit({ number: 1 }), { ok: true });
  assert.deepEqual(adapter.issueClose({ number: 1 }), { ok: true });
  assert.deepEqual(adapter.issueCreate({ title: "" }), { ok: true, url: "" });
  assert.deepEqual(adapter.listSubIssues({ number: 1 }), []);
  assert.deepEqual(adapter.labelCreate({ name: "x" }), { ok: true });
});

test("createTestAdapter.callsTo filters calls by method", () => {
  const adapter = createTestAdapter({ repo: "o/r" });
  adapter.issueList({ state: "open" });
  adapter.issueComment({ number: 1, body: "a" });
  adapter.issueComment({ number: 2, body: "b" });
  const comments = adapter.callsTo("issueComment");
  assert.equal(comments.length, 2);
  assert.equal(comments[0].args.number, 1);
  assert.equal(comments[1].args.number, 2);
});

test("createTestAdapter stubs receive call args", () => {
  const adapter = createTestAdapter({
    repo: "o/r",
    stubs: {
      issueList: ({ labels }) => labels?.includes("bug") ? [{ number: 1 }] : [],
    },
  });
  assert.deepEqual(adapter.issueList({ labels: ["bug"] }), [{ number: 1 }]);
  assert.deepEqual(adapter.issueList({ labels: ["feature"] }), []);
});

test("createGhCliAdapter emits one audit record per mutation", () => {
  const auditCalls = [];
  const adapter = createGhCliAdapter({
    repo: "o/r",
    mutationContext: validMutationContext(),
    appendAuditRecordFn: (record) => {
      auditCalls.push(record);
      return { ok: true };
    },
    ghFn: (args) => {
      if (args[0] === "issue" && args[1] === "create") {
        return { ok: true, stdout: "https://github.com/o/r/issues/99\n", stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    },
  });

  adapter.issueCreate({ title: "new" });
  adapter.issueComment({ number: 99, body: "hello" });
  adapter.issueEdit({ number: 99, addLabels: ["bug"] });
  adapter.issueClose({ number: 99 });

  assert.equal(auditCalls.length, 4);
  assert.equal(auditCalls[0].action, "issue_create");
  assert.equal(auditCalls[0].target_ref, "issues/99");
  assert.equal(auditCalls[1].action, "comment_create");
  assert.equal(auditCalls[2].action, "issue_label");
  assert.equal(auditCalls[3].action, "issue_close");
});

test("createGhCliAdapter fails closed when mutation context is missing attribution", () => {
  const adapter = createGhCliAdapter({
    repo: "o/r",
    mutationContext: validMutationContext({ tick_id: "" }),
    appendAuditRecordFn: () => ({ ok: true }),
    ghFn: () => ({ ok: true, stdout: "", stderr: "" }),
  });

  assert.throws(() => {
    adapter.issueComment({ number: 1, body: "hi" });
  }, /audit_record_missing_required_field:tick_id/);
});

// --- runGhCli ---

test("runGhCli returns the exact result object from ghFn", () => {
  const expected = { ok: false, status: 1, stdout: "", stderr: "boom" };
  const result = runGhCli(["pr", "list"], {
    ghFn: () => expected,
  });
  assert.deepEqual(result, expected);
});

// --- createGhApiClient failure paths ---

test("createGhApiClient apiReadJson returns error on failure", () => {
  const api = createGhApiClient({
    ghFn: () => ({ ok: false, status: 1, stdout: "", stderr: "not found" }),
  });
  const result = api.apiReadJson({ apiPath: "repos/o/r/issues/999", fallback: null });
  assert.equal(result.ok, false);
  assert.equal(result.json, null);
  assert.match(result.error, /not found/);
});

test("createGhApiClient apiWriteJson returns error on failure", () => {
  const api = createGhApiClient({
    ghFn: () => ({ ok: false, status: 1, stdout: "", stderr: "412 Precondition Failed" }),
  });
  const result = api.apiWriteJson({
    apiPath: "repos/o/r/issues/1",
    method: "PATCH",
    payload: { body: "x" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.precondition_failed, true);
  assert.match(result.error, /412/);
});

test("createGhApiClient apiWriteJson uses -f field mode", () => {
  const calls = [];
  const api = createGhApiClient({
    ghFn: (args) => {
      calls.push(args);
      return { ok: true, status: 0, stdout: '{"ok":true}', stderr: "" };
    },
  });
  api.apiWriteJson({
    apiPath: "repos/o/r/labels",
    method: "POST",
    payload: { name: "bug", color: "ff0000" },
    payloadMode: "fields",
  });
  const a = calls[0];
  assert.ok(a.includes("-f"));
  assert.ok(a.includes("name=bug"));
  assert.ok(a.includes("color=ff0000"));
});

test("createGhApiClient apiPaginatedJson delegates to ghPaginatedFn", () => {
  const api = createGhApiClient({
    ghPaginatedFn: (path, fallback) => {
      assert.equal(path, "repos/o/r/issues");
      return [{ number: 1 }, { number: 2 }];
    },
  });
  const result = api.apiPaginatedJson({ apiPath: "repos/o/r/issues" });
  assert.deepEqual(result, [{ number: 1 }, { number: 2 }]);
});

// --- createAuditEmitter ---

test("createAuditEmitter emit calls appendAuditRecordFn with validated record", () => {
  const emitted = [];
  const emitter = createAuditEmitter({
    repo: "o/r",
    mutationContext: validMutationContext(),
    nowIsoFn: () => "2026-03-24T00:00:00.000Z",
    appendAuditRecordFn: (record, opts) => {
      emitted.push({ record, opts });
      return { ok: true };
    },
  });
  emitter.emit("issue_create", "issues/42");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].record.action, "issue_create");
  assert.equal(emitted[0].record.target_ref, "issues/42");
  assert.equal(emitted[0].record.target_repo, "o/r");
  assert.equal(emitted[0].record.timestamp, "2026-03-24T00:00:00.000Z");
});

test("createAuditEmitter assertContext throws on missing required fields", () => {
  const emitter = createAuditEmitter({
    repo: "o/r",
    mutationContext: validMutationContext({ instance_id: "" }),
    nowIsoFn: () => "2026-03-24T00:00:00.000Z",
    appendAuditRecordFn: () => ({ ok: true }),
  });
  assert.throws(
    () => emitter.assertContext("comment_create", "issues/1"),
    /audit_record_missing_required_field:instance_id/,
  );
});

test("createAuditEmitter assertContext succeeds with valid context", () => {
  const emitter = createAuditEmitter({
    repo: "o/r",
    mutationContext: validMutationContext(),
    nowIsoFn: () => "2026-03-24T00:00:00.000Z",
    appendAuditRecordFn: () => ({ ok: true }),
  });
  assert.doesNotThrow(() => emitter.assertContext("comment_create", "issues/1"));
});

test("createAuditEmitter passes audit path options to appendAuditRecordFn", () => {
  const emitted = [];
  const emitter = createAuditEmitter({
    repo: "o/r",
    mutationContext: validMutationContext(),
    nowIsoFn: () => "2026-03-24T00:00:00.000Z",
    auditHostBaseDir: "/host/base",
    auditLogPath: "/log/path",
    auditHomeDir: "/home/dir",
    appendAuditRecordFn: (record, opts) => {
      emitted.push(opts);
      return { ok: true };
    },
  });
  emitter.emit("issue_create", "issues/1");
  assert.deepEqual(emitted[0], {
    hostBaseDir: "/host/base",
    logPath: "/log/path",
    homeDir: "/home/dir",
  });
});

// --- createGhCliAdapter mutation does not audit on failure ---

test("createGhCliAdapter does not emit audit on ghFn failure", () => {
  const auditCalls = [];
  const adapter = createGhCliAdapter({
    repo: "o/r",
    mutationContext: validMutationContext(),
    appendAuditRecordFn: (record) => {
      auditCalls.push(record);
      return { ok: true };
    },
    ghFn: () => ({ ok: false, stdout: "", stderr: "error" }),
  });

  adapter.issueComment({ number: 1, body: "hi" });
  adapter.issueEdit({ number: 1, addLabels: ["bug"] });
  adapter.issueClose({ number: 1 });
  adapter.labelCreate({ name: "test" });

  assert.equal(auditCalls.length, 0, "no audit records should be emitted for failed mutations");
});

test("issueCreate returns empty url on ghFn failure", () => {
  const adapter = createAuditedAdapter({
    ghFn: () => ({ ok: false, stdout: "", stderr: "error" }),
  });
  const result = adapter.issueCreate({ title: "fail" });
  assert.equal(result.ok, false);
  assert.equal(result.url, "");
});
