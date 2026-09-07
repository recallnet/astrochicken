import {
	nodeHandlerType,
	outgoingEdges,
	edgeCondition,
	edgeLabel,
} from "../pipeline/graph.js";

import type { Graph } from "../pipeline/graph.js";

export function cmdGraph(args: string[], parseGraph: (file: string) => Graph): void {
	if (args.length < 2) {
		console.error("usage: hatch graph <subcommand> <file.dot>");
		console.error("");
		console.error("Subcommands:");
		console.error("  tree    Show pipeline node tree");
		console.error("  deps    Show node dependencies (incoming/outgoing edges)");
		process.exit(1);
	}

	const sub = args[0];
	const file = args[1];
	const graph = parseGraph(file);

	switch (sub) {
		case "tree":
			printTree(graph);
			break;
		case "deps":
			printDeps(graph);
			break;
		default:
			console.error(`unknown graph subcommand: ${sub}`);
			process.exit(1);
	}
}

function printTree(graph: Graph): void {
	console.log(`Pipeline: ${graph.name || "(unnamed)"}`);
	console.log("");

	const startNode = Object.values(graph.nodes).find((n) => nodeHandlerType(n) === "start");
	if (!startNode) {
		console.error("No start node found.");
		return;
	}

	const visited = new Set<string>();
	const queue: { id: string; depth: number }[] = [{ id: startNode.id, depth: 0 }];

	while (queue.length > 0) {
		const { id, depth } = queue.shift()!;
		if (visited.has(id)) continue;
		visited.add(id);

		const node = graph.nodes[id];
		if (!node) continue;

		const indent = "  ".repeat(depth);
		const handlerType = nodeHandlerType(node);
		const label = node.attrs["label"] || node.id;
		const suffix = handlerType !== node.id ? ` (${handlerType})` : "";

		console.log(`${indent}${label}${suffix}`);

		for (const edge of outgoingEdges(graph, id)) {
			const cond = edgeCondition(edge);
			const lbl = edgeLabel(edge);
			const condStr = cond ? ` [${cond}]` : "";
			const lblStr = lbl ? ` "${lbl}"` : "";

			if (condStr || lblStr) {
				const edgeIndent = "  ".repeat(depth + 1);
				console.log(`${edgeIndent}→${lblStr}${condStr}`);
			}

			queue.push({ id: edge.to, depth: depth + 1 });
		}
	}

	const unreachable = Object.keys(graph.nodes).filter((id) => !visited.has(id));
	if (unreachable.length > 0) {
		console.log("");
		console.log("Unreachable nodes:");
		for (const id of unreachable) {
			console.log(`  ${id}`);
		}
	}
}

function printDeps(graph: Graph): void {
	console.log(`Pipeline: ${graph.name || "(unnamed)"}`);
	console.log("");

	for (const node of Object.values(graph.nodes)) {
		const handlerType = nodeHandlerType(node);
		console.log(`${node.id} (${handlerType})`);

		const incoming = graph.edges.filter((e) => e.to === node.id);
		const outgoing = outgoingEdges(graph, node.id);

		if (incoming.length > 0) {
			console.log("  ← " + incoming.map((e) => e.from).join(", "));
		}
		if (outgoing.length > 0) {
			for (const e of outgoing) {
				const cond = edgeCondition(e);
				const condStr = cond ? ` [${cond}]` : "";
				console.log(`  → ${e.to}${condStr}`);
			}
		}
		console.log("");
	}
}
