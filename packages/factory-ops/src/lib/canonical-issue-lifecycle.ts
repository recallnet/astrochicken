import { z } from "@hatch/factory-core/schema-registry";

import { CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES } from "./canonical-domain-events.ts";
import { resolveCanonicalEventStoreUrl } from "./canonical-event-store-url.ts";
import { trim } from "./cli-helpers.ts";
import { runInlineProjectionSync } from "./inline-projection-runner.ts";
import { createResilientPool, buildPostgresPoolOptions } from "./postgres-pool-options.ts";

export const issueSubIssueLinkTransitionSchema = z.object({
  repo: z.string().min(1),
  issue_number: z.string().regex(/^\d+$/),
  parent_issue_number: z.string().regex(/^\d+$/),
  link_status: z.enum(["linked", "failed"]),
  error: z.string(),
});

export const issueCloseAppliedTransitionSchema = z.object({
  repo: z.string().min(1),
  issue_number: z.string().regex(/^\d+$/),
  close_status: z.enum(["closed", "failed"]),
  reason: z.string(),
  error: z.string(),
});

export const goalCloseRequestedTransitionSchema = z.object({
  repo: z.string().min(1),
  goal_issue_number: z.string().regex(/^\d+$/),
  request_status: z.enum(["requested", "skipped"]),
  reason: z.string(),
  error: z.string(),
});

export const goalCloseAppliedTransitionSchema = z.object({
  repo: z.string().min(1),
  goal_issue_number: z.string().regex(/^\d+$/),
  close_status: z.enum(["closed", "failed"]),
  reason: z.string(),
  error: z.string(),
});

export function normalizeIssueSubIssueLinkTransition({
  repo = "",
  issueNumber = "",
  parentIssueNumber = "",
  linkStatus = "",
  error = "",
} = {}) {
  const parsed = issueSubIssueLinkTransitionSchema.safeParse({
    repo: trim(repo),
    issue_number: trim(issueNumber),
    parent_issue_number: trim(parentIssueNumber),
    link_status: trim(linkStatus).toLowerCase(),
    error: trim(error),
  });
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}:${issue.message}`).join("; ");
    throw new Error(`invalid_issue_sub_issue_link_transition:${details}`);
  }
  return parsed.data;
}

export function normalizeIssueCloseAppliedTransition({
  repo = "",
  issueNumber = "",
  closeStatus = "",
  reason = "",
  error = "",
} = {}) {
  const parsed = issueCloseAppliedTransitionSchema.safeParse({
    repo: trim(repo),
    issue_number: trim(issueNumber),
    close_status: trim(closeStatus).toLowerCase(),
    reason: trim(reason),
    error: trim(error),
  });
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}:${issue.message}`).join("; ");
    throw new Error(`invalid_issue_close_applied_transition:${details}`);
  }
  return parsed.data;
}

export function normalizeGoalCloseRequestedTransition({
  repo = "",
  goalIssueNumber = "",
  requestStatus = "",
  reason = "",
  error = "",
} = {}) {
  const parsed = goalCloseRequestedTransitionSchema.safeParse({
    repo: trim(repo),
    goal_issue_number: trim(goalIssueNumber),
    request_status: trim(requestStatus).toLowerCase(),
    reason: trim(reason),
    error: trim(error),
  });
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}:${issue.message}`).join("; ");
    throw new Error(`invalid_goal_close_requested_transition:${details}`);
  }
  return parsed.data;
}

export function normalizeGoalCloseAppliedTransition({
  repo = "",
  goalIssueNumber = "",
  closeStatus = "",
  reason = "",
  error = "",
} = {}) {
  const parsed = goalCloseAppliedTransitionSchema.safeParse({
    repo: trim(repo),
    goal_issue_number: trim(goalIssueNumber),
    close_status: trim(closeStatus).toLowerCase(),
    reason: trim(reason),
    error: trim(error),
  });
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}:${issue.message}`).join("; ");
    throw new Error(`invalid_goal_close_applied_transition:${details}`);
  }
  return parsed.data;
}

function isShippedMergeStatus(value = "") {
  const normalized = trim(value).toLowerCase();
  return normalized === "merged" || normalized === "already_merged" || normalized === "pushed";
}

