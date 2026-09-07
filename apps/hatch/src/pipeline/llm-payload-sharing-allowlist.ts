import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(MODULE_DIR, "../../../../");
const DEFAULT_LLM_PAYLOAD_SHARING_ALLOWLIST_PATH = "docs/contracts/llm-payload-sharing-allowlist.json";

export interface LlmPayloadSharingAllowlistEntry {
	llm_path_ids: [string, string];
	reason: string;
}

export interface LlmPayloadSharingAllowlist {
	schema_version: "llm_payload_sharing_allowlist/v1";
	entries: LlmPayloadSharingAllowlistEntry[];
}

export function loadLlmPayloadSharingAllowlist(args?: { repoRootPath?: string; allowlistPath?: string }): LlmPayloadSharingAllowlist {
	const repoRootPath = resolve(args?.repoRootPath || DEFAULT_REPO_ROOT);
	const allowlistPath = resolve(repoRootPath, args?.allowlistPath || DEFAULT_LLM_PAYLOAD_SHARING_ALLOWLIST_PATH);
	const parsed = JSON.parse(readFileSync(allowlistPath, "utf-8")) as LlmPayloadSharingAllowlist;
	if (parsed?.schema_version !== "llm_payload_sharing_allowlist/v1" || !Array.isArray(parsed?.entries)) {
		throw new Error(`Invalid LLM payload sharing allowlist at ${allowlistPath}`);
	}
	return parsed;
}

export function buildAllowedPayloadSharingPairs(allowlist: LlmPayloadSharingAllowlist): Set<string> {
	const pairs = new Set<string>();
	for (const entry of allowlist.entries) {
		const [left, right] = [...(entry.llm_path_ids || [])].map((value) => String(value || "").trim()).sort();
		if (!left || !right) continue;
		pairs.add(`${left}::${right}`);
	}
	return pairs;
}
