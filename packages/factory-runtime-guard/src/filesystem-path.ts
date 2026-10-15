import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

// @context:security !critical Resolve existing links before processing '..'.
// Missing components remain usable for new targets, but dangling links and
// lookup errors must never turn into a lexical-only authorization fallback.
export function resolvePhysicalPath(candidatePath: string, { baseDir = process.cwd() }: { baseDir?: string } = {}): string {
  const value = candidatePath.trim();
  if (!value) return "";
  const base = path.isAbsolute(baseDir) ? baseDir : `${process.cwd()}${path.sep}${baseDir}`;
  const absolute = path.isAbsolute(value) ? value : `${base}${path.sep}${value}`;
  const root = path.parse(absolute).root;
  let current = realpathSync.native(root);
  const parts = absolute.slice(root.length).split(process.platform === "win32" ? /[\\/]/ : /\//);
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      current = path.dirname(current);
      continue;
    }
    const next = path.join(current, part);
    try {
      current = realpathSync.native(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        lstatSync(next);
      } catch (lookupError) {
        if ((lookupError as NodeJS.ErrnoException).code !== "ENOENT") throw lookupError;
        current = next;
        continue;
      }
      // lstat succeeding after realpath failed means an existing dangling link.
      throw new Error("filesystem_path_has_dangling_symlink");
    }
  }
  return current;
}
