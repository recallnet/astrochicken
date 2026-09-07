import { graphLabel, nodeLabel } from "./graph.js";

import type { Graph } from "./graph.js";
import type { EventHandler } from "@recallnet/factory-telemetry";

const ICONS: Record<string, string> = {
	pending: "·",
	running: "▶",
	done: "✓",
	error: "✗",
	retry: "↻",
};

export function createLiveStatusHandler(graph: Graph, runId?: string): EventHandler {
	const nodes = Object.values(graph.nodes)
		.map((n) => ({ id: n.id, label: nodeLabel(n) }))
		.sort((a, b) => a.label.localeCompare(b.label));
	const status = new Map<string, string>();
	for (const n of nodes) status.set(n.id, "pending");

	const name = graphLabel(graph) || graph.name || "pipeline";

	const render = () => {
		if (!process.stdout.isTTY) return;
		const counts = { pending: 0, running: 0, done: 0, error: 0, retry: 0 };
		for (const v of status.values()) counts[v as keyof typeof counts]++;
		process.stdout.write("\x1b[2J\x1b[H");
		console.log(`Hatch live view: ${name}${runId ? ` (${runId})` : ""}`);
		console.log(
			`Status: ${counts.done}/${nodes.length} done • ${counts.running} running • ${counts.error} failed • ${counts.retry} retry`,
		);
		console.log("");
		for (const n of nodes) {
			const s = status.get(n.id) || "pending";
			const icon = ICONS[s] || "?";
			console.log(`${icon} ${n.label}`);
		}
	};

	render();

	return (e) => {
		switch (e.kind) {
			case "stage.start":
				if (e.nodeId) status.set(e.nodeId, "running");
				render();
				break;
			case "stage.finish":
				if (e.nodeId) status.set(e.nodeId, "done");
				render();
				break;
			case "stage.error":
				if (e.nodeId) status.set(e.nodeId, "error");
				render();
				break;
			case "stage.retry":
				if (e.nodeId) status.set(e.nodeId, "retry");
				render();
				break;
			case "stage.skip":
				if (e.nodeId) status.set(e.nodeId, "error");
				render();
				break;
			case "pipeline.finish":
			case "pipeline.error":
			case "pipeline.suspend":
				render();
				break;
		}
	};
}