export function projectIssueLifecycleFromCanonicalRows(rows = []) {
  const projection = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const family = trim(row?.event_family);
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    if (family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_CREATED) {
      const issueNumber = trim(payload.issue_number);
      if (!issueNumber) continue;
      projection.set(issueNumber, {
        issue_number: issueNumber,
        repo: trim(payload.repo),
        created: true,
        issue_url: trim(payload.issue_url),
        parent_issue_number: trim(projection.get(issueNumber)?.parent_issue_number || ""),
        sub_issue_link_status: trim(projection.get(issueNumber)?.sub_issue_link_status || ""),
        merge_status: trim(projection.get(issueNumber)?.merge_status || ""),
        shipped_to_main: Boolean(projection.get(issueNumber)?.shipped_to_main || false),
        github_close_status: trim(projection.get(issueNumber)?.github_close_status || ""),
        last_error: trim(projection.get(issueNumber)?.last_error || ""),
      });
      continue;
    }
    if (family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_SUB_ISSUE_LINK_APPLIED) {
      const normalized = normalizeIssueSubIssueLinkTransition({
        repo: payload.repo,
        issueNumber: payload.issue_number,
        parentIssueNumber: payload.parent_issue_number,
        linkStatus: payload.link_status,
        error: payload.error,
      });
      const current = projection.get(normalized.issue_number) || {
        issue_number: normalized.issue_number,
        repo: normalized.repo,
        created: false,
        issue_url: "",
      };
      projection.set(normalized.issue_number, {
        ...current,
        repo: normalized.repo,
        parent_issue_number: normalized.parent_issue_number,
        sub_issue_link_status: normalized.link_status,
        last_error: normalized.error,
      });
      continue;
    }
    if (family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.MERGE_COMPLETED) {
      const issueNumber = trim(payload.issue_number);
      const repo = trim(payload.repo);
      if (!issueNumber || !repo) continue;
      const mergeStatus = trim(payload.merge_status);
      const current = projection.get(issueNumber) || {
        issue_number: issueNumber,
        repo,
        created: false,
        issue_url: "",
        parent_issue_number: "",
        sub_issue_link_status: "",
        github_close_status: "",
        last_error: "",
      };
      projection.set(issueNumber, {
        ...current,
        repo,
        merge_status: mergeStatus,
        shipped_to_main: isShippedMergeStatus(mergeStatus),
      });
      continue;
    }
    if (family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_CLOSE_APPLIED) {
      const normalized = normalizeIssueCloseAppliedTransition({
        repo: payload.repo,
        issueNumber: payload.issue_number,
        closeStatus: payload.close_status,
        reason: payload.reason,
        error: payload.error,
      });
      const current = projection.get(normalized.issue_number) || {
        issue_number: normalized.issue_number,
        repo: normalized.repo,
        created: false,
        issue_url: "",
        parent_issue_number: "",
        sub_issue_link_status: "",
        merge_status: "",
        shipped_to_main: false,
      };
      projection.set(normalized.issue_number, {
        ...current,
        repo: normalized.repo,
        github_close_status: normalized.close_status,
        close_reason: normalized.reason,
        last_error: normalized.error,
      });
    }
  }
  return [...projection.values()].sort((left, right) => left.issue_number.localeCompare(right.issue_number));
}

export function projectGoalLifecycleFromCanonicalRows(rows = []) {
  const projection = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const family = trim(row?.event_family);
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    if (family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_CLOSE_REQUESTED) {
      const normalized = normalizeGoalCloseRequestedTransition({
        repo: payload.repo,
        goalIssueNumber: payload.goal_issue_number,
        requestStatus: payload.request_status,
        reason: payload.reason,
        error: payload.error,
      });
      const current = projection.get(normalized.goal_issue_number) || {
        goal_issue_number: normalized.goal_issue_number,
        repo: normalized.repo,
        goal_close_status: "",
        goal_close_reason: "",
        last_error: "",
      };
      projection.set(normalized.goal_issue_number, {
        ...current,
        repo: normalized.repo,
        goal_close_request_status: normalized.request_status,
        goal_close_request_reason: normalized.reason,
        last_error: normalized.error,
      });
      continue;
    }
    if (family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_CLOSE_APPLIED) {
      const normalized = normalizeGoalCloseAppliedTransition({
        repo: payload.repo,
        goalIssueNumber: payload.goal_issue_number,
        closeStatus: payload.close_status,
        reason: payload.reason,
        error: payload.error,
      });
      const current = projection.get(normalized.goal_issue_number) || {
        goal_issue_number: normalized.goal_issue_number,
        repo: normalized.repo,
        goal_close_request_status: "",
        goal_close_request_reason: "",
      };
      projection.set(normalized.goal_issue_number, {
        ...current,
        repo: normalized.repo,
        goal_close_status: normalized.close_status,
        goal_close_reason: normalized.reason,
        last_error: normalized.error,
      });
    }
  }
  return [...projection.values()].sort((left, right) => left.goal_issue_number.localeCompare(right.goal_issue_number));
}

