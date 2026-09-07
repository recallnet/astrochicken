import { parseJson, gh, ghJson } from "../lib/cli-helpers.ts";


function ghApiJson(args) {
  return ghJson(["api", "graphql", ...args], null);
}

function parseRepo(repo) {
  const [owner, name] = String(repo || "").split("/");
  return { owner, name };
}

export function syncBlockedBy({ repo, issueNumber, blockedByRaw = "[]" } = {}) {
  const issue = Number(issueNumber || 0);
  if (!repo || !issue) return { ok: false, error: true, synced: false, added: 0, removed: 0 };
  const wanted = new Set(parseJson(String(blockedByRaw || "[]"), []).map((x) => Number(x)).filter(Boolean));
  const { owner, name } = parseRepo(repo);
  if (!owner || !name) return { ok: false, error: true, synced: false, added: 0, removed: 0 };

  const q = `query{ repository(owner:\"${owner}\", name:\"${name}\"){ target: issue(number:${issue}){ id blockedBy(first:100){nodes{id number}} } } }`;
  const current = ghApiJson(["-f", `query=${q}`]);
  const target = current?.data?.repository?.target;
  const issueId = target?.id;
  const existingNodes = target?.blockedBy?.nodes || [];
  if (!issueId) return { ok: false, error: true, synced: false, added: 0, removed: 0 };

  const existing = new Map(existingNodes.map((n) => [Number(n.number), String(n.id)]));
  let added = 0;
  let removed = 0;

  for (const [num, blockingIssueId] of existing.entries()) {
    if (wanted.has(num)) continue;
    const m = "mutation($issueId:ID!,$blockingIssueId:ID!){ removeBlockedBy(input:{issueId:$issueId, blockingIssueId:$blockingIssueId}){ clientMutationId } }";
    const p = gh(["api", "graphql", "-f", `query=${m}`, "-F", `issueId=${issueId}`, "-F", `blockingIssueId=${blockingIssueId}`]);
    if (p.ok) removed += 1;
  }

  for (const num of wanted) {
    if (existing.has(num)) continue;
    const q2 = `query{ repository(owner:\"${owner}\", name:\"${name}\"){ b: issue(number:${num}){ id } } }`;
    const blocker = ghApiJson(["-f", `query=${q2}`]);
    const blockingIssueId = blocker?.data?.repository?.b?.id;
    if (!blockingIssueId) continue;
    const m = "mutation($issueId:ID!,$blockingIssueId:ID!){ addBlockedBy(input:{issueId:$issueId, blockingIssueId:$blockingIssueId}){ clientMutationId } }";
    const p = gh(["api", "graphql", "-f", `query=${m}`, "-F", `issueId=${issueId}`, "-F", `blockingIssueId=${blockingIssueId}`]);
    if (p.ok) added += 1;
  }

  return { synced: true, added, removed };
}
