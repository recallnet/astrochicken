import { createHash } from "node:crypto";

import {
	graphIntentRef,
	graphIntentProfile,
	graphIntentPatches,
	nodeIntentRef,
	nodeIntentProfile,
	nodeIntentPatches,
} from "./graph.js";

import type { Graph, Node } from "./graph.js";

export type IntentKind = "prompt" | "command" | "assert" | "pipeline" | "human" | "noop";

export type IntentData = Record<string, unknown>;

export interface IntentDescriptor {
	handlerType: string;
	kind: IntentKind;
	data: IntentData;
}

export interface IntentMetadata extends IntentDescriptor {
	nodeId: string;
	digest: string;
	intentRef?: string;
	intentProfile?: string;
	intentPatches?: string[];
}

/**
 * Canonicalize intent metadata for stable hashing.
 * - Object keys sorted lexicographically.
 * - Undefined values omitted.
 * - Strings normalized to \n line endings.
 */
export function canonicalizeIntent(intent: IntentDescriptor): string {
	const normalized = normalizeValue(intent) as IntentDescriptor;
	return JSON.stringify(normalized);
}

/** Compute a stable digest for an intent descriptor. */
export function computeIntentDigest(intent: IntentDescriptor): string {
	const canonical = canonicalizeIntent(intent);
	return "sha256:" + createHash("sha256").update(canonical).digest("hex");
}

/** Build resolved intent metadata with attached digest. */
export function resolveIntentMetadata(nodeId: string, intent: IntentDescriptor): IntentMetadata {
	return {
		nodeId,
		...intent,
		digest: computeIntentDigest(intent),
	};
}

function normalizeValue(value: unknown): unknown {
	if (value === undefined) return undefined;
	if (typeof value === "string") return normalizeString(value);
	if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
	if (value && typeof value === "object") return normalizeObject(value as Record<string, unknown>);
	return value;
}

function normalizeObject(obj: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const entries = Object.entries(obj)
		.filter(([, val]) => val !== undefined)
		.sort(([a], [b]) => a.localeCompare(b));
	for (const [key, val] of entries) {
		result[key] = normalizeValue(val);
	}
	return result;
}

