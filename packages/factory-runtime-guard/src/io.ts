import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function parseJsonLoose(raw: unknown, fallback: unknown): unknown {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function readJsonFile(path: string, fallback: unknown = null): unknown {
  try {
    const raw: string = readFileSync(path, "utf8");
    return parseJsonLoose(raw, fallback);
  } catch {
    return fallback;
  }
}

export function listRunDirs(runsDir: string): Array<{ name: string; path: string }> {
  try {
    return readdirSync(runsDir)
      .map((name: string) => ({ name, path: join(runsDir, name) }))
      .filter((x: { name: string; path: string }) => {
        try {
          return statSync(x.path).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}
