#!/usr/bin/env node

import {
  resolveHostRuntimePaths,
  getHostRuntimeStatus,
  doctorHostRuntime,
  runHostRuntime,
  resolveHostRuntimeVersion,
} from "./commands/host-runtime-lifecycle.ts";
import { verifyRuntimeSignature } from "./lib/runtime-signature.ts";

function printUsage() {
  process.stdout.write(`Usage:
  hatch-host status [--host-base-dir <path>] [--repo-root <path>] [--runtime-public-key-path <path>] [--runtime-signature <base64>] [--runtime-signature-key-id <id>]
  hatch-host doctor [--host-base-dir <path>] [--repo-root <path>] [--required-env A,B,C] [--runtime-public-key-path <path>] [--runtime-signature <base64>] [--runtime-signature-key-id <id>]
  hatch-host run [--host-base-dir <path>] [--repo-root <path>] [--once] [--runtime-public-key-path <path>] [--runtime-signature <base64>] [--runtime-signature-key-id <id>]
  hatch-host version
`);
}

function parseArgs(argv = []) {
  const args = [...argv];
  const command = String(args.shift() || "").trim();
  const options = {};
  while (args.length > 0) {
    const key = String(args.shift() || "");
    if (!key.startsWith("--")) continue;
    const normalizedKey = key.slice(2);
    const next = args[0] && !String(args[0]).startsWith("--") ? String(args.shift()) : "true";
    options[normalizedKey] = next;
  }
  return { command, options };
}

function parseCsv(value = "") {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function write(payload = {}, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = exitCode;
}

const { command, options } = parseArgs(process.argv.slice(2));

async function main() {
  if (!command || command === "--help" || command === "help") {
    printUsage();
    process.exitCode = 0;
    return;
  }

  if (command === "version" || command === "--version") {
    write({ ok: true, runtime_version: resolveHostRuntimeVersion(), binary: "hatch-host" }, 0);
    return;
  }

  const paths = resolveHostRuntimePaths({
    hostBaseDir: options["host-base-dir"] || "",
    repoRoot: options["repo-root"] || process.cwd(),
  });

  if (command === "status") {
    const out = getHostRuntimeStatus({
      paths,
      runtimeSignature: options["runtime-signature"] || "",
      runtimeSignatureKeyId: options["runtime-signature-key-id"] || "",
      trustPublicKeyPath: options["runtime-public-key-path"] || "",
      signedPayloadPath: options["runtime-signed-payload-path"] || "",
    });

    const runtimeSignature = String(options["runtime-signature"] || "").trim();
    const runtimeSignatureKeyId = String(options["runtime-signature-key-id"] || "").trim();
    const runtimePublicKeyPath = String(options["runtime-public-key-path"] || "").trim();
    if (runtimeSignature && runtimeSignatureKeyId && runtimePublicKeyPath && out.ok) {
      const verification = verifyRuntimeSignature({
        runtimeSignature,
        runtimeSignatureKeyId,
        trustPublicKeyPath: runtimePublicKeyPath,
        signedPayloadPath: options["runtime-signed-payload-path"] || out.manifest?.runtime_signature_payload_path || out.manifest?.runtime_entrypoint || "",
      });
      if (!verification.ok) {
        process.stderr.write(`[hatch-host] runtime signature verification failed: ${verification.errorCode || verification.error}\n`);
      }
    }

    write({
      ok: out.ok,
      status: out.status,
      message: out.message,
      error_code: out.errorCode,
      host_id: out.hostId,
      runtime_version: out.runtimeVersion,
      installation_count: out.installationCount,
      installations: out.installations || [],
      diagnostics: out.diagnostics || [],
      lease_summary: out.leaseSummary || {
        assigned_host_id: "",
        lease_owner: "",
        lease_expires_at: "",
        lease_ttl_sec: "",
        runtime_version: "",
      },
      scheduler: out.scheduler || {},
      wakeup: out.wakeup || {},
      host_queue_depth: out.host_queue_depth ?? 0,
      host_active_slots: out.host_active_slots ?? 0,
      host_max_active_slots: out.host_max_active_slots ?? 0,
      host_capacity_pressure: out.host_capacity_pressure ?? 0,
      host_pending_installations: out.host_pending_installations ?? 0,
      wake_sources: out.wake_sources || [],
      runtime_signature_status: out.runtime_signature_status || "",
      runtime_signature_error: out.runtime_signature_error || "",
      runtime_signature_hash: out.runtime_signature_hash || "",
      runtime_signature_key_id: out.runtime_signature_key_id || "",
    }, out.ok ? 0 : 1);
    return;
  }

  if (command === "doctor") {
    const out = doctorHostRuntime({
      paths,
      requiredEnv: parseCsv(options["required-env"] || ""),
      runtimeSignature: options["runtime-signature"] || "",
      runtimeSignatureKeyId: options["runtime-signature-key-id"] || "",
      trustPublicKeyPath: options["runtime-public-key-path"] || "",
      signedPayloadPath: options["runtime-signed-payload-path"] || "",
    });
    write({
      ok: out.ok,
      status: out.status,
      message: out.message,
      error_code: out.errorCode,
      host_id: out.hostId,
      runtime_version: out.runtimeVersion,
      installation_count: out.installationCount,
      checks: out.checks,
      runtime_signature_status: out.runtimeSignatureStatus || "",
      runtime_signature_error: out.runtimeSignatureError || "",
    }, out.ok ? 0 : 1);
    return;
  }

  if (command === "run") {
    const once = String(options.once || "").trim() === "true" || Object.prototype.hasOwnProperty.call(options, "once");
    const out = await runHostRuntime({ paths, once });
    const hasExecutionFailure = once
      && Array.isArray(out.executionResults)
      && out.executionResults.some((entry) => Number(entry?.exit_code) !== 0);
    const exitCode = out.ok && !hasExecutionFailure ? 0 : 1;

    if (!out.ok && String(out.errorCode || "") === "host_runtime_signature_invalid") {
      process.stderr.write(`[hatch-host] runtime signature verification failed: ${out.message}\n`);
    }

    write({
      ok: out.ok,
      status: out.status,
      message: out.message,
      error_code: out.errorCode,
      host_id: out.hostId,
      runtime_version: out.runtimeVersion,
      installation_count: out.installationCount,
      installations: out.installations || [],
      execution_results: out.executionResults || [],
      log_file: out.logFile || "",
      mode: out.mode || "",
      scheduler: out.scheduler || {},
      wakeup: out.wakeup || {},
      wake_sources: out.wakeSources || [],
      host_queue_depth: out.host_queue_depth ?? 0,
      host_active_slots: out.host_active_slots ?? 0,
      host_max_active_slots: out.host_max_active_slots ?? 0,
      host_capacity_pressure: out.host_capacity_pressure ?? 0,
      host_pending_installations: out.host_pending_installations ?? 0,
      runtime_signature_status: out.runtime_signature_status || out.manifest?.runtime_signature_status || "",
      runtime_signature_error: out.runtime_signature_error || out.manifest?.runtime_signature_error || "",
      runtime_signature_hash: out.runtime_signature_hash || out.manifest?.runtime_signature_hash || "",
      runtime_signature_key_id: out.runtime_signature_key_id || out.manifest?.runtime_signature_key_id || "",
    }, exitCode);
    return;
  }

  process.stderr.write(`unknown_command:${command}\n`);
  printUsage();
  process.exitCode = 1;
}

await main();
