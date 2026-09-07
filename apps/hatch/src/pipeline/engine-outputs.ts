/**
 * Parse the `outputs` attribute from a DOT node and extract named fields from
 * the node's JSON output into a key→value map.
 *
 * Supports two syntaxes:
 * - Simple:  `outputs="key1,key2"`    → extracts `key1` and `key2` from JSON
 * - Mapped:  `outputs="ctx_key:json_field"` → extracts `json_field` from JSON
 *   and stores it under `ctx_key` in context
 *
 * Mixed usage is allowed: `outputs="key1,ctx_key:json_field,key2"`
 */
export function parseOutputsMapping(outputsAttr: string): Array<{ contextKey: string; jsonField: string }> {
	return outputsAttr
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const colonIndex = entry.indexOf(":");
			if (colonIndex > 0) {
				return {
					contextKey: entry.slice(0, colonIndex).trim(),
					jsonField: entry.slice(colonIndex + 1).trim(),
				};
			}
			return { contextKey: entry, jsonField: entry };
		});
}

export function extractNamedOutputs(
	outputsAttr: string,
	rawOutput: string,
): Map<string, string> {
	const result = new Map<string, string>();
	const mappings = parseOutputsMapping(outputsAttr);

	try {
		const parsed = JSON.parse(rawOutput);
		if (Array.isArray(parsed)) {
			// @context:regression !critical LLMs sometimes return a raw array
			// instead of the expected wrapper object. If there's a mapping that
			// looks like it should receive the array (e.g. "approved_features",
			// "features", "items"), assign it. Without this fallback, the array
			// is silently lost and downstream fan_out nodes get empty input.
			const arrayKey = mappings.find(
				(m) => /features|items|issues|results/i.test(m.jsonField),
			);
			if (arrayKey) {
				result.set(arrayKey.contextKey, JSON.stringify(parsed));
			} else if (mappings.length === 1) {
				result.set(mappings[0].contextKey, JSON.stringify(parsed));
			}
		} else if (typeof parsed === "object" && parsed !== null) {
			for (const { contextKey, jsonField } of mappings) {
				if (jsonField in parsed) {
					const val = parsed[jsonField];
					result.set(contextKey, typeof val === "string" ? val : JSON.stringify(val));
				}
			}
		}
	} catch {
		// If output isn't JSON and there's only one mapping, store as-is
		if (mappings.length === 1) {
			result.set(mappings[0].contextKey, rawOutput);
		}
	}

	return result;
}
