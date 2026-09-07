import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename, relative } from "node:path";

interface ScenarioMeta {
	id: string;
	title: string;
	priority: string;
	scope: string;
	domain: string;
	tags: string[];
	context: string;
	path: string;
}

const MAX_LOADED_SCENARIOS = 2;

/**
 * Load scenarios matching a comma-separated list of paths.
 * Each path is relative to the provided registry root and can be:
 *   - "astrochicken"                         (all scenarios under scope)
 *   - "astrochicken/issue-triage"            (all scenarios under domain)
 *   - "astrochicken/issue-triage/triage-basic" (single scenario)
 *
 * Returns formatted context string for injection into prompts.
 */
export function loadScenarios(scenariosAttr: string, registryRoot: string): string {
	if (!scenariosAttr.trim()) return "";
	const resolvedRegistryRoot = String(registryRoot || "").trim();
	if (!resolvedRegistryRoot) {
		throw new Error("scenario registry root is required when loading scenarios");
	}

	const paths = scenariosAttr.split(",").map((p) => p.trim()).filter(Boolean);
	const scenarios: ScenarioMeta[] = [];

	for (const p of paths) {
		const fullPath = join(resolvedRegistryRoot, p);
		if (!existsSync(fullPath)) continue;

		const stat = statSync(fullPath);
		if (stat.isFile() && fullPath.endsWith("SCENARIO.md")) {
			const meta = parseScenarioFile(fullPath);
			if (meta) scenarios.push(meta);
		} else if (stat.isDirectory()) {
			collectScenarios(fullPath, scenarios);
		}
	}

	if (scenarios.length === 0) return "";

	// Sort by priority (critical > high > medium > low), then by id
	const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
	scenarios.sort((a, b) => {
		const pa = priorityOrder[a.priority] ?? 99;
		const pb = priorityOrder[b.priority] ?? 99;
		if (pa !== pb) return pa - pb;
		return a.id.localeCompare(b.id);
	});

	const selected = scenarios.slice(0, MAX_LOADED_SCENARIOS);

	const lines: string[] = [];
	lines.push(`=== Scenarios (${selected.length} loaded, ${scenarios.length} matched) ===`);
	lines.push("");

	for (const s of selected) {
		const tags = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
		lines.push(`[${s.id}] ${s.scope}/${s.domain} (priority: ${s.priority})${tags}`);
		lines.push(`  ${s.title}`);
		if (s.context) {
			lines.push(`  ${s.context}`);
		}
		lines.push(`  Full scenario: ${s.path}`);
		lines.push("");
	}

	return lines.join("\n");
}

/** Recursively find all SCENARIO.md files under a directory. */
function collectScenarios(dir: string, out: ScenarioMeta[]): void {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}

	for (const entry of entries) {
		const full = join(dir, entry);
		try {
			const stat = statSync(full);
			if (stat.isDirectory()) {
				// Check for SCENARIO.md directly in this dir
				const scenarioFile = join(full, "SCENARIO.md");
				if (existsSync(scenarioFile)) {
					const meta = parseScenarioFile(scenarioFile);
					if (meta) out.push(meta);
				}
				// Also recurse for deeper nesting
				collectScenarios(full, out);
			}
		} catch {
			continue;
		}
	}
}

/** Parse a SCENARIO.md file, extracting frontmatter and Context section. */
function parseScenarioFile(filePath: string): ScenarioMeta | null {
	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}

	// Parse YAML frontmatter
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return null;

	const fm = fmMatch[1];
	const id = extractYamlValue(fm, "id") || basename(join(filePath, ".."));
	const title = extractYamlValue(fm, "title") || id;
	const priority = extractYamlValue(fm, "priority") || "medium";
	const scope = extractYamlValue(fm, "scope") || "";
	const domain = extractYamlValue(fm, "domain") || "";
	const tagsRaw = extractYamlValue(fm, "tags");
	const tags = tagsRaw ? parseYamlArray(tagsRaw) : [];

	// Extract ## Context section
	const contextMatch = content.match(/^## Context\s*\n([\s\S]*?)(?=\n## |\n---|\Z)/m);
	const context = contextMatch ? contextMatch[1].trim() : "";

	return { id, title, priority, scope, domain, tags, context, path: filePath };
}

/** Extract a simple YAML scalar value. */
function extractYamlValue(yaml: string, key: string): string {
	const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
	const m = yaml.match(re);
	return m ? m[1].trim() : "";
}

/** Parse a YAML inline array like [a, b, c]. */
function parseYamlArray(s: string): string[] {
	const m = s.match(/^\[(.*)\]$/);
	if (!m) return [s];
	return m[1].split(",").map((v) => v.trim()).filter(Boolean);
}
