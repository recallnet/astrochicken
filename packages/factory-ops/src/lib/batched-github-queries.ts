import { ghJson, trim } from "./cli-helpers.ts";

function parseRepo(repo = "") {
  const [owner, name] = String(repo || "").split("/");
  return { owner: trim(owner), name: trim(name) };
}

function dedup(numbers) {
  return Array.from(new Set(
    (Array.isArray(numbers) ? numbers : [])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0),
  ));
}

/**
 * Batch-fetch issue metadata (number, state, title, labels) for multiple issues
 * in a single GraphQL call. Replaces N individual `gh issue view` calls.
 *
 * @returns {Map<number, { number: number, state: string, title: string, labels: Array<{name: string}> }>}
 */
export function fetchIssueMetadataBatch({ repo = "", issueNumbers = [], ghJsonFn = ghJson } = {}) {
  const { owner, name } = parseRepo(repo);
  const nums = dedup(issueNumbers);
  if (!owner || !name || nums.length === 0) return new Map();

  const selections = nums
    .map((n) => `i${n}: issue(number:${n}){ number state title labels(first:20){ nodes{ name } } }`)
    .join(" ");
  const query = `query{ repository(owner:"${owner}", name:"${name}"){ ${selections} } }`;

  try {
    const out = ghJsonFn(["api", "graphql", "-f", `query=${query}`], null);
    const repository = out?.data?.repository;
    if (!repository || typeof repository !== "object") return new Map();

    const result = new Map();
    for (const n of nums) {
      const raw = repository[`i${n}`];
      if (!raw) continue;
      result.set(n, {
        number: Number(raw.number || n),
        state: String(raw.state || "").trim().toUpperCase(),
        title: String(raw.title || ""),
        labels: (raw.labels?.nodes || []).map((l) => ({ name: String(l?.name || "") })),
      });
    }
    return result;
  } catch {
    return new Map();
  }
}

/**
 * Batch-fetch issue state (OPEN/CLOSED) for multiple issues in a single GraphQL call.
 * Replaces N individual `resolveIssueState` calls.
 *
 * @returns {Map<number, string>} issueNumber → state ("OPEN" | "CLOSED")
 */
export function fetchIssueStateBatch({ repo = "", issueNumbers = [], ghJsonFn = ghJson } = {}) {
  const { owner, name } = parseRepo(repo);
  const nums = dedup(issueNumbers);
  if (!owner || !name || nums.length === 0) return new Map();

  const selections = nums
    .map((n) => `i${n}: issue(number:${n}){ state }`)
    .join(" ");
  const query = `query{ repository(owner:"${owner}", name:"${name}"){ ${selections} } }`;

  try {
    const out = ghJsonFn(["api", "graphql", "-f", `query=${query}`], null);
    const repository = out?.data?.repository;
    if (!repository || typeof repository !== "object") return new Map();

    const result = new Map();
    for (const n of nums) {
      const raw = repository[`i${n}`];
      if (!raw) continue;
      result.set(n, String(raw.state || "").trim().toUpperCase());
    }
    return result;
  } catch {
    return new Map();
  }
}

/**
 * Batch-fetch issue comments + state for multiple issues in a single GraphQL call.
 * Replaces N individual `gh issue view --json comments,state` calls.
 *
 * @returns {Map<number, { state: string, comments: Array<{body: string, author: {login: string}}> }>}
 */
export function fetchIssueCommentsBatch({ repo = "", issueNumbers = [], ghJsonFn = ghJson } = {}) {
  const { owner, name } = parseRepo(repo);
  const nums = dedup(issueNumbers);
  if (!owner || !name || nums.length === 0) return new Map();

  const selections = nums
    .map((n) => `i${n}: issue(number:${n}){ state comments(last:20){ nodes{ body author{ login } } } }`)
    .join(" ");
  const query = `query{ repository(owner:"${owner}", name:"${name}"){ ${selections} } }`;

  try {
    const out = ghJsonFn(["api", "graphql", "-f", `query=${query}`], null);
    const repository = out?.data?.repository;
    if (!repository || typeof repository !== "object") return new Map();

    const result = new Map();
    for (const n of nums) {
      const raw = repository[`i${n}`];
      if (!raw) continue;
      result.set(n, {
        state: String(raw.state || "").trim().toUpperCase(),
        comments: (raw.comments?.nodes || []).map((c) => ({
          body: String(c?.body || ""),
          author: { login: String(c?.author?.login || "") },
        })),
      });
    }
    return result;
  } catch {
    return new Map();
  }
}
