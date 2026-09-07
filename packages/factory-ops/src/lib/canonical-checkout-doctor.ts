import os from "node:os";

import { persistCanonicalCheckoutPacket } from "./canonical-checkout-doctor-packet.ts";
import {
  ensureCanonicalWorktree,
  ensureMirrorRepo,
  inspectCanonicalCheckoutState,
  loadDoctorContext,
  verifyRuntimeStartup,
} from "./canonical-checkout-doctor-shared.ts";
import { trim } from "./cli-helpers.ts";
import { DEFAULT_GLOBAL_CLI_LINK_NAME, relinkGlobalCli } from "./global-cli-link.ts";

export function inspectCanonicalCheckout({
  repoRoot = process.cwd(),
  env = process.env,
  homeDir = os.homedir(),
  linkDir = "",
  linkName = DEFAULT_GLOBAL_CLI_LINK_NAME,
} = {}) {
  const context = loadDoctorContext({ repoRoot, env, homeDir, linkDir, linkName });
  const checks = inspectCanonicalCheckoutState(context);
  return {
    ok: checks.every((check) => check.ok),
    context,
    checks,
  };
}

function persistDeadendPacket(inspection = {}, deadendReason = "", detail = "") {
  return persistCanonicalCheckoutPacket({
    context: inspection.context,
    failedChecks: inspection.checks.filter((check) => !check.ok),
    deadendReason,
    detail,
  });
}

export function repairCanonicalCheckout({
  repoRoot = process.cwd(),
  env = process.env,
  homeDir = os.homedir(),
  linkDir = "",
  linkName = DEFAULT_GLOBAL_CLI_LINK_NAME,
  relinkGlobalCliFn = relinkGlobalCli,
  verifyRuntimeStartupFn = verifyRuntimeStartup,
} = {}) {
  const inspection = inspectCanonicalCheckout({
    repoRoot,
    env,
    homeDir,
    linkDir,
    linkName,
  });
  if (inspection.ok) {
    return { ...inspection, repaired: true, status: "already_healthy" };
  }

  const context = inspection.context;
  if (!trim(context.canonical_checkout_path) || !trim(context.source_repo_path)) {
    return {
      ...inspection,
      repaired: false,
      status: "deadend",
      packet: persistDeadendPacket(
        inspection,
        !trim(context.canonical_checkout_path)
          ? "canonical_checkout_path_missing"
          : "git_source_unavailable",
      ),
    };
  }

  const mirror = ensureMirrorRepo({
    mirrorPath: context.mirror_path,
    sourceRepoPath: context.source_repo_path,
  });
  if (!mirror.ok) {
    return {
      ...inspection,
      repaired: false,
      status: "deadend",
      packet: persistDeadendPacket(inspection, mirror.reason, mirror.detail),
    };
  }

  const canonicalRepair = ensureCanonicalWorktree({
    canonicalCheckoutPath: context.canonical_checkout_path,
    mirrorPath: context.mirror_path,
  });
  if (!canonicalRepair.ok) {
    return {
      ...inspection,
      repaired: false,
      status: "deadend",
      packet: persistDeadendPacket(inspection, canonicalRepair.reason, canonicalRepair.detail),
    };
  }

  const relink = relinkGlobalCliFn({
    repoRoot: context.canonical_checkout_path,
    env,
    homeDir,
    linkDir,
    linkName,
  });
  if (!relink?.ok) {
    return {
      ...inspection,
      repaired: false,
      status: "deadend",
      packet: persistDeadendPacket(inspection, trim(relink?.reason || "relink_failed")),
    };
  }

  const runtime = verifyRuntimeStartupFn({
    canonicalCheckoutPath: context.canonical_checkout_path,
  });
  if (!runtime?.ok) {
    return {
      ...inspection,
      repaired: false,
      status: "deadend",
      packet: persistDeadendPacket(
        inspection,
        trim(runtime?.reason || "runtime_startup_probe_failed"),
        trim(runtime?.detail || ""),
      ),
    };
  }

  const finalInspection = inspectCanonicalCheckout({
    repoRoot,
    env,
    homeDir,
    linkDir,
    linkName,
  });
  return {
    ...finalInspection,
    repaired: finalInspection.ok,
    status: finalInspection.ok ? "repaired" : "deadend",
    relink,
    runtime,
    packet: finalInspection.ok
      ? null
      : persistDeadendPacket(finalInspection, "post_repair_validation_failed"),
  };
}
