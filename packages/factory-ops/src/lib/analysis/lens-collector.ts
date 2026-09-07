import { promises as fsPromises } from "node:fs";
import path from "node:path";

import { collectDailyInsightData } from "./collectors.ts";
import {
  DEFAULT_LEARNING_LOG_JSON_PATH,
  getPendingSuggestions,
} from "./learning-log.ts";

function asString(value) {
  return String(value ?? "").trim();
}

function parseJsonSafe(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function toIsoDate(value) {
  const parsed = new Date(String(value || "").trim());
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function shiftIsoDate(isoDate = "", deltaDays = 0) {
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + Number(deltaDays || 0));
  return parsed.toISOString().slice(0, 10);
}

async function readJsonFile(filePath = "", runtimeFs = fsPromises) {
  try {
    const raw = await runtimeFs.readFile(filePath, "utf8");
    const parsed = parseJsonSafe(raw, null);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function readAgentLearnings({
  repoPath = process.cwd(),
  analysisEnd = "",
  runtimeFs = fsPromises,
} = {}) {
  const learningsPath = path.join(repoPath, "AGENT-LEARNINGS.md");
  try {
    const raw = await runtimeFs.readFile(learningsPath, "utf8");
    const cutoff = new Date(String(analysisEnd || "").trim());
    if (Number.isNaN(cutoff.getTime())) {
      return { path: learningsPath, entries: [] };
    }
    cutoff.setUTCDate(cutoff.getUTCDate() - 7);

    const sections = String(raw || "")
      .split(/^###\s+/m)
      .map((section) => section.trim())
      .filter(Boolean);

    const entries = sections
      .map((section) => {
        const [heading, ...bodyParts] = section.split("\n");
        const headingText = asString(heading);
        const date = toIsoDate(headingText);
        if (!date) return null;
        const sectionDate = new Date(`${date}T00:00:00.000Z`);
        if (sectionDate < cutoff) return null;
        return {
          heading: headingText,
          date,
          body: bodyParts.join("\n").trim(),
        };
      })
      .filter(Boolean);

    return { path: learningsPath, entries };
  } catch {
    return { path: learningsPath, entries: [] };
  }
}

async function readPastLensOutputs({
  repoPath = process.cwd(),
  date = "",
  runtimeFs = fsPromises,
} = {}) {
  const reportDir = path.join(repoPath, "reports", "lens");
  const entries = [];
  for (let offset = -1; offset >= -3; offset -= 1) {
    const priorDate = shiftIsoDate(date, offset);
    if (!priorDate) continue;
    const reportPath = path.join(reportDir, `${priorDate}.json`);
    const parsed = await readJsonFile(reportPath, runtimeFs);
    if (!parsed) continue;
    entries.push({
      date: priorDate,
      path: reportPath,
      report: parsed,
    });
  }
  return entries;
}

async function readInventoryFile({
  repoPath = process.cwd(),
  relativePath = "",
  runtimeFs = fsPromises,
} = {}) {
  const filePath = path.join(repoPath, relativePath);
  const parsed = await readJsonFile(filePath, runtimeFs);
  return {
    path: filePath,
    ...(parsed && typeof parsed === "object" ? parsed : {}),
  };
}

export async function collectLensData({
  date = "",
  repo = "",
  factoryId = "mothership",
  analysisStart = "",
  analysisEnd = "",
  runsDir = ".hatch/runs",
  repoPath = process.cwd(),
  learningLogPath = DEFAULT_LEARNING_LOG_JSON_PATH,
  collectDailyInsightDataFn = collectDailyInsightData,
  runtimeFs = fsPromises,
  ghJsonFn,
  gitLogFn,
  readFileFn,
  readdirFn,
  execFileFn,
  fetchFn,
  langfuseUrl,
  langfuseKey,
  langfuseRetries,
} = {}) {
  const base = await collectDailyInsightDataFn({
    repo,
    analysisStart,
    analysisEnd,
    runsDir,
    repoPath,
    ghJsonFn,
    gitLogFn,
    readFileFn,
    readdirFn,
    execFileFn,
    fetchFn,
    langfuseUrl,
    langfuseKey,
    langfuseRetries,
  });

  const agentLearnings = await readAgentLearnings({ repoPath, analysisEnd, runtimeFs });
  const pastLensOutputs = await readPastLensOutputs({ repoPath, date, runtimeFs });
  const pendingSuggestions = await getPendingSuggestions({ logPath: learningLogPath });
  const llmInventory = await readInventoryFile({
    repoPath,
    relativePath: path.join("factories", factoryId, "inventory", "llm-role-session-baseline.json"),
    runtimeFs,
  });
  const goalDecompositionTimeouts = await readInventoryFile({
    repoPath,
    relativePath: path.join("factories", factoryId, "inventory", "goal-decomposition-timeouts.json"),
    runtimeFs,
  });

  return {
    base,
    agent_learnings: agentLearnings,
    past_lens_outputs: pastLensOutputs,
    pending_suggestions: pendingSuggestions,
    llm_inventory: llmInventory,
    goal_decomposition_timeouts: goalDecompositionTimeouts,
  };
}
