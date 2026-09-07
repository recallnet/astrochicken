import { spawnSync } from "node:child_process";

import { trim, gh } from "../lib/cli-helpers.ts";
import {
  PROJECTION_DIMENSIONS,
  ensureProjectionDimensions,
} from "../lib/insight-contract.ts";


function gitOut(args, cwd = ".", spawnSyncFn = spawnSync) {
  const p = spawnSyncFn("git", args, { encoding: "utf8", cwd });
  if (p.status !== 0) return "";
  return String(p.stdout || "").trim();
}

/**
 * Parse commit log into structured entries.
 * Uses tab-separated format: SHA\tsubject\tauthorDate
 * Subject may contain tabs, so we split on first and last tab.
 */
export function parseCommitLog(raw = "") {
  const trimmed = trim(raw);
  if (!trimmed) return [];
  return trimmed.split("\n").map((line) => {
    const firstTab = line.indexOf("\t");
    const lastTab = line.lastIndexOf("\t");
    if (firstTab < 0 || lastTab <= firstTab) return null;
    return {
      sha: line.slice(0, firstTab),
      subject: line.slice(firstTab + 1, lastTab),
      authored_at: line.slice(lastTab + 1),
    };
  }).filter(Boolean);
}

/**
 * Extract issue/goal references from commit subjects.
 * - Merge commits: "Merge branch 'wave/goal-NNN-wave-M'" → goal NNN
 * - Closes/Fixes/Resolves #NNN → issue NNN
 */
export function extractCommitReferences(commits = []) {
  const goalNumbers = new Set();
  const goalWaveKeys = new Set();
  const issueNumbers = new Set();

  for (const commit of commits) {
    const mergeMatch = commit.subject.match(/^Merge branch 'wave\/(goal-(\d+)-wave-\d+)'/);
    if (mergeMatch) {
      goalWaveKeys.add(mergeMatch[1]);
      goalNumbers.add(Number(mergeMatch[2]));
      continue;
    }

    // Conventional commit format: feat(goal-NNN): ... or fix(goal-NNN): ...
    const conventionalMatch = commit.subject.match(/^(?:feat|fix|chore|refactor|docs)\(goal-(\d+)\):/);
    if (conventionalMatch) {
      goalNumbers.add(Number(conventionalMatch[1]));
      // Don't continue — body may also contain Closes #NNN references
    }

    const closesMatches = commit.subject.matchAll(/(?:Closes|closes|Fixes|fixes|Resolves|resolves)\s+#(\d+)/g);
    for (const match of closesMatches) {
      issueNumbers.add(Number(match[1]));
    }
  }

  return { goalNumbers, goalWaveKeys, issueNumbers };
}

/**
 * Parse commit bodies from NUL-delimited git log output.
 * Git format: `--format=%H%x00%b%x00` produces SHA\0body\0 per commit.
 * Split on \0 yields alternating [SHA, body, SHA, body, ...].
 * Returns a map of SHA → body text.
 */
export function parseCommitBodies(raw = "") {
  const trimmed = trim(raw);
  if (!trimmed) return new Map();
  const parts = trimmed.split("\0");
  const entries = new Map();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const sha = parts[i].trim();
    const body = parts[i + 1].trim();
    if (sha) entries.set(sha, body);
  }
  return entries;
}

/**
 * Extract issue references from commit bodies.
 * Scans for Closes/Fixes/Resolves #NNN, #MMM patterns in body text.
 */