function normalizeString(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export const DEFAULT_INTENT_PROFILE = "default";

export interface IntentDefinition {
	id?: string;
	profiles: Record<string, IntentData>;
	patches?: Record<string, IntentData>;
	patchAllowlist?: string[];
}

export interface IntentRegistry {
	intents: Record<string, IntentDefinition>;
}

export interface IntentBinding {
	intentRef: string;
	profile: string;
	patches: string[];
}

export interface ResolvedIntent {
	intentRef: string;
	profile: string;
	patches: string[];
	data: IntentData;
}

export interface IntentValidationError {
	rule: string;
	message: string;
	nodeId?: string;
}

export class IntentResolutionError extends Error {
	constructor(
		message: string,
		public rule: string,
		public nodeId?: string,
	) {
		super(message);
	}
}

/**
 * Resolve the effective intent binding for a node.
 *
 * Precedence rules:
 * - If a node sets intent_ref, it overrides graph defaults and resets
 *   profile/patch defaults (profile falls back to "default").
 * - Otherwise, graph intent_ref applies, and node profile/patch values
 *   override/extend graph defaults (patches are applied graph -> node).
 */
export function resolveIntentBinding(g: Graph, node: Node): IntentBinding | null {
	const graphRef = graphIntentRef(g);
	const graphProfile = graphIntentProfile(g);
	const graphPatches = parsePatchList(graphIntentPatches(g));

	const nodeRef = nodeIntentRef(node);
	const nodeProfile = nodeIntentProfile(node);
	const nodePatches = parsePatchList(nodeIntentPatches(node));

	if (nodeRef) {
		return {
			intentRef: nodeRef,
			profile: nodeProfile || DEFAULT_INTENT_PROFILE,
			patches: nodePatches,
		};
	}

	if (graphRef) {
		return {
			intentRef: graphRef,
			profile: nodeProfile || graphProfile || DEFAULT_INTENT_PROFILE,
			patches: mergePatchLists(graphPatches, nodePatches),
		};
	}

	return null;
}

/** Resolve the full intent payload (profile + patches) for a node. */
export function resolveIntentForNode(g: Graph, node: Node, registry: IntentRegistry): ResolvedIntent | null {
	const binding = resolveIntentBinding(g, node);
	if (!binding) return null;

	const intent = registry.intents[binding.intentRef];
	if (!intent) {
		throw new IntentResolutionError(
			`intent_ref "${binding.intentRef}" not found in registry`,
			"intent_refs",
			node.id,
		);
	}

	const profile = intent.profiles[binding.profile];
	if (!profile) {
		throw new IntentResolutionError(
			`intent_profile "${binding.profile}" not found for intent "${binding.intentRef}"`,
			"intent_profiles",
			node.id,
		);
	}

	let data = cloneIntentData(profile);
	for (const patchId of binding.patches) {
		const patch = resolveIntentPatch(intent, patchId, binding.intentRef, node.id);
		data = mergeIntentData(data, patch);
	}

	return {
		intentRef: binding.intentRef,
		profile: binding.profile,
		patches: binding.patches,
		data,
	};
}

/** Validate intent bindings across the graph. */
export function validateIntentBindings(g: Graph, registry?: IntentRegistry): IntentValidationError[] {
	const errs: IntentValidationError[] = [];
	const graphRef = graphIntentRef(g);
	const graphProfile = graphIntentProfile(g);
	const graphPatches = parsePatchList(graphIntentPatches(g));

	if (!graphRef && (graphProfile || graphPatches.length > 0)) {
		errs.push({
			rule: "intent_refs",
			message: "graph intent_profile or intent_patches set without intent_ref",
		});
	}

	const graphIntent = registry && graphRef ? registry.intents[graphRef] : undefined;
	const graphIntentInvalid = registry && graphRef && !graphIntent;

	if (registry && graphRef && !graphIntent) {
		errs.push({
			rule: "intent_refs",
			message: `graph intent_ref "${graphRef}" not found in registry`,
		});
	} else if (registry && graphIntent) {
		const profile = graphProfile || DEFAULT_INTENT_PROFILE;
		if (!graphIntent.profiles[profile]) {
			errs.push({
				rule: "intent_profiles",
				message: `graph intent_profile "${profile}" not found for intent "${graphRef}"`,
			});
		}
		errs.push(...validatePatchAllowlist(graphIntent, graphPatches, undefined, `graph intent_ref "${graphRef}"`));
	}

	for (const node of Object.values(g.nodes)) {
		const nodeRef = nodeIntentRef(node);
		const nodeProfile = nodeIntentProfile(node);
		const nodePatches = parsePatchList(nodeIntentPatches(node));

		if (!nodeRef && !graphRef && (nodeProfile || nodePatches.length > 0)) {
			errs.push({
				rule: "intent_refs",
				nodeId: node.id,
				message: "intent_profile or intent_patches set without intent_ref",
			});
			continue;
		}

		const binding = resolveIntentBinding(g, node);
		if (!binding || !registry) continue;

		if (!nodeRef && graphIntentInvalid) continue;

		const intent = registry.intents[binding.intentRef];
		if (!intent) {
			errs.push({
				rule: "intent_refs",
				nodeId: node.id,
				message: `intent_ref "${binding.intentRef}" not found in registry`,
			});
			continue;
		}

		if (!intent.profiles[binding.profile]) {
			errs.push({
				rule: "intent_profiles",
				nodeId: node.id,
				message: `intent_profile "${binding.profile}" not found for intent "${binding.intentRef}"`,
			});
		}

		errs.push(...validatePatchAllowlist(intent, binding.patches, node.id, `intent_ref "${binding.intentRef}"`));
	}

	return errs;
}

function parsePatchList(raw: string): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function mergePatchLists(base: string[], extra: string[]): string[] {
	const merged: string[] = [];
	const seen = new Set<string>();

	for (const patch of [...base, ...extra]) {
		if (!patch || seen.has(patch)) continue;
		seen.add(patch);
		merged.push(patch);
	}

	return merged;
}

function resolveIntentPatch(intent: IntentDefinition, patchId: string, intentRef: string, nodeId?: string): IntentData {
	const allowlist = resolvePatchAllowlist(intent);
	if (!allowlist.has(patchId)) {
		throw new IntentResolutionError(
			`intent_patch "${patchId}" is not allowlisted for intent "${intentRef}"`,
			"intent_patches",
			nodeId,
		);
	}
	const patch = intent.patches?.[patchId];
	if (!patch) {
		throw new IntentResolutionError(
			`intent_patch "${patchId}" not found for intent "${intentRef}"`,
			"intent_patches",
			nodeId,
		);
	}
	return patch;
}

function validatePatchAllowlist(
	intent: IntentDefinition,
	patches: string[],
	nodeId?: string,
	sourceLabel = "intent",
): IntentValidationError[] {
	if (patches.length === 0) return [];

	const errs: IntentValidationError[] = [];
	const allowlist = resolvePatchAllowlist(intent);

	for (const patchId of patches) {
		if (!allowlist.has(patchId)) {
			errs.push({
				rule: "intent_patches",
				nodeId,
				message: `intent_patch "${patchId}" is not allowlisted for ${sourceLabel}`,
			});
			continue;
		}
		if (!intent.patches?.[patchId]) {
			errs.push({
				rule: "intent_patches",
				nodeId,
				message: `intent_patch "${patchId}" not found for ${sourceLabel}`,
			});
		}
	}

	return errs;
}

function resolvePatchAllowlist(intent: IntentDefinition): Set<string> {
	if (intent.patchAllowlist && intent.patchAllowlist.length > 0) {
		return new Set(intent.patchAllowlist);
	}
	return new Set(Object.keys(intent.patches ?? {}));
}

function cloneIntentData(data: IntentData): IntentData {
	return JSON.parse(JSON.stringify(data)) as IntentData;
}

function mergeIntentData(base: IntentData, patch: IntentData): IntentData {
	const result: IntentData = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		const baseValue = (base as Record<string, unknown>)[key];
		if (isPlainObject(baseValue) && isPlainObject(value)) {
			result[key] = mergeIntentData(baseValue, value);
		} else {
			result[key] = value;
		}
	}
	return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
