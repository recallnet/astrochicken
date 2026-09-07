import { promises as fsPromises } from "node:fs";
import { dirname } from "node:path";

const VALID_STATUSES = new Set(["pending", "adopted", "dismissed"]);
const ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const REPORT_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MARKER_REGEX = /suggestion:([a-z0-9][a-z0-9._-]*)(?![a-z0-9._-])/g;

export const DEFAULT_LEARNING_LOG_JSON_PATH = "reports/analysis-learnings.json";
export const DEFAULT_LEARNING_LOG_MARKDOWN_PATH = "reports/analysis-learnings.md";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateStatus(status) {
  const normalized = String(status ?? "").trim();
  if (!VALID_STATUSES.has(normalized)) {
    throw new Error(`learning_log_invalid_status: ${normalized || "(empty)"}`);
  }
  return normalized;
}

function validateId(id) {
  const normalized = String(id ?? "").trim();
  if (!ID_REGEX.test(normalized)) {
    throw new Error(`learning_log_invalid_id: ${normalized || "(empty)"}`);
  }
  return normalized;
}

function normalizeEvidenceRefs(evidenceRefs) {
  if (evidenceRefs === undefined || evidenceRefs === null) return [];
  if (!Array.isArray(evidenceRefs)) {
    throw new Error("learning_log_invalid_evidence_refs: expected array");
  }
  return evidenceRefs
    .map((entry) => {
      if (entry === null || entry === undefined) return null;
      if (typeof entry === "string") {
        const value = entry.trim();
        return value ? { ref: value } : null;
      }
      if (typeof entry === "object") {
        const out = {};
        for (const [key, value] of Object.entries(entry)) {
          out[String(key)] = String(value ?? "");
        }
        return out;
      }
      throw new Error("learning_log_invalid_evidence_ref_entry");
    })
    .filter(Boolean);
}

function mergeEvidenceRefs(existingRefs = [], nextRefs = []) {
  const seen = new Set();
  const merged = [];

  for (const entry of [...normalizeEvidenceRefs(existingRefs), ...normalizeEvidenceRefs(nextRefs)]) {
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }

  return merged;
}

function normalizeEntry(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`learning_log_invalid_entry: index=${index}`);
  }

  return {
    id: validateId(entry.id),
    summary: String(entry.summary ?? "").trim(),
    type: String(entry.type ?? "suggestion").trim() || "suggestion",
    status: validateStatus(entry.status ?? "pending"),
    evidence_refs: normalizeEvidenceRefs(entry.evidence_refs),
    impact_notes: String(entry.impact_notes ?? "").trim(),
  };
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => left.id.localeCompare(right.id));
}

async function ensureParentDir(path) {
  await fsPromises.mkdir(dirname(path), { recursive: true });
}

async function withFileLock(path, fn) {
  const lockPath = `${path}.lock`;
  await ensureParentDir(lockPath);

  let handle = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      handle = await fsPromises.open(lockPath, "wx");
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      await sleep(25);
    }
  }

  if (!handle) {
    throw new Error(`learning_log_lock_timeout: ${lockPath}`);
  }

  try {
    return await fn();
  } finally {
    try {
      await handle.close();
    } finally {
      await fsPromises.unlink(lockPath).catch(() => {});
    }
  }
}

async function writeTextAtomic(path, text) {
  await ensureParentDir(path);
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fsPromises.writeFile(tempPath, text, "utf8");
  await fsPromises.rename(tempPath, path);
}