export function extractBodyReferences(bodies = new Map()) {
  const issueNumbers = new Set();
  for (const body of bodies.values()) {
    if (!body) continue;
    // Match "Closes #NNN, #MMM, #PPP" style lines
    const closesLineMatches = body.matchAll(/(?:Closes|closes|Fixes|fixes|Resolves|resolves)\s+(#\d+(?:,\s*#\d+)*)/g);
    for (const lineMatch of closesLineMatches) {
      const refMatches = lineMatch[1].matchAll(/#(\d+)/g);
      for (const ref of refMatches) {
        issueNumbers.add(Number(ref[1]));
      }
    }
  }
  return { issueNumbers };
}

/**
 * Parse combined commit log format: `SHA\tsubject\tdate\0body\0` per commit.
 * Returns commits (for parseCommitLog compat), commitBodies map, and oneline text.
 */
export function parseCombinedCommitLog(raw = "") {
  const trimmed = trim(raw);
  if (!trimmed) return { commits: [], commitBodies: new Map(), commitLogText: "" };

  const commits = [];
  const commitBodies = new Map();
  const onelineEntries = [];

  // Split on \0 — format is: header\0body\0header\0body\0...
  const parts = trimmed.split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const header = parts[i].trim();
    const body = parts[i + 1].trim();
    if (!header) continue;

    const firstTab = header.indexOf("\t");
    const lastTab = header.lastIndexOf("\t");
    if (firstTab < 0 || lastTab <= firstTab) continue;

    const sha = header.slice(0, firstTab);
    const subject = header.slice(firstTab + 1, lastTab);
    const authoredAt = header.slice(lastTab + 1);

    commits.push({ sha, subject, authored_at: authoredAt });
    if (body) commitBodies.set(sha, body);
    onelineEntries.push(`${sha.slice(0, 7)} ${subject}`);
  }

  return { commits, commitBodies, commitLogText: onelineEntries.join("\n") };
}

export const FACTORY_OUTCOMES_PROJECTION_DIMENSIONS = PROJECTION_DIMENSIONS.factory_outcomes;

/**
 * Collect shipped-work outcomes from git commit log on main.
 * Source of truth is commits — no GitHub API calls.
 * Goal/issue metadata is constructed from commit references + repo URL.
 * The release narrator LLM has `gh` CLI available if it needs richer context.
 */
export function collectFactoryOutcomes({
  repo = "",
  repoPath = ".",
  lookbackHours = 24,
  nowMs = Date.now(),
  spawnSyncFn = spawnSync,
} = {}) {
  if (!repo) return { error: "missing_repo" };

  const withProjectionDimensions = (projection = {}) => ensureProjectionDimensions("factory_outcomes", projection);

  const sinceIso = new Date(Number(nowMs) - (Number(lookbackHours || 24) * 3600_000)).toISOString();

  // Single combined git log call: SHA\tsubject\tdate\0body\0
  // Replaces 3 separate git log + 1 oneline calls
  const combinedRaw = gitOut(
    ["log", "--format=%H\t%s\t%aI%x00%b%x00", `--since=${sinceIso}`, "main"],
    repoPath,
    spawnSyncFn,
  );
  const { commits, commitBodies, commitLogText } = parseCombinedCommitLog(combinedRaw);
  const bodyRefs = extractBodyReferences(commitBodies);

  // Extract references from commit subjects (pure regex, no API)
  const { goalNumbers, goalWaveKeys, issueNumbers } = extractCommitReferences(commits);

  // Merge issue references from commit bodies into subject-derived set
  for (const num of bodyRefs.issueNumbers) {
    issueNumbers.add(num);
  }
  const repoUrl = repo ? `https://github.com/${repo}` : "";

  // Construct goal stubs from wave merge branch names
  const waveGoalNumbers = new Set();
  const goals = [...goalWaveKeys].map((key) => {
    const match = key.match(/^goal-(\d+)-wave-\d+$/);
    const num = match ? Number(match[1]) : 0;
    waveGoalNumbers.add(num);
    return {
      number: num,
      wave_key: key,
      title: `Goal #${num}`,
      url: repoUrl ? `${repoUrl}/issues/${num}` : "",
      closed_at: "",
      type: "goal",
    };
  });

  // Add goal stubs for goals detected from conventional commit subjects
  // that weren't already covered by wave keys
  for (const num of goalNumbers) {
    if (!waveGoalNumbers.has(num)) {
      goals.push({
        number: num,
        wave_key: "",
        title: `Goal #${num}`,
        url: repoUrl ? `${repoUrl}/issues/${num}` : "",
        closed_at: "",
        type: "goal",
      });
    }
  }

  // Construct issue stubs from Closes/Fixes/Resolves references
  const issueStubs = [...issueNumbers]
    .filter((num) => !goalNumbers.has(num))
    .map((num) => ({
      number: num,
      title: `Issue #${num}`,
      url: repoUrl ? `${repoUrl}/issues/${num}` : "",
      closed_at: "",
      type: "issue",
    }));

  const mainMergeCommitsRaw = gitOut(["rev-list", "--count", "--merges", `--since=${sinceIso}`, "main"], repoPath, spawnSyncFn);
  const mainMergeCommits = Number(mainMergeCommitsRaw || "0") || 0;

  return withProjectionDimensions({
    repo,
    since_iso: sinceIso,
    commits,
    commit_log: commitLogText,
    goals,
    issues: issueStubs,
    prs: [],
    merged_prs: 0,
    merge_commits_main: mainMergeCommits,
    closed_goals: goals.length,
    closed_features: issueStubs.length,
    closed_bugs: 0,
    closed_feature_bug_total: issueStubs.length,
    outcomes_degraded: false,
    gh_failures: [],
  });
}

/**
 * Create a TTL-cached wrapper around collectFactoryOutcomes.
 * Cache key is `repo` — each repo gets its own cached entry.
 * The cache is checked using wall-clock time (not the `nowMs` param which
 * controls the lookback window inside the function).
 *
 * @param {{ ttlMs?: number }} opts
 * @returns {(opts: Parameters<typeof collectFactoryOutcomes>[0]) => ReturnType<typeof collectFactoryOutcomes>}
 */
export function createCachedCollectFactoryOutcomes({ ttlMs = 60_000 } = {}) {
  const cache = new Map(); // repo → { result, fetchedAt }

  return function cachedCollectFactoryOutcomes(opts = {}) {
    const key = opts.repo || "";
    const now = opts._cacheNowMs || Date.now();
    const entry = cache.get(key);
    if (entry && (now - entry.fetchedAt) < ttlMs) {
      return entry.result;
    }
    const result = collectFactoryOutcomes(opts);
    cache.set(key, { result, fetchedAt: now });
    return result;
  };
}