export function projectGoalCandidatesFromCanonicalRows(rows = []) {
  const projection = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const family = trim(row?.event_family);
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    let goalIssueNumber = "";
    if (family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_SUB_ISSUE_LINK_APPLIED) {
      goalIssueNumber = trim(payload.parent_issue_number);
    } else if (
      family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_CLOSE_REQUESTED
      || family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_CLOSE_APPLIED
    ) {
      goalIssueNumber = trim(payload.goal_issue_number);
    }
    if (!goalIssueNumber) continue;

    const current = projection.get(goalIssueNumber) || {
      goal_number: goalIssueNumber,
      repo: trim(payload.repo),
      goal_close_request_status: "",
      goal_close_status: "",
      last_error: "",
    };

    if (family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_CLOSE_REQUESTED) {
      const normalized = normalizeGoalCloseRequestedTransition({
        repo: payload.repo,
        goalIssueNumber: payload.goal_issue_number,
        requestStatus: payload.request_status,
        reason: payload.reason,
        error: payload.error,
      });
      projection.set(goalIssueNumber, {
        ...current,
        repo: normalized.repo,
        goal_close_request_status: normalized.request_status,
        goal_close_request_reason: normalized.reason,
        last_error: normalized.error,
      });
      continue;
    }

    if (family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_CLOSE_APPLIED) {
      const normalized = normalizeGoalCloseAppliedTransition({
        repo: payload.repo,
        goalIssueNumber: payload.goal_issue_number,
        closeStatus: payload.close_status,
        reason: payload.reason,
        error: payload.error,
      });
      projection.set(goalIssueNumber, {
        ...current,
        repo: normalized.repo,
        goal_close_status: normalized.close_status,
        goal_close_reason: normalized.reason,
        last_error: normalized.error,
      });
      continue;
    }

    projection.set(goalIssueNumber, current);
  }
  return [...projection.values()].sort((left, right) => left.goal_number.localeCompare(right.goal_number));
}

function resolveConnectionString({
  connectionString = "",
  runsDir = ".hatch/runs",
  context = {},
  repoRoot = "",
  surface = "canonical issue lifecycle",
} = {}) {
  const explicit = trim(connectionString);
  if (explicit) return explicit;
  return resolveCanonicalEventStoreUrl({
    runsDir,
    context,
    repoRoot,
    surface,
  });
}

