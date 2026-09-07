/**
 * Factory Simulation Helpers
 *
 * SimulatedRepo, FactorySimulator, mock adapters, and scenario helpers
 * for the factory simulation test suite.
 */
import assert from "node:assert/strict";

import { computeArtifactLabelRepairs } from "../../src/commands/supervisor-sanitize-artifact-labels.ts";
import { areAllWavesComplete } from "../../src/commands/supervisor-sanitize-goals.ts";
import { parseControlPlaneBlocker, serializeControlPlaneBlocker } from "../../src/lib/control-plane-blocker.ts";

/** Stub for deleted wave-dispatch-select.mjs */
function computeSelectedWaves({ milestones, readyIssues, closedMarkers, maxConcurrent }) {
  const readyTitles = new Set((readyIssues || []).map((i) => i.milestone?.title).filter(Boolean));
  const selected = (milestones || [])
    .map((m) => m.title)
    .filter((t) => !readyTitles.has(t))
    .slice(0, (maxConcurrent || 2) - readyTitles.size);
  return { selected_waves: [...readyTitles, ...selected].slice(0, maxConcurrent || 2) };
}

/** Stub for deleted milestone-next-issue.mjs */
function computeNextMilestoneIssue({ milestoneTitle, completed = [], processed = [], issues = [] }) {
  const skip = new Set([...completed, ...processed].map(String));
  const candidates = issues
    .filter((i) => !i.title.startsWith("Wave Ready:"))
    .filter((i) => !skip.has(String(i.number)))
    .sort((a, b) => a.number - b.number);
  if (candidates.length === 0) return { has_next: false };
  return { has_next: true, next_issue_number: String(candidates[0].number) };
}

/** Stub for deleted wave-split-results.mjs */
function splitWaveImplResults(raw) {
  const items = JSON.parse(raw);
  const merge_candidates = items.filter((i) => !i.review_failed && i.review_failed !== "true");
  const review_failures = items.filter((i) => i.review_failed || i.review_failed === "true");
  return { merge_candidates, review_failures };
}

/** Stub for deleted wave-sanitize-state.mjs.
 * Minimal repair: deduplicate wave markers per milestone and remove stale
 * wave-in-progress labels from markers that are not actively executing.
 */
function planWaveOrphanStateRepair({ openIssues = [] } = {}) {
  const actions = [];
  const waveMarkers = openIssues.filter((i) => i.title.startsWith("Wave Ready:") && i.state === "OPEN");
  const byMilestone = new Map();
  for (const marker of waveMarkers) {
    const ms = marker.milestone?.title || "";
    if (!ms) continue;
    if (!byMilestone.has(ms)) byMilestone.set(ms, []);
    byMilestone.get(ms).push(marker);
  }
  for (const [, markers] of byMilestone) {
    if (markers.length > 1) {
      // Keep the first marker with "ready", close extras
      const sorted = markers.sort((a, b) => a.number - b.number);
      const keep = sorted.find((m) => m.labels.some((l) => l.name === "ready")) || sorted[0];
      for (const m of sorted) {
        if (m.number === keep.number) continue;
        actions.push({ type: "close_issue", issue_number: m.number });
      }
    }
    // Remove stale wave-in-progress from all markers
    for (const m of markers) {
      if (m.labels.some((l) => l.name === "wave-in-progress")) {
        actions.push({ type: "remove_label", issue_number: m.number, label: "wave-in-progress" });
      }
      // Ensure surviving marker has ready label
      if (!m.labels.some((l) => l.name === "ready")) {
        actions.push({ type: "add_label", issue_number: m.number, label: "ready" });
      }
    }
  }
  return { actions };
}

// ─── SimulatedRepo ──────────────────────────────────────────────────────────

const INFRASTRUCTURE_LABELS = new Set(["factory-tracking", "priorities"]);
const HUMAN_GATE_LABELS = new Set(["awaiting-human", "human"]);

export class SimulatedRepo {
  constructor() {
    /** @type {Map<number, object>} */
    this.issues = new Map();
    /** @type {Map<string, object>} title -> milestone */
    this.milestones = new Map();
    /** @type {Map<number, object[]>} issueNumber -> comments */
    this.comments = new Map();
    /** @type {Map<number, object[]>} issueNumber -> blockers */
    this.blockedByMap = new Map();
    this._nextNumber = 1;
  }

