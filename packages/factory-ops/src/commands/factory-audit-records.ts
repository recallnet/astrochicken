import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readAuditRecords } from "../lib/audit-trail.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function pad(value = "", width = 0) {
  const text = String(value || "");
  if (text.length >= width) return text;
  return `${text}${" ".repeat(width - text.length)}`;
}

function truncate(value = "", max = 0) {
  const text = String(value || "");
  if (!max || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function formatFactoryAuditRecordsHuman(records = []) {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) {
    return "No matching audit records.";
  }

  const headers = {
    timestamp: "timestamp",
    action: "action",
    instance: "instance",
    host: "host",
    run: "run",
    destination: "destination",
    target: "target",
  };

  const rows = list.map((entry) => ({
    timestamp: trim(entry.timestamp),
    action: trim(entry.action),
    instance: trim(entry.instance_id),
    host: trim(entry.host_id),
    run: trim(entry.run_id),
    destination: trim(entry.destination_name),
    target: `${trim(entry.target_repo)}:${trim(entry.target_ref)}`,
  }));

  const widths = {
    timestamp: Math.max(headers.timestamp.length, ...rows.map((row) => row.timestamp.length)),
    action: Math.max(headers.action.length, ...rows.map((row) => row.action.length)),
    instance: Math.max(headers.instance.length, ...rows.map((row) => row.instance.length)),
    host: Math.max(headers.host.length, ...rows.map((row) => row.host.length)),
    run: Math.max(headers.run.length, ...rows.map((row) => row.run.length)),
    destination: Math.max(headers.destination.length, ...rows.map((row) => row.destination.length)),
  };

  const lines = [];
  lines.push([
    pad(headers.timestamp, widths.timestamp),
    pad(headers.action, widths.action),
    pad(headers.instance, widths.instance),
    pad(headers.host, widths.host),
    pad(headers.run, widths.run),
    pad(headers.destination, widths.destination),
    headers.target,
  ].join("  "));

  lines.push([
    "-".repeat(widths.timestamp),
    "-".repeat(widths.action),
    "-".repeat(widths.instance),
    "-".repeat(widths.host),
    "-".repeat(widths.run),
    "-".repeat(widths.destination),
    "-".repeat(headers.target.length),
  ].join("  "));

  for (const row of rows) {
    lines.push([
      pad(row.timestamp, widths.timestamp),
      pad(row.action, widths.action),
      pad(truncate(row.instance, 40), widths.instance),
      pad(truncate(row.host, 24), widths.host),
      pad(truncate(row.run, 20), widths.run),
      pad(truncate(row.destination, 20), widths.destination),
      truncate(row.target, 96),
    ].join("  "));
  }

  return lines.join("\n");
}

export function readFactoryAuditRecords({
  instanceId = "",
  since = "",
  until = "",
  action = "",
  hostId = "",
  hostBaseDir = "",
  logPath = "",
} = {}) {
  const { records, log_paths: logPaths } = readAuditRecords({
    instanceId,
    since,
    until,
    actionFilter: action,
    hostId,
    hostBaseDir,
    logPath,
  });

  return {
    schema: "factory.audit_records.report.v1",
    ok: true,
    filters: {
      instance_id: trim(instanceId),
      since: trim(since),
      to: trim(until),
      action: trim(action),
      host_id: trim(hostId),
      host_base_dir: trim(hostBaseDir),
      log_path: trim(logPath),
    },
    count: records.length,
    log_paths: logPaths,
    records,
  };
}

function parseArgv(argv = []) {
  const parsed = {
    instanceId: "",
    since: "",
    until: "",
    action: "",
    hostId: "",
    hostBaseDir: "",
    logPath: "",
    json: false,
  };

  const args = Array.isArray(argv) ? [...argv] : [];
  for (let index = 0; index < args.length; index += 1) {
    const entry = trim(args[index]);
    if (!entry) continue;

    if (entry === "--json") {
      parsed.json = true;
      continue;
    }

    if (!entry.startsWith("--")) continue;

    const separator = entry.indexOf("=");
    const hasInlineValue = separator >= 0;
    const key = hasInlineValue ? entry.slice(2, separator).trim() : entry.slice(2).trim();
    const value = hasInlineValue
      ? entry.slice(separator + 1).trim()
      : trim(args[index + 1]);

    if (!hasInlineValue && value && !value.startsWith("--")) {
      index += 1;
    }

    if (key === "instance-id") parsed.instanceId = value;
    else if (key === "since") parsed.since = value;
    else if (key === "to") parsed.until = value;
    else if (key === "until") parsed.until = value;
    else if (key === "action") parsed.action = value;
    else if (key === "host-id") parsed.hostId = value;
    else if (key === "host-base-dir") parsed.hostBaseDir = value;
    else if (key === "log-path") parsed.logPath = value;
  }

  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const flags = parseArgv(argv);
  const out = readFactoryAuditRecords(flags);
  if (flags.json) {
    process.stdout.write(JSON.stringify(out));
  } else {
    process.stdout.write(`${formatFactoryAuditRecordsHuman(out.records)}\n`);
  }
}

const isDirectRun = (() => {
  const current = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
  return current === invoked;
})();

if (isDirectRun) {
  await main();
}