export async function listCanonicalIssueLifecycleForGoal({
  connectionString = "",
  factoryId = "",
  goalNumber = "",
  repo = "",
  runsDir = ".hatch/runs",
  context = {},
  repoRoot = "",
  queryRowsFn,
} = {}) {
  const normalizedFactoryId = trim(factoryId);
  const normalizedGoalNumber = trim(goalNumber);
  const normalizedRepo = trim(repo);
  if (!normalizedFactoryId || !normalizedGoalNumber || !normalizedRepo) return [];

  if (typeof queryRowsFn === "function") {
    return projectIssueLifecycleFromCanonicalRows(queryRowsFn({
      factoryId: normalizedFactoryId,
      goalNumber: normalizedGoalNumber,
      repo: normalizedRepo,
    }));
  }

  const resolvedConnectionString = resolveConnectionString({
    connectionString,
    runsDir,
    context,
    repoRoot,
    surface: "canonical issue lifecycle",
  });
  const pool = await createResilientPool(buildPostgresPoolOptions({
    connectionString: resolvedConnectionString,
  }));
  try {
    const linkRows = (await pool.query(
      `select event_family, payload
         from factory_events
        where factory_id = $1
          and event_family = $2
          and payload->>'repo' = $3
          and payload->>'parent_issue_number' = $4
        order by commit_cursor asc, batch_offset asc`,
      [
        normalizedFactoryId,
        CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_SUB_ISSUE_LINK_APPLIED,
        normalizedRepo,
        normalizedGoalNumber,
      ],
    )).rows;
    const linkedIssueNumbers = [...new Set(
      linkRows
        .map((row) => trim(row?.payload?.issue_number))
        .filter(Boolean),
    )];
    if (linkedIssueNumbers.length === 0) {
      return projectIssueLifecycleFromCanonicalRows(linkRows);
    }
    const rows = (await pool.query(
      `select event_family, payload
         from factory_events
        where factory_id = $1
          and event_family = any($2::text[])
          and payload->>'repo' = $3
          and (
            payload->>'parent_issue_number' = $4
            or payload->>'issue_number' = any($5::text[])
          )
        order by commit_cursor asc, batch_offset asc`,
      [
        normalizedFactoryId,
        [
          CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_CREATED,
          CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_SUB_ISSUE_LINK_APPLIED,
          CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.MERGE_COMPLETED,
          CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_CLOSE_APPLIED,
        ],
        normalizedRepo,
        normalizedGoalNumber,
        linkedIssueNumbers,
      ],
    )).rows;
    return projectIssueLifecycleFromCanonicalRows(rows);
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function listCanonicalGoalLifecycleForGoal({
  connectionString = "",
  factoryId = "",
  goalNumber = "",
  repo = "",
  runsDir = ".hatch/runs",
  context = {},
  repoRoot = "",
  queryRowsFn,
} = {}) {
  const normalizedFactoryId = trim(factoryId);
  const normalizedGoalNumber = trim(goalNumber);
  const normalizedRepo = trim(repo);
  if (!normalizedFactoryId || !normalizedGoalNumber || !normalizedRepo) return [];

  if (typeof queryRowsFn === "function") {
    return projectGoalLifecycleFromCanonicalRows(queryRowsFn({
      factoryId: normalizedFactoryId,
      goalNumber: normalizedGoalNumber,
      repo: normalizedRepo,
    }));
  }

  const resolvedConnectionString = resolveConnectionString({
    connectionString,
    runsDir,
    context,
    repoRoot,
    surface: "canonical goal lifecycle",
  });
  const pool = await createResilientPool(buildPostgresPoolOptions({
    connectionString: resolvedConnectionString,
  }));
  try {
    const rows = (await pool.query(
      `select event_family, payload
         from factory_events
        where factory_id = $1
          and event_family = any($2::text[])
          and payload->>'repo' = $3
          and payload->>'goal_issue_number' = $4
        order by commit_cursor asc, batch_offset asc`,
      [
        normalizedFactoryId,
        [
          CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_CLOSE_REQUESTED,
          CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_CLOSE_APPLIED,
        ],
        normalizedRepo,
        normalizedGoalNumber,
      ],
    )).rows;
    return projectGoalLifecycleFromCanonicalRows(rows);
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function listCanonicalGoalCandidatesForRepo({
  connectionString = "",
  factoryId = "",
  repo = "",
  runsDir = ".hatch/runs",
  context = {},
  repoRoot = "",
  queryRowsFn,
} = {}) {
  const normalizedFactoryId = trim(factoryId);
  const normalizedRepo = trim(repo);
  if (!normalizedFactoryId || !normalizedRepo) return [];

  if (typeof queryRowsFn === "function") {
    return projectGoalCandidatesFromCanonicalRows(queryRowsFn({
      factoryId: normalizedFactoryId,
      repo: normalizedRepo,
    }));
  }

  const resolvedConnectionString = resolveConnectionString({
    connectionString,
    runsDir,
    context,
    repoRoot,
    surface: "canonical goal lifecycle",
  });
  const pool = await createResilientPool(buildPostgresPoolOptions({
    connectionString: resolvedConnectionString,
  }));
  try {
    const rows = (await pool.query(
      `select event_family, payload
         from factory_events
        where factory_id = $1
          and event_family = any($2::text[])
          and payload->>'repo' = $3
        order by commit_cursor asc, batch_offset asc`,
      [
        normalizedFactoryId,
        [
          CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.ISSUE_SUB_ISSUE_LINK_APPLIED,
          CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_CLOSE_REQUESTED,
          CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.GOAL_CLOSE_APPLIED,
        ],
        normalizedRepo,
      ],
    )).rows;
    return projectGoalCandidatesFromCanonicalRows(rows);
  } finally {
    await pool.end().catch(() => {});
  }
}

export function listCanonicalIssueLifecycleForGoalSync(args = {}) {
  const serialized = JSON.stringify(args);
  const stdout = runInlineProjectionSync({
    moduleUrl: import.meta.url,
    script: `
      import { listCanonicalIssueLifecycleForGoal } from ${JSON.stringify(import.meta.url)};
      const args = ${serialized};
      const result = await listCanonicalIssueLifecycleForGoal(args);
      process.stdout.write(JSON.stringify(result));
    `,
  });
  return JSON.parse(String(stdout || "[]") || "[]");
}

export function listCanonicalGoalLifecycleForGoalSync(args = {}) {
  const serialized = JSON.stringify(args);
  const stdout = runInlineProjectionSync({
    moduleUrl: import.meta.url,
    script: `
      import { listCanonicalGoalLifecycleForGoal } from ${JSON.stringify(import.meta.url)};
      const args = ${serialized};
      const result = await listCanonicalGoalLifecycleForGoal(args);
      process.stdout.write(JSON.stringify(result));
    `,
  });
  return JSON.parse(String(stdout || "[]") || "[]");
}

export function listCanonicalGoalCandidatesForRepoSync(args = {}) {
  const serialized = JSON.stringify(args);
  const stdout = runInlineProjectionSync({
    moduleUrl: import.meta.url,
    script: `
      import { listCanonicalGoalCandidatesForRepo } from ${JSON.stringify(import.meta.url)};
      const args = ${serialized};
      const result = await listCanonicalGoalCandidatesForRepo(args);
      process.stdout.write(JSON.stringify(result));
    `,
  });
  return JSON.parse(String(stdout || "[]") || "[]");
}
