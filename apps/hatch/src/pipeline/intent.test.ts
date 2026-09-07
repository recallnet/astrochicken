import { describe, expect, it } from "vitest";

import {
	canonicalizeIntent,
	computeIntentDigest,
	resolveIntentMetadata,
	resolveIntentForNode,
	type IntentDescriptor,
	type IntentRegistry,
} from "./intent.js";
import { parse } from "./parse.js";
import { validate } from "./validate.js";

const registry: IntentRegistry = {
	intents: {
		base: {
			profiles: {
				default: { mode: "default" },
				graph: { mode: "profile-graph" },
				node: { mode: "profile-node" },
			},
			patches: {
				graph_patch: { mode: "graph", graph: true },
				node_patch: { mode: "node", node: true },
				blocked_patch: { mode: "blocked" },
			},
			patchAllowlist: ["graph_patch", "node_patch"],
		},
		override: {
			profiles: {
				override_profile: { mode: "override-profile" },
				default: { mode: "override-default" },
			},
			patches: {
				override_patch: { mode: "override", override: true },
			},
			patchAllowlist: ["override_patch"],
		},
	},
};

describe("intent canonicalization", () => {
	it("normalizes strings and sorts keys", () => {
		const intent: IntentDescriptor = {
			handlerType: "codergen",
			kind: "prompt",
			data: {
				prompt: "Line 1\r\nLine 2",
				model: "gpt-4.1",
				nested: { b: 2, a: 1 },
				ignored: undefined,
			},
		};

		expect(canonicalizeIntent(intent)).toBe(
			'{"data":{"model":"gpt-4.1","nested":{"a":1,"b":2},"prompt":"Line 1\\nLine 2"},"handlerType":"codergen","kind":"prompt"}',
		);
	});

	it("produces stable digests for equivalent intents", () => {
		const a: IntentDescriptor = {
			handlerType: "tool",
			kind: "command",
			data: { command: "echo hi", workDir: "/tmp", stdin: "" },
		};
		const b: IntentDescriptor = {
			kind: "command",
			handlerType: "tool",
			data: { stdin: "", workDir: "/tmp", command: "echo hi" },
		};

		expect(computeIntentDigest(a)).toBe(computeIntentDigest(b));
	});

	it("changes digest when intent changes", () => {
		const base: IntentDescriptor = {
			handlerType: "tool",
			kind: "command",
			data: { command: "echo hi" },
		};
		const updated: IntentDescriptor = {
			handlerType: "tool",
			kind: "command",
			data: { command: "echo hello" },
		};

		expect(computeIntentDigest(base)).not.toBe(computeIntentDigest(updated));
	});

	it("attaches digest to resolved metadata", () => {
		const intent: IntentDescriptor = {
			handlerType: "pipeline",
			kind: "pipeline",
			data: { pipeline: "./child.dot" },
		};
		const metadata = resolveIntentMetadata("node-1", intent);

		expect(metadata.nodeId).toBe("node-1");
		expect(metadata.digest).toBe(computeIntentDigest(intent));
	});
});

describe("intent resolution", () => {
	it("resolves node bindings with graph/node precedence", () => {
		const graph = parse(`
	digraph intent_precedence {
		intent_ref = "base"
		intent_profile = "graph"
		intent_patches = "graph_patch"

		start [shape=Mdiamond]
		done [shape=Msquare]

		a [label="a"]
		b [intent_profile="node" intent_patches="node_patch"]
		c [intent_ref="override" intent_profile="override_profile" intent_patches="override_patch"]

		start -> a -> done
		start -> b -> done
		start -> c -> done
	}
		`);

		const a = resolveIntentForNode(graph, graph.nodes["a"], registry);
		const b = resolveIntentForNode(graph, graph.nodes["b"], registry);
		const c = resolveIntentForNode(graph, graph.nodes["c"], registry);

		expect(a).not.toBeNull();
		expect(a?.intentRef).toBe("base");
		expect(a?.profile).toBe("graph");
		expect(a?.patches).toEqual(["graph_patch"]);
		expect(a?.data).toEqual({ mode: "graph", graph: true });

		expect(b).not.toBeNull();
		expect(b?.intentRef).toBe("base");
		expect(b?.profile).toBe("node");
		expect(b?.patches).toEqual(["graph_patch", "node_patch"]);
		expect(b?.data).toEqual({ mode: "node", graph: true, node: true });

		expect(c).not.toBeNull();
		expect(c?.intentRef).toBe("override");
		expect(c?.profile).toBe("override_profile");
		expect(c?.patches).toEqual(["override_patch"]);
		expect(c?.data).toEqual({ mode: "override", override: true });
	});

	it("validates missing intent refs, profiles, and patch allowlists", () => {
		const graph = parse(`
	digraph intent_validation {
		intent_ref = "base"
		intent_profile = "default"
		intent_patches = "graph_patch"

		start [shape=Mdiamond]
		done [shape=Msquare]

		ok [label="ok"]
		bad_profile [intent_profile="missing_profile"]
		bad_intent [intent_ref="ghost"]
		bad_patch [intent_patches="blocked_patch"]

		start -> ok -> done
		start -> bad_profile -> done
		start -> bad_intent -> done
		start -> bad_patch -> done
	}
		`);

		const errors = validate(graph, { intentRegistry: registry });

		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ rule: "intent_profiles", nodeId: "bad_profile" }),
				expect.objectContaining({ rule: "intent_refs", nodeId: "bad_intent" }),
				expect.objectContaining({ rule: "intent_patches", nodeId: "bad_patch" }),
			]),
		);

		const noRefGraph = parse(`
	digraph intent_missing_ref {
		start [shape=Mdiamond]
		done [shape=Msquare]
		no_ref [intent_profile="default"]
		start -> no_ref -> done
	}
		`);

		const missingRefErrors = validate(noRefGraph, { intentRegistry: registry });
		expect(missingRefErrors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ rule: "intent_refs", nodeId: "no_ref" }),
			]),
		);
	});
});
