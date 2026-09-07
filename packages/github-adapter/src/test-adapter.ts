import { assertBackendAdapterContract } from "./backend-adapter.ts";

const DEFAULT_STUBS: Record<string, (...args: unknown[]) => unknown> = {
  issueList: () => [],
  issueView: () => ({}),
  issueComment: () => ({ ok: true }),
  issueEdit: () => ({ ok: true }),
  issueClose: () => ({ ok: true }),
  issueCreate: () => ({ ok: true, url: "" }),
  addSubIssue: () => ({ ok: true }),
  listSubIssues: () => [],
  issueBlockedBy: () => [],
  issueComments: () => [],
  labelCreate: () => ({ ok: true }),
};

export function createTestAdapter({ repo = "test/repo", stubs = {} }: { repo?: string; stubs?: Record<string, (...args: unknown[]) => unknown> } = {}): Record<string, unknown> {
  const calls: Array<{ method: string; args: unknown }> = [];

  function makeMethod(name: string): (args?: Record<string, unknown>) => unknown {
    const stubFn = stubs[name] || DEFAULT_STUBS[name];
    return (args: Record<string, unknown> = {}) => {
      calls.push({ method: name, args });
      return stubFn(args);
    };
  }

  const adapter: Record<string, unknown> = {
    repo,
    calls,
    callsTo(method: string) {
      return calls.filter((c) => c.method === method);
    },
    issueList: makeMethod("issueList"),
    issueView: makeMethod("issueView"),
    issueComment: makeMethod("issueComment"),
    issueEdit: makeMethod("issueEdit"),
    issueClose: makeMethod("issueClose"),
    issueCreate: makeMethod("issueCreate"),
    addSubIssue: makeMethod("addSubIssue"),
    listSubIssues: makeMethod("listSubIssues"),
    issueBlockedBy: makeMethod("issueBlockedBy"),
    issueComments: makeMethod("issueComments"),
    labelCreate: makeMethod("labelCreate"),
  };

  assertBackendAdapterContract(adapter, { context: "test adapter" });
  return adapter;
}