  createIssue({ title, labels = [], milestone = null, body = "" }) {
    const number = this._nextNumber++;
    const now = new Date().toISOString();
    const issue = {
      number,
      title,
      state: "OPEN",
      labels: labels.map((n) => ({ name: n })),
      milestone: milestone ? { title: milestone } : null,
      body,
      url: `https://github.com/test/repo/issues/${number}`,
      createdAt: now,
      updatedAt: now,
    };
    this.issues.set(number, issue);
    this.comments.set(number, []);
    if (milestone && !this.milestones.has(milestone)) {
      this.milestones.set(milestone, { title: milestone, number: this.milestones.size + 1, state: "open" });
    }
    return issue;
  }

  addLabel(number, label) {
    const issue = this.issues.get(number);
    if (!issue) return;
    if (!issue.labels.some((l) => l.name === label)) {
      issue.labels.push({ name: label });
    }
  }

  removeLabel(number, label) {
    const issue = this.issues.get(number);
    if (!issue) return;
    issue.labels = issue.labels.filter((l) => l.name !== label);
  }

  closeIssue(number) {
    const issue = this.issues.get(number);
    if (!issue) return;
    issue.state = "CLOSED";
  }

  reopenIssue(number) {
    const issue = this.issues.get(number);
    if (!issue) return;
    issue.state = "OPEN";
  }

  addComment(number, body, createdAt = new Date().toISOString()) {
    const comments = this.comments.get(number) || [];
    comments.push({ body, created_at: createdAt, createdAt });
    this.comments.set(number, comments);
  }

  getComments(number) {
    return this.comments.get(number) || [];
  }

  viewIssue(number) {
    const issue = this.issues.get(number);
    if (!issue) return {};
    return { ...issue, comments: this.getComments(number) };
  }

  listIssues({ state = "all", label, milestone, search } = {}) {
    let results = [...this.issues.values()];
    if (state === "open") results = results.filter((i) => i.state === "OPEN");
    if (state === "closed") results = results.filter((i) => i.state === "CLOSED");
    if (label) results = results.filter((i) => i.labels.some((l) => l.name === label));
    if (milestone) results = results.filter((i) => i.milestone?.title === milestone);
    if (search) {
      const s = search.toLowerCase();
      results = results.filter((i) => i.title.toLowerCase().includes(s));
    }
    return results;
  }

  listMilestones({ state = "all" } = {}) {
    let results = [...this.milestones.values()];
    if (state !== "all") results = results.filter((m) => m.state === state);
    return results;
  }

  closeMilestone(title) {
    const ms = this.milestones.get(title);
    if (ms) ms.state = "closed";
  }

  getBlockedBy(number) {
    const blockers = this.blockedByMap.get(number) || [];
    return blockers.map((b) => {
      const blockerIssue = this.issues.get(b.number);
      return { ...b, state: blockerIssue ? blockerIssue.state : b.state };
    });
  }

  setBlockedBy(number, blockers) {
    this.blockedByMap.set(number, blockers);
  }

  hasLabel(number, label) {
    const issue = this.issues.get(number);
    return issue?.labels?.some((l) => l.name === label) || false;
  }

  addControlPlaneBlocker(number, blocker) {
    const serialized = serializeControlPlaneBlocker(blocker);
    if (serialized) this.addComment(number, serialized);
  }

  getControlPlaneBlocker(number) {
    const issue = this.issues.get(number);
    if (!issue) return parseControlPlaneBlocker({});
    const comments = this.getComments(number);
    return parseControlPlaneBlocker({ ...issue, comments });
  }
}

// ─── Mock Adapters ──────────────────────────────────────────────────────────

export function buildMocks(repo) {
  return {
    getMilestoneOpenIssues: (title) => repo.listIssues({ state: "open", milestone: title }),
    getBlockedBy: (n) => repo.getBlockedBy(n),
    getControlPlaneBlocker: (issue) => repo.getControlPlaneBlocker(issue?.number || issue),
    ghJsonFn: (args) => dispatchGhJson(repo, args),
    ghFn: (args) => dispatchGh(repo, args),
    syncBlockedByFn: () => {},
    execGh: (args) => dispatchGh(repo, args),
    listMilestonesFn: () =>
      repo.listMilestones({ state: "open" }).map((m) => ({
        ...m,
        open_issues: repo.listIssues({ state: "open", milestone: m.title }).length,
      })),
  };
}

