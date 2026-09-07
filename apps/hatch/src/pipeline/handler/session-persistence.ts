import { resolve } from "node:path";

import type { Context } from "../context.js";

/** Sanitize a session key for use in file paths. */
export function sanitizeSessionPath(value: string): string {
	return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Resolve the stable session key for a node execution. */
export function resolveSessionKey(explicitSessionId: string, fallbackSessionId: string): string {
	const explicit = String(explicitSessionId || "").trim();
	return explicit || String(fallbackSessionId || "").trim();
}

/** Resolve a persistent session directory when the run exposes one. */
export function resolvePersistentSessionDir(
	ctx: Context,
	sessionKey: string,
	options: { preferWaveSessions?: boolean } = {},
): string {
	const waveSessionsDir = options.preferWaveSessions ? ctx.get("wave_sessions_dir") : "";
	const runSessionsDir = ctx.get("__run_sessions_dir");
	const baseDir = waveSessionsDir || runSessionsDir;
	if (!baseDir) return "";
	return resolve(baseDir, sanitizeSessionPath(sessionKey));
}
