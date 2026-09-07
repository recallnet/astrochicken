import { edgeLabel } from "./graph.js";

import type { Context } from "./context.js";
import type { Edge } from "./graph.js";

export function resolveFastRouteHasOpenBugs(context: Context): string {
	if (context.has("has_open_bugs")) {
		return normalizeBooleanString(context.get("has_open_bugs"));
	}
	if (context.has("open_bugs_present")) {
		return normalizeBooleanString(context.get("open_bugs_present"));
	}
	return "false";
}

export function derivePathTakenFromSelectedEdge(edge: Edge | undefined, nextId: string): string {
	const label = edge ? String(edgeLabel(edge) || "").trim().toLowerCase() : "";
	const target = String(nextId || "").trim().toLowerCase();
	const raw = label || target;
	if (!raw) return "";
	if (raw === "fast" || raw.includes("fast")) return "fast";
	if (raw === "moderate" || raw.includes("moderate") || raw === "medium" || raw.includes("medium")) return "moderate";
	if (raw === "full" || raw.includes("full")) return "full";
	return label ? raw : "";
}

function normalizeBooleanString(value: string): string {
	const normalized = String(value || "").trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" ? "true" : "false";
}
