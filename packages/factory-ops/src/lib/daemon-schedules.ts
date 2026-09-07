import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function trim(value = "") {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeCronField(field = "", { min = 0, max = 59 } = {}) {
  const raw = trim(field);
  if (!raw) return null;
  if (raw === "*") return () => true;

  const allowed = new Set();
  for (const token of raw.split(",")) {
    const entry = trim(token);
    if (!entry) continue;
    const stepMatch = entry.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? toPositiveInt(stepMatch[2], 0) : 0;
    const base = stepMatch ? trim(stepMatch[1]) : entry;

    const addValue = (value) => {
      if (value < min || value > max) return;
      allowed.add(value);
    };

    if (base === "*") {
      const increment = step || 1;
      for (let value = min; value <= max; value += increment) addValue(value);
      continue;
    }

    const rangeMatch = base.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = toPositiveInt(rangeMatch[1], -1);
      const end = toPositiveInt(rangeMatch[2], -1);
      if (start < 0 || end < 0 || start > end) continue;
      const increment = step || 1;
      for (let value = start; value <= end; value += increment) addValue(value);
      continue;
    }

    const numeric = toPositiveInt(base, -1);
    if (numeric >= 0) addValue(numeric);
  }

  return (value) => allowed.has(Number(value));
}

function getTimeZoneParts(dateLike, timeZone = "UTC") {
  const date = dateLike instanceof Date ? dateLike : new Date(String(dateLike));
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
    weekday: weekdayMap[byType.weekday] ?? -1,
  };
}

function cronMatchesDate({ cron = "", timeZone = "UTC", date = new Date() } = {}) {
  const fields = trim(cron).split(/\s+/);
  if (fields.length !== 5) return false;
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  const minuteMatcher = normalizeCronField(minuteField, { min: 0, max: 59 });
  const hourMatcher = normalizeCronField(hourField, { min: 0, max: 23 });
  const dayMatcher = normalizeCronField(dayField, { min: 1, max: 31 });
  const monthMatcher = normalizeCronField(monthField, { min: 1, max: 12 });
  const weekdayMatcher = normalizeCronField(weekdayField, { min: 0, max: 6 });

  if (!minuteMatcher || !hourMatcher || !dayMatcher || !monthMatcher || !weekdayMatcher) return false;

  const parts = getTimeZoneParts(date, timeZone);
  return minuteMatcher(parts.minute)
    && hourMatcher(parts.hour)
    && dayMatcher(parts.day)
    && monthMatcher(parts.month)
    && weekdayMatcher(parts.weekday);
}

function floorToMinute(dateLike) {
  const date = dateLike instanceof Date ? new Date(dateLike.getTime()) : new Date(String(dateLike));
  date.setUTCSeconds(0, 0);
  return date;
}

export function findLatestMatchingScheduleSlot({
  cron = "",
  timeZone = "UTC",
  now = new Date(),
  lookbackMinutes = 7 * 24 * 60,
} = {}) {
  const cursor = floorToMinute(now);
  const maxLookback = Math.max(1, toPositiveInt(lookbackMinutes, 7 * 24 * 60));
  for (let offset = 0; offset <= maxLookback; offset += 1) {
    const candidate = new Date(cursor.getTime() - (offset * 60 * 1000));
    if (cronMatchesDate({ cron, timeZone, date: candidate })) {
      return candidate.toISOString();
    }
  }
  return "";
}

export function evaluateScheduledJob({
  job = {},
  state = {},
  now = new Date(),
  lookbackMinutes,
} = {}) {
  const id = trim(job?.id);
  const cron = trim(job?.cron);
  const timeZone = trim(job?.time_zone || job?.timeZone || "UTC") || "UTC";
  if (!id || !cron) {
    return { due: false, scheduled_at: "", reason: "invalid_job" };
  }

  const scheduledAt = findLatestMatchingScheduleSlot({
    cron,
    timeZone,
    now,
    lookbackMinutes,
  });
  if (!scheduledAt) {
    return { due: false, scheduled_at: "", reason: "no_matching_slot" };
  }

  const lastScheduledAt = trim(state?.last_scheduled_at);
  if (lastScheduledAt && lastScheduledAt >= scheduledAt) {
    return { due: false, scheduled_at: scheduledAt, reason: "already_ran_current_slot" };
  }

  return { due: true, scheduled_at: scheduledAt, reason: "due" };
}

export function formatScheduledJobLocalDate({
  scheduledAt = "",
  timeZone = "UTC",
} = {}) {
  if (!trim(scheduledAt)) return "";
  const parts = getTimeZoneParts(scheduledAt, timeZone);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

export function resolveScheduledJobs(config = {}) {
  const schedules = isPlainObject(config?.schedules) ? config.schedules : {};
  const jobs = Array.isArray(schedules.jobs) ? schedules.jobs : [];
  return jobs
    .filter((job) => isPlainObject(job) && trim(job.id) && trim(job.cron) && job.enabled !== false)
    .map((job) => ({ ...job }));
}

export function readScheduledJobsState(statePath = "") {
  if (!trim(statePath) || !existsSync(statePath)) return { jobs: {} };
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    if (!isPlainObject(parsed) || !isPlainObject(parsed.jobs)) return { jobs: {} };
    return parsed;
  } catch {
    return { jobs: {} };
  }
}

export function writeScheduledJobsState(statePath = "", state = {}) {
  if (!trim(statePath)) return;
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
