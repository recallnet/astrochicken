import { ghJson } from "../lib/cli-helpers.ts";

function normalizeLabels(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function parseIssueListArgs(args = []) {
  const out = {
    state: "open",
    labels: [],
    limit: 50,
    fields: "number,title",
    search: "",
  };

  if (!Array.isArray(args)) return out;

  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || "");
    const next = String(args[index + 1] || "");
    if (token === "--state" && next) {
      out.state = next;
      index += 1;
      continue;
    }
    if (token === "--label" && next) {
      out.labels.push(next);
      index += 1;
      continue;
    }
    if (token === "--limit" && next) {
      const parsed = Number.parseInt(next, 10);
      out.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : out.limit;
      index += 1;
      continue;
    }
    if (token === "--json" && next) {
      out.fields = next;
      index += 1;
      continue;
    }
    if (token === "--search" && next) {
      out.search = next;
      index += 1;
    }
  }

  out.labels = normalizeLabels(out.labels.flatMap((entry) => String(entry).split(",")));
  return out;
}

/**
 * Build a supervisor query seam compatible with ghJson(args, fallback) while
 * allowing caller-provided backend adapters to satisfy `issue list` queries.
 */
export function resolveSupervisorGhJsonFn({ ghJsonFn, backendAdapter, repo = "" } = {}) {
  const fallbackGhJson = typeof ghJsonFn === "function" ? ghJsonFn : ghJson;
  if (!backendAdapter) return fallbackGhJson;

  return (args = [], fallback = null) => {
    const tokens = Array.isArray(args) ? args.map((entry) => String(entry || "")) : [];
    const isIssueList = tokens[0] === "issue" && tokens[1] === "list";

    if (!isIssueList) {
      return fallbackGhJson(args, fallback);
    }

    const requestedRepo = (() => {
      const repoFlagIndex = tokens.indexOf("--repo");
      if (repoFlagIndex >= 0 && tokens[repoFlagIndex + 1]) return tokens[repoFlagIndex + 1];
      return String(repo || "").trim();
    })();

    if (String(backendAdapter.repo || "").trim() !== requestedRepo) {
      return fallbackGhJson(args, fallback);
    }

    const parsed = parseIssueListArgs(tokens);
    const payload = backendAdapter.issueList({
      state: parsed.state,
      labels: parsed.labels,
      limit: parsed.limit,
      fields: parsed.fields,
      search: parsed.search,
    });
    return Array.isArray(payload) ? payload : fallback;
  };
}