function dispatchGhJson(repo, args) {
  const cmd = args.join(" ");
  if (args[0] === "issue" && args[1] === "list") return repo.listIssues(parseGhListArgs(args));
  if (args[0] === "issue" && args[1] === "view") return repo.viewIssue(Number(args[2]));
  if (args[0] === "api" && typeof args[1] === "string" && args[1].includes("/comments")) {
    const m = args[1].match(/issues\/(\d+)\/comments/);
    if (m) return repo.getComments(Number(m[1]));
  }
  if (args[0] === "api" && cmd.includes("milestones")) return repo.listMilestones({ state: "all" });
  return [];
}

function dispatchGh(repo, args) {
  if (args[0] === "issue") {
    const sub = args[1];
    if (sub === "create") {
      const title = argVal(args, "--title");
      const labels = argVal(args, "--label");
      const milestone = argVal(args, "--milestone");
      const body = argVal(args, "--body");
      const issue = repo.createIssue({
        title, labels: labels ? labels.split(",") : [], milestone: milestone || null, body: body || "",
      });
      return { ok: true, stdout: issue.url, stderr: "" };
    }
    if (sub === "edit") {
      const num = Number(args[2]);
      const addLabel = argVal(args, "--add-label");
      const removeLabel = argVal(args, "--remove-label");
      if (addLabel) repo.addLabel(num, addLabel);
      if (removeLabel) repo.removeLabel(num, removeLabel);
      return { ok: true, stdout: "", stderr: "" };
    }
    if (sub === "close") { repo.closeIssue(Number(args[2])); return { ok: true, stdout: "", stderr: "" }; }
    if (sub === "reopen") { repo.reopenIssue(Number(args[2])); return { ok: true, stdout: "", stderr: "" }; }
    if (sub === "comment") {
      const body = argVal(args, "--body");
      if (body) repo.addComment(Number(args[2]), body);
      return { ok: true, stdout: "", stderr: "" };
    }
  }
  return { ok: true, stdout: "", stderr: "" };
}

function argVal(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : "";
}

function parseGhListArgs(args) {
  const opts = {};
  const stateVal = argVal(args, "--state"); if (stateVal) opts.state = stateVal;
  const label = argVal(args, "--label"); if (label) opts.label = label;
  const milestone = argVal(args, "--milestone"); if (milestone) opts.milestone = milestone;
  const search = argVal(args, "--search");
  if (search) {
    // GitHub search syntax: "Wave Ready:" in:title → extract the quoted term.
    const quoted = search.match(/^"([^"]+)"\s+in:title$/);
    opts.search = quoted ? quoted[1] : search;
  }
  return opts;
}

// ─── FactorySimulator ───────────────────────────────────────────────────────

export class FactorySimulator {
  constructor(repo, config = {}) {
    this.repo = repo;
    this.maxTicks = config.maxTicks || 50;
    this.tickAdvanceSec = config.tickAdvanceSec || 300;
    this.nowMs = config.startMs || Date.parse("2026-03-01T00:00:00Z");
    this.maxConcurrentWaves = config.maxConcurrentWaves || 2;
    this.maxIssuesPerWave = config.maxIssuesPerWave || 5;
    this.waveOutcomes = config.waveOutcomes || {};
    this.quarantineThreshold = config.quarantineThreshold || 3;
    this.cooldownHours = config.cooldownHours || 6;
    this.tickCount = 0;
    this.fingerprints = [];
    this.closedCounts = [];
    this._issueAttempts = new Map();
    this.violations = [];
  }

  tick() {
    this.tickCount++;
    const nowEpoch = Math.floor(this.nowMs / 1000);
    this._releaseQuarantine(nowEpoch);
    this._sanitizeArtifactLabels();
    this._fixOrphanFeatures();
    this._closeCompletedGoals();
    this._closeStaleMergeFollowups();
    this._repairWaveOrphanState();
    this._waveDispatch();
    this._waveExecute();
    this._closeUnlabeledIssues();
    this._closeCompletedMilestones();
    this._checkInvariants();
    this._detectLoop();
    this.nowMs += this.tickAdvanceSec * 1000;
  }

  run() {
    while (this.tickCount < this.maxTicks) {
      if (this.isTerminal()) break;
      this.tick();
      if (this.violations.length > 0) break;
    }
    return { tickCount: this.tickCount, terminal: this.isTerminal(), violations: this.violations, openSummary: this._openSummary() };
  }

