import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function trim(value = "") {
  return String(value || "").trim();
}

export function writeAtomicJson(targetPath = "", payload = {}, { nowFn = Date.now } = {}) {
  const normalizedPath = resolve(trim(targetPath));
  const parentDir = dirname(normalizedPath);
  mkdirSync(parentDir, { recursive: true });

  const tmpPath = `${normalizedPath}.tmp-${process.pid}-${Number(nowFn())}`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmpPath, normalizedPath);
  return normalizedPath;
}
