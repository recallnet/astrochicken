import { resolve } from "node:path";

function toCamelCase(flag) {
  return flag
    .replace(/^--?/, "")
    .split("-")
    .filter(Boolean)
    .map((segment, index) => (index === 0 ? segment : `${segment[0]?.toUpperCase() || ""}${segment.slice(1)}`))
    .join("");
}

function writeLine(stream, line) {
  stream.write(line.endsWith("\n") ? line : `${line}\n`);
}

export function parseArgs(argv = [], schema = []) {
  const entries = schema.map((entry) => ({
    ...entry,
    key: toCamelCase(entry.flag),
  }));
  const byFlag = new Map(entries.map((entry) => [entry.flag, entry]));
  const parsed = {};

  for (const entry of entries) {
    if (entry.multi) {
      parsed[entry.key] = [];
      continue;
    }
    if (entry.type === "boolean") {
      parsed[entry.key] = false;
    }
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    const entry = byFlag.get(arg);
    if (!entry) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    if (entry.type === "boolean") {
      if (entry.multi) {
        parsed[entry.key].push(true);
      } else {
        parsed[entry.key] = true;
      }
      continue;
    }

    const next = argv[index + 1];
    if (next === undefined || String(next).trim() === "") {
      throw new Error(`${entry.flag} requires a value`);
    }

    let value = String(next);
    if (entry.type === "path") {
      value = resolve(value);
    }

    if (entry.multi) {
      parsed[entry.key].push(value);
    } else {
      parsed[entry.key] = value;
    }
    index += 1;
  }

  for (const entry of entries) {
    if (!entry.required) continue;
    const value = parsed[entry.key];
    if (entry.multi && Array.isArray(value) && value.length === 0) {
      throw new Error(`${entry.flag} is required`);
    }
    if (!entry.multi && (value === undefined || value === false || value === "")) {
      throw new Error(`${entry.flag} is required`);
    }
  }

  return parsed;
}

export function emitResult({ ok, gate, message = "", diagnostics = [] }) {
  if (ok) {
    const suffix = String(message || "").trim();
    writeLine(process.stdout, `[${gate}] result=ok${suffix ? ` ${suffix}` : ""}`);
    return;
  }

  const failureDiagnostics = Array.isArray(diagnostics)
    ? diagnostics.map((diagnostic) => String(diagnostic))
    : [];
  if (failureDiagnostics.length === 0 && String(message || "").trim()) {
    failureDiagnostics.push(String(message).trim());
  }

  for (const diagnostic of failureDiagnostics) {
    writeLine(process.stderr, diagnostic);
  }
  writeLine(process.stderr, `[${gate}] result=fail diagnostics=${failureDiagnostics.length}`);
}

export async function main(checkFn, opts = {}) {
  const {
    argv = process.argv.slice(2),
    argSchema = [],
    gate,
    okMessage = "",
    usage,
    emit = emitResult,
  } = opts;

  try {
    const args = parseArgs(argv, argSchema);
    if (args.help) {
      if (usage) {
        const usageText = typeof usage === "function" ? usage() : String(usage);
        writeLine(process.stdout, usageText);
      }
      process.exit(0);
      return;
    }

    const result = await checkFn(args);
    if (result?.ok) {
      const message = typeof okMessage === "function"
        ? okMessage(args, result)
        : okMessage;
      emit({
        ok: true,
        gate,
        message: String(message || "").trim(),
        diagnostics: [],
        args,
        result,
      });
      process.exit(0);
      return;
    }

    emit({
      ok: false,
      gate,
      message: "",
      diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics : [],
      args,
      result,
    });
    process.exit(1);
  } catch (error) {
    emit({
      ok: false,
      gate,
      message: "",
      diagnostics: [error?.message || String(error)],
      args: {},
      result: null,
    });
    process.exit(1);
  }
}