  /**
   * Run a partial tick that crashes at a specific phase.
   * Phases (in order): releaseQuarantine, sanitizeArtifactLabels, fixOrphanFeatures,
   * closeCompletedGoals, closeStaleMergeFollowups, repairWaveOrphanState,
   * waveDispatch, waveExecute, closeUnlabeledIssues, closeCompletedMilestones.
   * Crash happens BEFORE the named phase runs.
   */
  crashAtPhase(phase) {
    this.tickCount++;
    const nowEpoch = Math.floor(this.nowMs / 1000);
    const phases = [
      ["releaseQuarantine", () => this._releaseQuarantine(nowEpoch)],
      ["sanitizeArtifactLabels", () => this._sanitizeArtifactLabels()],
      ["fixOrphanFeatures", () => this._fixOrphanFeatures()],
      ["closeCompletedGoals", () => this._closeCompletedGoals()],
      ["closeStaleMergeFollowups", () => this._closeStaleMergeFollowups()],
      ["repairWaveOrphanState", () => this._repairWaveOrphanState()],
      ["waveDispatch", () => this._waveDispatch()],
      ["waveExecute", () => this._waveExecute()],
      ["closeUnlabeledIssues", () => this._closeUnlabeledIssues()],
      ["closeCompletedMilestones", () => this._closeCompletedMilestones()],
    ];
    for (const [name, fn] of phases) {
      if (name === phase) break;
      fn();
    }
    this.nowMs += this.tickAdvanceSec * 1000;
  }

  /**
   * Run wave execution that processes at most `maxFeatures` features per marker,
   * then stops (simulating a crash mid-wave). Leaves wave-in-progress labels intact.
   */
  partialWaveExecute(maxFeatures = 1) {
    const waveMarkers = this.repo.listIssues({ state: "open", label: "ready" }).filter((i) => i.title.startsWith("Wave Ready:"));
    for (const marker of waveMarkers) {
      const milestoneTitle = marker.milestone?.title;
      if (!milestoneTitle) continue;
      this.repo.addLabel(marker.number, "wave-in-progress");
      const implResults = [];
      let issuesProcessed = 0;
      while (issuesProcessed < maxFeatures) {
        const milestoneIssues = this.repo.listIssues({ state: "open", milestone: milestoneTitle })
          .filter((i) => !i.title.startsWith("Wave Ready:"))
          .filter((i) => !i.labels.some((l) => l.name === "quarantined"));
        const processed = implResults.map((r) => String(r.issue_number));
        const completed = this.repo.listIssues({ state: "closed", milestone: milestoneTitle })
          .filter((i) => !i.title.startsWith("Wave Ready:")).map((i) => String(i.number));
        const next = computeNextMilestoneIssue({ milestoneTitle, completed, processed, issues: milestoneIssues, getBlockedBy: (n) => this.repo.getBlockedBy(n), getControlPlaneBlocker: (issue) => this.repo.getControlPlaneBlocker(issue?.number || issue), maxIssues: maxFeatures });
        if (!next.has_next) break;
        const issueNum = Number(next.next_issue_number);
        issuesProcessed++;
        const outcome = this._getOutcome(issueNum);
        const attempts = (this._issueAttempts.get(issueNum) || 0) + 1;
        this._issueAttempts.set(issueNum, attempts);
        if (outcome.verdict === "approve" || (outcome.approvesAfter && attempts > outcome.approvesAfter)) {
          this.repo.closeIssue(issueNum);
        }
      }
      // Crash: leave wave-in-progress label, don't close marker, don't handle failures
    }
  }

  isTerminal() {
    const open = this.repo.listIssues({ state: "open" });
    for (const issue of open) {
      const labelSet = new Set(issue.labels.map((l) => l.name));
      if ([...INFRASTRUCTURE_LABELS].some((l) => labelSet.has(l))) continue;
      if ([...HUMAN_GATE_LABELS].some((l) => labelSet.has(l))) continue;
      return false;
    }
    return true;
  }

  _openSummary() {
    return this.repo.listIssues({ state: "open" }).map((i) => ({
      number: i.number, title: i.title, labels: i.labels.map((l) => l.name), milestone: i.milestone?.title || null,
    }));
  }

