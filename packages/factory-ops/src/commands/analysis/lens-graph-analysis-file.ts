function asString(value) {
  return String(value ?? "").trim();
}

// @context:regression !critical The LLM agent sometimes returns prose text
// instead of writing the analysis file. When output_format=json fails to
// parse the prose, agentResultJson is empty. This function tries to extract
// embedded JSON from the text as a fallback.
function parseAgentResultJson(agentResultJson = "") {
  const raw = asString(agentResultJson);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Try to extract JSON from prose that contains embedded JSON blocks
    const jsonMatch = raw.match(/\{[\s\S]*"report_body"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function materializePendingAnalysisFromAgentResult({
  runtimeFs,
  analysisPath = "",
  analysisRaw,
  agentResultJson = "",
  writeJsonFileAtomic,
} = {}) {
  if (
    !analysisRaw
    || typeof analysisRaw !== "object"
    || analysisRaw.status !== "pending_agent_analysis"
    || analysisRaw.report_body
  ) {
    return analysisRaw;
  }

  const agentResult = parseAgentResultJson(agentResultJson);
  if (!agentResult || typeof agentResult !== "object") {
    return analysisRaw;
  }

  await writeJsonFileAtomic(runtimeFs, analysisPath, agentResult);
  return agentResult;
}
