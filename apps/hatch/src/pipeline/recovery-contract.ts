import { nodeLabel } from "./graph.js";

import type { Graph, Node } from "./graph.js";

export const RECOVERY_OWNER_ATTRIBUTE = "recovery_owner" as const;
export const RECOVERY_OWNER_SUPERVISOR = "supervisor" as const;
export const RECOVERY_SINK_TYPE_ATTRIBUTE = "recovery_sink_type" as const;
export const RECOVERY_OWNER_MISSING_CODE = "recovery.owner.missing" as const;

export const RECOVERY_SINK_TYPES = ["wait", "terminal"] as const;

export type RecoveryOwner = typeof RECOVERY_OWNER_SUPERVISOR;
export type RecoverySinkType = (typeof RECOVERY_SINK_TYPES)[number];

const RECOVERY_SINK_TYPE_SET = new Set<string>(RECOVERY_SINK_TYPES);

export interface RecoveryNodeMetadata {
	nodeId: string;
	nodeLabel: string;
	recoveryOwnerRaw: string;
	recoverySinkTypeRaw: string;
	hasRecoveryOwner: boolean;
	hasRecoverySinkType: boolean;
}

export type RecoveryMetadataByNodeId = Map<string, RecoveryNodeMetadata>;

export function extractRecoveryMetadata(node: Node, _graphContext?: Graph): RecoveryNodeMetadata {
	return {
		nodeId: node.id,
		nodeLabel: nodeLabel(node),
		recoveryOwnerRaw: normalize(node.attrs[RECOVERY_OWNER_ATTRIBUTE]),
		recoverySinkTypeRaw: normalize(node.attrs[RECOVERY_SINK_TYPE_ATTRIBUTE]),
		hasRecoveryOwner: hasOwnAttr(node, RECOVERY_OWNER_ATTRIBUTE),
		hasRecoverySinkType: hasOwnAttr(node, RECOVERY_SINK_TYPE_ATTRIBUTE),
	};
}

export function extractGraphRecoveryMetadata(g: Graph): RecoveryMetadataByNodeId {
	const byNodeId: RecoveryMetadataByNodeId = new Map<string, RecoveryNodeMetadata>();
	for (const node of Object.values(g.nodes)) {
		byNodeId.set(node.id, extractRecoveryMetadata(node, g));
	}
	return byNodeId;
}

export function isSupervisorOwnedRecovery(metadata: RecoveryNodeMetadata): metadata is RecoveryNodeMetadata & { recoveryOwnerRaw: RecoveryOwner } {
	return metadata.recoveryOwnerRaw === RECOVERY_OWNER_SUPERVISOR;
}

export function isApprovedRecoverySink(metadata: RecoveryNodeMetadata): boolean {
	return RECOVERY_SINK_TYPE_SET.has(metadata.recoverySinkTypeRaw);
}

export function recoverySinkType(metadata: RecoveryNodeMetadata): RecoverySinkType | "" {
	if (RECOVERY_SINK_TYPE_SET.has(metadata.recoverySinkTypeRaw)) {
		return metadata.recoverySinkTypeRaw as RecoverySinkType;
	}
	return "";
}

function hasOwnAttr(node: Node, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(node.attrs, key);
}

function normalize(value: unknown): string {
	return String(value || "").trim().toLowerCase();
}