  _releaseQuarantine(nowEpoch) {
    for (const issue of this.repo.listIssues({ state: "open", label: "quarantined" })) {
      let lastUntil = 0;
      for (const c of this.repo.getComments(issue.number)) {
        const m = String(c.body || "").match(/WAVE-QUARANTINE:\s*until=(\d+)/i);
        if (m) { const u = Number.parseInt(m[1], 10) || 0; if (u > lastUntil) lastUntil = u; }
      }
      if (lastUntil > 0 && nowEpoch >= lastUntil) {
        this.repo.removeLabel(issue.number, "quarantined");
        this.repo.addComment(issue.number, `Cooldown elapsed; removing quarantine label. WAVE-QUARANTINE-RELEASE: at=${nowEpoch}`, new Date(this.nowMs).toISOString());
      }
    }
  }

  _sanitizeArtifactLabels() {
    const repairs = computeArtifactLabelRepairs(this.repo.listIssues({ state: "open" }));
    for (const r of repairs) {
      if (r.action === "add") this.repo.addLabel(Number(r.issue_number), r.label);
      if (r.action === "remove") this.repo.removeLabel(Number(r.issue_number), r.label);
    }
  }

  _fixOrphanFeatures() {
    for (const f of this.repo.listIssues({ state: "open", label: "feature" })) {
      if (f.milestone?.title) continue;
      const milestones = this.repo.listMilestones({ state: "open" });
      if (milestones.length > 0) f.milestone = { title: milestones[0].title };
    }
  }

  _closeCompletedGoals() {
    const allMilestones = this.repo.listMilestones();
    for (const g of this.repo.listIssues({ state: "open", label: "goal" })) {
      if (areAllWavesComplete(g.number, allMilestones)) {
        this.repo.closeIssue(g.number);
        this.repo.addComment(g.number, "All wave milestones complete. Goal closed.");
      }
      if (g.title.startsWith("[artifact] ")) this.repo.closeIssue(g.number);
    }
  }

  _closeStaleMergeFollowups() {
    for (const f of this.repo.listIssues({ state: "open", label: "merge-followup" })) {
      const created = Date.parse(f.createdAt);
      if (Number.isFinite(created) && (this.nowMs - created) > 24 * 60 * 60 * 1000) this.repo.closeIssue(f.number);
    }
  }

  _repairWaveOrphanState() {
    const plan = planWaveOrphanStateRepair({
      openIssues: this.repo.listIssues({ state: "open" }),
      activeLeases: { active_milestones: [], active_leases: [], stale_candidates: [] },
    });
    for (const action of plan.actions || []) {
      const num = Number(action.issue_number);
      if (action.type === "close_issue") this.repo.closeIssue(num);
      if (action.type === "add_label") this.repo.addLabel(num, action.label);
      if (action.type === "remove_label") this.repo.removeLabel(num, action.label);
    }
  }

  _waveDispatch() {
    const mocks = buildMocks(this.repo);
    const selection = computeSelectedWaves({
      milestones: this.repo.listMilestones({ state: "open" }),
      readyIssues: this.repo.listIssues({ state: "open", label: "ready" }).filter((i) => i.title.startsWith("Wave Ready:")),
      closedMarkers: [],
      prioritiesText: "",
      maxConcurrent: this.maxConcurrentWaves,
      getMilestoneOpenIssues: mocks.getMilestoneOpenIssues,
      getBlockedBy: mocks.getBlockedBy,
    });
    for (const wave of selection.selected_waves) {
      const wantedTitle = `Wave Ready: ${wave}`;
      const existing = this.repo.listIssues({ state: "open" }).find((i) => i.title === wantedTitle && i.milestone?.title === wave);
      if (existing) { if (!this.repo.hasLabel(existing.number, "ready")) this.repo.addLabel(existing.number, "ready"); continue; }
      const closed = [...this.repo.issues.values()].filter((i) => i.title === wantedTitle && i.milestone?.title === wave && i.state === "CLOSED");
      if (closed.length > 0) {
        const marker = closed[closed.length - 1];
        const comments = this.repo.getComments(marker.number);
        const hasTerminalRelease = comments.some((c) => { const b = String(c.body || ""); return b.includes("WAVE_READY_LEASE_EVENT") && (b.includes("no_merge_candidates") || b.includes("judge_failed")); });
        if (hasTerminalRelease) {
          const lastEvent = comments.filter((c) => String(c.body || "").includes("WAVE_READY_LEASE_EVENT")).pop();
          const eventAt = lastEvent ? Date.parse(lastEvent.created_at || lastEvent.createdAt) : 0;
          if (Number.isFinite(eventAt) && (this.nowMs - eventAt) < 30 * 60 * 1000) continue;
        }
        this.repo.reopenIssue(marker.number);
        if (!this.repo.hasLabel(marker.number, "ready")) this.repo.addLabel(marker.number, "ready");
        continue;
      }
      this.repo.createIssue({ title: wantedTitle, labels: ["ready"], milestone: wave });
    }
    return selection;
  }