async function readEntriesFromDisk(path) {
  let raw = "";
  try {
    raw = await fsPromises.readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`learning_log_invalid_json: ${String(error?.message || error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("learning_log_invalid_shape: root must be an array");
  }

  const normalized = parsed.map((entry, index) => normalizeEntry(entry, index));
  return sortEntries(normalized);
}

async function writeEntriesToDisk(path, entries) {
  const serialized = `${JSON.stringify(sortEntries(entries), null, 2)}\n`;
  await writeTextAtomic(path, serialized);
}

function listItems(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function formatList(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- (none)";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasDateSection(markdown, date) {
  const regex = new RegExp(`^## ${escapeRegExp(date)}\\s*$`, "m");
  return regex.test(markdown);
}

function buildDateSection({ date, learned, questions, skillChanges, predictions }) {
  return [
    `## ${date}`,
    "",
    "### What I learned",
    formatList(learned),
    "",
    "### Useful questions",
    formatList(questions),
    "",
    "### Skill changes",
    formatList(skillChanges),
    "",
    "### Predictions to check",
    formatList(predictions),
    "",
  ].join("\n");
}

function extractSuggestionMarkerIds(reportBody = "") {
  const body = String(reportBody ?? "");
  const markerIds = new Set();

  MARKER_REGEX.lastIndex = 0;
  let match = MARKER_REGEX.exec(body);
  while (match) {
    markerIds.add(match[1]);
    match = MARKER_REGEX.exec(body);
  }

  return markerIds;
}

function normalizeDate(date) {
  const normalized = String(date ?? "").trim();
  if (!REPORT_DATE_REGEX.test(normalized)) {
    throw new Error(`learning_log_invalid_report_date: ${normalized || "(empty)"}`);
  }
  return normalized;
}

export async function readLearningLog({
  logPath = DEFAULT_LEARNING_LOG_JSON_PATH,
} = {}) {
  return readEntriesFromDisk(logPath);
}

export async function appendLearningItem({
  logPath = DEFAULT_LEARNING_LOG_JSON_PATH,
  id,
  summary = "",
  type = "suggestion",
  status = "pending",
  evidenceRefs = [],
  impactNotes = "",
} = {}) {
  const normalizedId = validateId(id);
  const normalizedStatus = validateStatus(status);
  const normalizedEntry = {
    id: normalizedId,
    summary: String(summary ?? "").trim(),
    type: String(type ?? "suggestion").trim() || "suggestion",
    status: normalizedStatus,
    evidence_refs: normalizeEvidenceRefs(evidenceRefs),
    impact_notes: String(impactNotes ?? "").trim(),
  };

  return withFileLock(logPath, async () => {
    const entries = await readEntriesFromDisk(logPath);
    if (entries.some((entry) => entry.id === normalizedId)) {
      throw new Error(`learning_log_duplicate_id: ${normalizedId}`);
    }

    entries.push(normalizedEntry);
    await writeEntriesToDisk(logPath, entries);

    return normalizedEntry;
  });
}

export async function appendLearningSuggestion(options = {}) {
  return appendLearningItem(options);
}

export async function markSuggestionsAdoptedFromReport({
  logPath = DEFAULT_LEARNING_LOG_JSON_PATH,
  reportBody = "",
  reportPath = "",
  reportDate,
  impactNotes = "",
} = {}) {
  const markerIds = extractSuggestionMarkerIds(reportBody);
  if (markerIds.size === 0) {
    const pending = await getPendingSuggestions({ logPath });
    return {
      adopted_ids: [],
      marker_ids: [],
      pending_count: pending.length,
    };
  }

  const normalizedDate = normalizeDate(reportDate);
  const normalizedReportPath = String(reportPath ?? "").trim() || "(unknown-report-path)";
  const normalizedImpactNotes = String(impactNotes ?? "").trim();

  return withFileLock(logPath, async () => {
    const entries = await readEntriesFromDisk(logPath);
    const adoptedIds = [];

    for (const entry of entries) {
      if (entry.status !== "pending") continue;
      if (!markerIds.has(entry.id)) continue;

      entry.status = "adopted";
      const nextEvidenceRef = {
        report_path: normalizedReportPath,
        report_date: normalizedDate,
        marker: `suggestion:${entry.id}`,
      };
      const alreadyRecorded = entry.evidence_refs.some(
        (candidate) => candidate.report_path === nextEvidenceRef.report_path
          && candidate.report_date === nextEvidenceRef.report_date
          && candidate.marker === nextEvidenceRef.marker,
      );
      if (!alreadyRecorded) {
        entry.evidence_refs.push(nextEvidenceRef);
      }
      if (normalizedImpactNotes) {
        entry.impact_notes = normalizedImpactNotes;
      }
      adoptedIds.push(entry.id);
    }

    if (adoptedIds.length > 0) {
      await writeEntriesToDisk(logPath, entries);
    }

    return {
      adopted_ids: adoptedIds,
      marker_ids: [...markerIds].sort(),
      pending_count: entries.filter((entry) => entry.status === "pending").length,
    };
  });
}

export async function getPendingSuggestions({
  logPath = DEFAULT_LEARNING_LOG_JSON_PATH,
} = {}) {
  const entries = await readEntriesFromDisk(logPath);
  return entries.filter((entry) => entry.status === "pending");
}

export async function applySuggestionStatusUpdates({
  logPath = DEFAULT_LEARNING_LOG_JSON_PATH,
  updates = [],
} = {}) {
  const normalizedUpdates = Array.isArray(updates)
    ? updates.map((update, index) => {
      if (!update || typeof update !== "object" || Array.isArray(update)) {
        throw new Error(`learning_log_invalid_status_update: index=${index}`);
      }
      return {
        id: validateId(update.id),
        status: validateStatus(update.status),
        evidence_refs: normalizeEvidenceRefs(update.evidenceRefs ?? update.evidence_refs),
        impact_notes: String(update.impactNotes ?? update.impact_notes ?? "").trim(),
      };
    }).filter((update) => update.status !== "pending")
    : [];

  if (normalizedUpdates.length === 0) {
    const entries = await readEntriesFromDisk(logPath);
    return {
      applied_ids: [],
      skipped_ids: [],
      missing_ids: [],
      pending_count: entries.filter((entry) => entry.status === "pending").length,
    };
  }

  return withFileLock(logPath, async () => {
    const entries = await readEntriesFromDisk(logPath);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const appliedIds = [];
    const skippedIds = [];
    const missingIds = [];
    let changed = false;

    for (const update of normalizedUpdates) {
      const entry = byId.get(update.id);
      if (!entry) {
        missingIds.push(update.id);
        continue;
      }

      if (entry.status !== "pending" && entry.status !== update.status) {
        skippedIds.push(update.id);
        continue;
      }

      if (entry.status !== update.status) {
        entry.status = update.status;
        changed = true;
      }

      const nextEvidenceRefs = mergeEvidenceRefs(entry.evidence_refs, update.evidence_refs);
      if (nextEvidenceRefs.length !== entry.evidence_refs.length) {
        entry.evidence_refs = nextEvidenceRefs;
        changed = true;
      }

      if (update.impact_notes && entry.impact_notes !== update.impact_notes) {
        entry.impact_notes = update.impact_notes;
        changed = true;
      }

      appliedIds.push(update.id);
    }

    if (changed) {
      await writeEntriesToDisk(logPath, entries);
    }

    return {
      applied_ids: [...new Set(appliedIds)],
      skipped_ids: [...new Set(skippedIds)],
      missing_ids: [...new Set(missingIds)],
      pending_count: entries.filter((entry) => entry.status === "pending").length,
    };
  });
}

export async function appendLearningMarkdownSection({
  markdownPath = DEFAULT_LEARNING_LOG_MARKDOWN_PATH,
  date,
  learned = [],
  questions = [],
  skillChanges = [],
  predictions = [],
} = {}) {
  const normalizedDate = normalizeDate(date);

  const normalizedLearned = listItems(learned);
  const normalizedQuestions = listItems(questions);
  const normalizedSkillChanges = listItems(skillChanges);
  const normalizedPredictions = listItems(predictions);

  let current = "";
  try {
    current = await fsPromises.readFile(markdownPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (!current) {
    current = "# Analysis Learnings\n\n";
  }

  if (hasDateSection(current, normalizedDate)) {
    return {
      appended: false,
      path: markdownPath,
      date: normalizedDate,
    };
  }

  const section = buildDateSection({
    date: normalizedDate,
    learned: normalizedLearned,
    questions: normalizedQuestions,
    skillChanges: normalizedSkillChanges,
    predictions: normalizedPredictions,
  });

  const next = `${current.trimEnd()}\n\n${section}`;
  await writeTextAtomic(markdownPath, next);

  return {
    appended: true,
    path: markdownPath,
    date: normalizedDate,
  };
}
