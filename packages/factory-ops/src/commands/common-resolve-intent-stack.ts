import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { trim } from "../lib/cli-helpers.ts";
import { resolveFactoryContext } from "../lib/factory-context-resolver.ts";
import { resolveDestinationsFromContext, resolvePrimaryOpsRepo } from "../lib/factory-repo-identity.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DEFAULT_PLATFORM_INTENT_PATH = path.join(repoRoot, "docs/vision.md");

function readRequiredText(filePath = "", label = "intent") {
  const target = String(filePath || "").trim();
  if (!target) {
    throw new Error(`missing_${label}_path`);
  }
  try {
    return readFileSync(target, "utf8").trim();
  } catch (error) {
    throw new Error(`unable_to_read_${label}:${target}: ${String(error?.message || error)}`);
  }
}


function buildSummary({ factoryId = "", targetRepo = "", controlPlaneRepo = "", platformIntent = "", factoryIntent = "", workIntent = "" } = {}) {
  const sections = [];
  sections.push(`Platform intent governs the Astrochicken control plane for managed factories.`);
  if (factoryId || targetRepo || controlPlaneRepo) {
    sections.push(
      `Factory identity: factory_id=${factoryId || "(unresolved)"}, target_repo=${targetRepo || "(unresolved)"}, control_plane_repo=${controlPlaneRepo || "(unresolved)"}.`,
    );
  }
  if (factoryIntent) {
    sections.push(`Factory intent applies the platform doctrine to this specific factory instance.`);
  }
  if (workIntent) {
    sections.push(`Current work intent:\n${workIntent}`);
  }
  return sections.join("\n\n").trim();
}

export function resolveIntentStack({
  factoryRoot = "",
  configPath = "",
  platformIntentPath = "",
  factoryIntentPath = "",
  workIntent = "",
} = {}) {
  const context = resolveFactoryContext({
    factoryRoot,
    factoryConfigPath: configPath,
    requireTargetRepo: false,
  });

  const resolvedFactoryRoot = trim(context.factory_root);
  const resolvedPlatformIntentPath = trim(platformIntentPath) || DEFAULT_PLATFORM_INTENT_PATH;
  const resolvedFactoryIntentPath = trim(factoryIntentPath)
    || (resolvedFactoryRoot ? path.join(resolvedFactoryRoot, "INTENT.md") : "");

  const platformIntent = readRequiredText(resolvedPlatformIntentPath, "platform_intent");
  const factoryIntent = readRequiredText(resolvedFactoryIntentPath, "factory_intent");
  const resolvedWorkIntent = trim(workIntent);
  const identity = resolvePrimaryOpsRepo({
    context,
    factoryId: context.factory_id,
    requireResolved: false,
  });
  const resolvedTargetRepo = trim(identity.target_repo || context.target_repo);
  const resolvedDestinations = resolveDestinationsFromContext(context);

  return {
    platform_intent_path: resolvedPlatformIntentPath,
    factory_intent_path: resolvedFactoryIntentPath,
    platform_intent: platformIntent,
    factory_intent: factoryIntent,
    work_intent: resolvedWorkIntent,
    factory_id: trim(context.factory_id),
    target_repo: resolvedTargetRepo,
    destinations: resolvedDestinations,
    control_plane_repo: trim(context.control_plane_repo),
    intent_stack_summary: buildSummary({
      factoryId: context.factory_id,
      targetRepo: resolvedTargetRepo,
      controlPlaneRepo: context.control_plane_repo,
      platformIntent,
      factoryIntent,
      workIntent: resolvedWorkIntent,
    }),
  };
}