  _waveExecute() {
    const waveMarkers = this.repo.listIssues({ state: "open", label: "ready" }).filter((i) => i.title.startsWith("Wave Ready:"));
    for (const marker of waveMarkers) {
      const milestoneTitle = marker.milestone?.title;
      if (!milestoneTitle) continue;
      this.repo.addLabel(marker.number, "wave-in-progress");
      const implResults = [];
      let issuesProcessed = 0;
      while (issuesProcessed < this.maxIssuesPerWave) {
        const milestoneIssues = this.repo.listIssues({ state: "open", milestone: milestoneTitle })
          .filter((i) => !i.title.startsWith("Wave Ready:"))
          .filter((i) => !i.labels.some((l) => l.name === "quarantined"));
        const processed = implResults.map((r) => String(r.issue_number));
        const completed = this.repo.listIssues({ state: "closed", milestone: milestoneTitle })
          .filter((i) => !i.title.startsWith("Wave Ready:")).map((i) => String(i.number));
        const next = computeNextMilestoneIssue({ milestoneTitle, completed, processed, issues: milestoneIssues, getBlockedBy: (n) => this.repo.getBlockedBy(n), getControlPlaneBlocker: (issue) => this.repo.getControlPlaneBlocker(issue?.number || issue), maxIssues: this.maxIssuesPerWave });
        if (!next.has_next) break;
        const issueNum = Number(next.next_issue_number);
        issuesProcessed++;
        const outcome = this._getOutcome(issueNum);
        const attempts = (this._issueAttempts.get(issueNum) || 0) + 1;
        this._issueAttempts.set(issueNum, attempts);
        if (outcome.verdict === "approve" || (outcome.approvesAfter && attempts > outcome.approvesAfter)) {
          implResults.push({ issue_number: String(issueNum), review_failed: false, merged: false, review_notes: "" });
        } else {
          implResults.push({ issue_number: String(issueNum), review_failed: true, merged: false, review_notes: `Review failed at attempt ${attempts}`, branch: `wave/${milestoneTitle}` });
        }
      }
      const { merge_candidates, review_failures } = splitWaveImplResults(JSON.stringify(implResults));
      this._handleReviewFailures(review_failures);
      for (const c of merge_candidates) this.repo.closeIssue(Number(c.issue_number));
      this.repo.removeLabel(marker.number, "ready");
      this.repo.removeLabel(marker.number, "wave-in-progress");
      if (merge_candidates.length === 0 && review_failures.length === 0) {
        this.repo.closeIssue(marker.number);
        this.repo.addComment(marker.number, `WAVE_READY_LEASE_EVENT {"action":"release","reason":"no_merge_candidates","at":"${new Date(this.nowMs).toISOString()}"}`, new Date(this.nowMs).toISOString());
      } else if (review_failures.length > 0 && merge_candidates.length === 0) {
        this.repo.closeIssue(marker.number);
        this.repo.addComment(marker.number, `WAVE_READY_LEASE_EVENT {"action":"release","reason":"judge_failed","at":"${new Date(this.nowMs).toISOString()}"}`, new Date(this.nowMs).toISOString());
      } else {
        this.repo.closeIssue(marker.number);
        this.repo.addComment(marker.number, `Wave complete: merged=${merge_candidates.length}, failed=${review_failures.length}`, new Date(this.nowMs).toISOString());
      }
    }
  }

  _getOutcome(issueNum) { return this.waveOutcomes[issueNum] || { verdict: "approve" }; }

  _handleReviewFailures(failures) {
    const nowEpoch = Math.floor(this.nowMs / 1000);
    const until = nowEpoch + this.cooldownHours * 3600;
    for (const item of failures) {
      const num = Number(item.issue_number);
      const attempts = this._issueAttempts.get(num) || 1;
      this.repo.addComment(num, `WAVE-REVIEW-FAILURE: count=${attempts} note_hash=simulated\n${item.review_notes || ""}`, new Date(this.nowMs).toISOString());
      if (attempts >= this.quarantineThreshold) {
        this.repo.addLabel(num, "quarantined");
        this.repo.addComment(num, `Applied deterministic cooldown. WAVE-QUARANTINE: until=${until} reason=repeat_review_failure count=${attempts}`, new Date(this.nowMs).toISOString());
      }
    }
  }

