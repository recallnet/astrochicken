import { describe, it, expect } from "vitest";
import {
	RECOVERY_OWNER_ATTRIBUTE,
	RECOVERY_OWNER_SUPERVISOR,
	RECOVERY_SINK_TYPE_ATTRIBUTE,
	RECOVERY_OWNER_MISSING_CODE,
	RECOVERY_SINK_TYPES,
	extractRecoveryMetadata,
	extractGraphRecoveryMetadata,
	isSupervisorOwnedRecovery,
	isApprovedRecoverySink,
	recoverySinkType,
	type RecoveryNodeMetadata,
} from "./recovery-contract.js";
import type { Graph, Node } from "./graph.js";

function makeNode(id: string, attrs: Record<string, string> = {}): Node {
	return { id, attrs };
}

function makeGraph(nodes: Node[]): Graph {
	const nodesMap: Record<string, Node> = {};
	for (const n of nodes) nodesMap[n.id] = n;
	return { name: "test", attrs: {}, nodes: nodesMap, edges: [] };
}

function makeMeta(overrides: Partial<RecoveryNodeMetadata> = {}): RecoveryNodeMetadata {
	return {
		nodeId: "n",
		nodeLabel: "n",
		recoveryOwnerRaw: "",
		recoverySinkTypeRaw: "",
		hasRecoveryOwner: false,
		hasRecoverySinkType: false,
		...overrides,
	};
}

describe("constants", () => {
	it("RECOVERY_SINK_TYPES contains wait and terminal", () => {
		expect(RECOVERY_SINK_TYPES).toContain("wait");
		expect(RECOVERY_SINK_TYPES).toContain("terminal");
		expect(RECOVERY_SINK_TYPES).toHaveLength(2);
	});

	it("constant values are stable", () => {
		expect(RECOVERY_OWNER_ATTRIBUTE).toBe("recovery_owner");
		expect(RECOVERY_OWNER_SUPERVISOR).toBe("supervisor");
		expect(RECOVERY_SINK_TYPE_ATTRIBUTE).toBe("recovery_sink_type");
		expect(RECOVERY_OWNER_MISSING_CODE).toBe("recovery.owner.missing");
	});
});

describe("extractRecoveryMetadata", () => {
	it("extracts supervisor owner and wait sink", () => {
		const node = makeNode("n1", { recovery_owner: "supervisor", recovery_sink_type: "wait" });
		const meta = extractRecoveryMetadata(node);
		expect(meta.nodeId).toBe("n1");
		expect(meta.nodeLabel).toBe("n1"); // falls back to id when no label attr
		expect(meta.recoveryOwnerRaw).toBe("supervisor");
		expect(meta.recoverySinkTypeRaw).toBe("wait");
		expect(meta.hasRecoveryOwner).toBe(true);
		expect(meta.hasRecoverySinkType).toBe(true);
	});

	it("uses label attr for nodeLabel when present", () => {
		const node = makeNode("n1", { label: "My Label" });
		const meta = extractRecoveryMetadata(node);
		expect(meta.nodeLabel).toBe("My Label");
	});

	it("reports missing attrs as hasRecoveryOwner=false, hasRecoverySinkType=false", () => {
		const node = makeNode("n2", {});
		const meta = extractRecoveryMetadata(node);
		expect(meta.hasRecoveryOwner).toBe(false);
		expect(meta.hasRecoverySinkType).toBe(false);
		expect(meta.recoveryOwnerRaw).toBe("");
		expect(meta.recoverySinkTypeRaw).toBe("");
	});

	it("normalizes whitespace and case", () => {
		const node = makeNode("n3", { recovery_owner: " Supervisor ", recovery_sink_type: " Terminal " });
		const meta = extractRecoveryMetadata(node);
		expect(meta.recoveryOwnerRaw).toBe("supervisor");
		expect(meta.recoverySinkTypeRaw).toBe("terminal");
	});

	it("handles terminal sink type", () => {
		const node = makeNode("n4", { recovery_sink_type: "terminal" });
		const meta = extractRecoveryMetadata(node);
		expect(meta.recoverySinkTypeRaw).toBe("terminal");
		expect(meta.hasRecoverySinkType).toBe(true);
	});

	it("accepts optional graph context without error", () => {
		const node = makeNode("n5", { recovery_owner: "supervisor" });
		const graph = makeGraph([node]);
		const meta = extractRecoveryMetadata(node, graph);
		expect(meta.recoveryOwnerRaw).toBe("supervisor");
	});
});

describe("extractGraphRecoveryMetadata", () => {
	it("returns empty map for empty graph", () => {
		const graph = makeGraph([]);
		const result = extractGraphRecoveryMetadata(graph);
		expect(result.size).toBe(0);
	});

	it("returns entry per node", () => {
		const n1 = makeNode("a", { recovery_owner: "supervisor" });
		const n2 = makeNode("b", { recovery_sink_type: "wait" });
		const n3 = makeNode("c", {});
		const graph = makeGraph([n1, n2, n3]);
		const result = extractGraphRecoveryMetadata(graph);
		expect(result.size).toBe(3);
		expect(result.get("a")!.recoveryOwnerRaw).toBe("supervisor");
		expect(result.get("b")!.recoverySinkTypeRaw).toBe("wait");
		expect(result.get("c")!.hasRecoveryOwner).toBe(false);
	});
});

describe("isSupervisorOwnedRecovery", () => {
	it("returns true for supervisor", () => {
		expect(isSupervisorOwnedRecovery(makeMeta({ recoveryOwnerRaw: "supervisor" }))).toBe(true);
	});

	it("returns false for other owner", () => {
		expect(isSupervisorOwnedRecovery(makeMeta({ recoveryOwnerRaw: "other" }))).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isSupervisorOwnedRecovery(makeMeta({ recoveryOwnerRaw: "" }))).toBe(false);
	});
});

describe("isApprovedRecoverySink", () => {
	it("returns true for wait", () => {
		expect(isApprovedRecoverySink(makeMeta({ recoverySinkTypeRaw: "wait" }))).toBe(true);
	});

	it("returns true for terminal", () => {
		expect(isApprovedRecoverySink(makeMeta({ recoverySinkTypeRaw: "terminal" }))).toBe(true);
	});

	it("returns false for invalid", () => {
		expect(isApprovedRecoverySink(makeMeta({ recoverySinkTypeRaw: "invalid" }))).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isApprovedRecoverySink(makeMeta({ recoverySinkTypeRaw: "" }))).toBe(false);
	});
});

describe("recoverySinkType", () => {
	it("returns wait for wait", () => {
		expect(recoverySinkType(makeMeta({ recoverySinkTypeRaw: "wait" }))).toBe("wait");
	});

	it("returns terminal for terminal", () => {
		expect(recoverySinkType(makeMeta({ recoverySinkTypeRaw: "terminal" }))).toBe("terminal");
	});

	it("returns empty string for invalid", () => {
		expect(recoverySinkType(makeMeta({ recoverySinkTypeRaw: "invalid" }))).toBe("");
	});

	it("returns empty string for empty", () => {
		expect(recoverySinkType(makeMeta({ recoverySinkTypeRaw: "" }))).toBe("");
	});
});