  _closeUnlabeledIssues() {
    for (const issue of this.repo.listIssues({ state: "open" })) {
      if (issue.labels.length === 0) { this.repo.closeIssue(issue.number); this.repo.addComment(issue.number, "Supervisor: closing unlabeled issue."); }
    }
  }

  _closeCompletedMilestones() {
    for (const [title, ms] of this.repo.milestones) {
      if (ms.state === "closed") continue;
      if (this.repo.listIssues({ state: "open", milestone: title }).length === 0) this.repo.closeMilestone(title);
    }
  }

  _checkInvariants() { this._checkNoDuplicateWaveMarkers(); this._checkMonotonicProgress(); this._checkBoundedRetries(); }

  _checkNoDuplicateWaveMarkers() {
    const byMilestone = new Map();
    for (const m of this.repo.listIssues({ state: "open" }).filter((i) => i.title.startsWith("Wave Ready:"))) {
      const ms = m.milestone?.title || m.title.replace("Wave Ready: ", "");
      const count = (byMilestone.get(ms) || 0) + 1;
      byMilestone.set(ms, count);
      if (count > 1) this.violations.push(`Duplicate wave markers for milestone ${ms} at tick ${this.tickCount}`);
    }
  }

  _checkMonotonicProgress() {
    const closedCount = this.repo.listIssues({ state: "closed" }).length;
    this.closedCounts.push(closedCount);
    if (this.closedCounts.length > 15) {
      const last15 = this.closedCounts.slice(-15);
      if (Math.min(...last15) === Math.max(...last15) && !this.isTerminal())
        this.violations.push(`No progress for 15 ticks at tick ${this.tickCount} (closed=${closedCount})`);
    }
  }

  _checkBoundedRetries() {
    for (const [issueNum, attempts] of this._issueAttempts) {
      if (attempts > this.quarantineThreshold + 5)
        this.violations.push(`Issue ${issueNum} has ${attempts} attempts (exceeds bounded retry) at tick ${this.tickCount}`);
    }
  }

  _detectLoop() {
    const fp = this._stateFingerprint();
    if (this._lastFingerprint === fp) {
      this._consecutiveIdentical = (this._consecutiveIdentical || 0) + 1;
      if (this._consecutiveIdentical >= 10 && !this.isTerminal())
        this.violations.push(`Infinite loop: ${this._consecutiveIdentical} consecutive identical ticks at tick ${this.tickCount}`);
    } else { this._consecutiveIdentical = 0; }
    this._lastFingerprint = fp;
  }

  _stateFingerprint() {
    const issues = [...this.repo.issues.values()].map((i) => `${i.number}:${i.state}:${i.labels.map((l) => l.name).sort().join(",")}:c${(this.repo.comments.get(i.number) || []).length}`).sort().join("|");
    const ms = [...this.repo.milestones.values()].map((m) => `${m.title}:${m.state}`).sort().join("|");
    return `${issues}||${ms}`;
  }
}

// ─── Scenario helpers ───────────────────────────────────────────────────────

export function seedGoalWithWave(repo, waveNum, featureCount, featureLabels = ["feature"]) {
  const goal = repo.createIssue({ title: "Goal: Test goal", labels: ["goal", "ready"], milestone: null });
  const milestoneTitle = `goal-${goal.number}-wave-${waveNum}`;
  const featureNums = [];
  for (let i = 0; i < featureCount; i++) {
    const f = repo.createIssue({ title: `Feature: goal-${goal.number} wave-${waveNum} feature ${i + 1}`, labels: [...featureLabels], milestone: milestoneTitle });
    featureNums.push(f.number);
  }
  return { goalIssueNum: goal.number, milestoneTitle, featureNums };
}

export function assertTerminal(result, label = "") {
  const prefix = label ? `[${label}] ` : "";
  assert.equal(result.violations.length, 0, `${prefix}Invariant violations: ${result.violations.join("; ")}`);
  assert.equal(result.terminal, true, `${prefix}Did not reach terminal state after ${result.tickCount} ticks. Open: ${JSON.stringify(result.openSummary)}`);
}

export function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (1664525 * x + 1013904223) >>> 0; return x / 0x100000000; };
}
