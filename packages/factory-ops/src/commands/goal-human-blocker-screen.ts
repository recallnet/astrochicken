/**
 * goal-human-blocker-screen.mjs
 *
 * Lightweight, deterministic pre-decomposition screening for goals that
 * obviously require human input (missing credentials, pending approvals,
 * external input). Runs BEFORE spending LLM tokens on decomposition.
 *
 * Conservative: only flags clear, explicit signals. False negatives are
 * acceptable (triage-level detection still happens in decompose review);
 * false positives waste human attention and must be avoided.
 */

const CREDENTIAL_PATTERNS = [
  /\brequires?\s+(?:a\s+)?(?:\w+\s+)?(?:api[- ]?key|secret[- ]?key|access[- ]?key|token|credentials?|password|passphrase)\b/i,
  /\bneed(?:s|ed)?\s+(?:\w+\s+)?(?:api[- ]?key|secret[- ]?key|access[- ]?key|token|credentials?|password)\b/i,
  /\b(?:api[- ]?key|secret[- ]?key|access[- ]?key|personal[- ]?access[- ]?token)\s+(?:that\s+)?(?:we\s+)?(?:don'?t\s+have|not\s+(?:yet\s+)?(?:provisioned|available|set\s*up|configured))\b/i,
  /\b(?:aws|gcp|azure|slack|github|stripe|twilio|sendgrid)\s+(?:\w+\s+)*(?:key|secret|token|credentials?)\b/i,
  /\bprovision(?:ed|ing)?\s+(?:\w+\s+)?(?:credentials?|secrets?|keys?|tokens?)\b/i,
  /\bmissing\s+(?:\w+\s+)?(?:credentials?|secrets?|keys?|tokens?|access)\b/i,
];

const OWNER_DECISION_PATTERNS = [
  /\b(?:requires?|needs?|awaiting|pending|waiting\s+(?:for|on))\s+(?:\w+\s+)?owner\s+(?:approval|decision|sign[- ]?off|input)\b/i,
  /\bowner\s+(?:approval|decision|sign[- ]?off)\s+(?:required|needed|before)\b/i,
  /\bneeds?\s+(?:human|manual)\s+(?:approval|decision|review)\s+before\b/i,
];

const EXTERNAL_INPUT_PATTERNS = [
  /\b(?:waiting|blocked|pending)\s*(?::|\s+(?:for|on))\s+(?:.*?\s+)?(?:vendor|external|third[- ]?party|partner)\b/i,
  /\b(?:vendor|external\s+(?:party|team|provider)|partner)\s+(?:to\s+)?(?:provide|send|share|deliver)\b/i,
  /\bexternal[- ]?input\s+(?:required|needed)\b/i,
];

const MARKER_PATTERN = /<!--\s*human-blocker:\s*(missing_credentials|owner_decision|external_input)\s*-->/i;

/**
 * Screen a goal body for obvious human blocker signals.
 *
 * @param {object} opts
 * @param {string} opts.goalBody - The goal issue body text
 * @returns {{ needs_human: boolean, blocker_kind?: string, exact_request?: string, why_blocked?: string, unblock_condition?: string }}
 */
export function screenGoalForHumanBlockers({ goalBody = "" } = {}) {
  const body = String(goalBody || "");
  if (!body.trim()) {
    return { needs_human: false };
  }

  // Check for explicit marker first
  const markerMatch = body.match(MARKER_PATTERN);
  if (markerMatch) {
    return buildResult(markerMatch[1].toLowerCase(), body);
  }

  // Check credential patterns
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(body)) {
      return buildResult("missing_credentials", body);
    }
  }

  // Check owner decision patterns
  for (const pattern of OWNER_DECISION_PATTERNS) {
    if (pattern.test(body)) {
      return buildResult("owner_decision", body);
    }
  }

  // Check external input patterns
  for (const pattern of EXTERNAL_INPUT_PATTERNS) {
    if (pattern.test(body)) {
      return buildResult("external_input", body);
    }
  }

  return { needs_human: false };
}

function buildResult(kind, body) {
  const descriptions = {
    missing_credentials: {
      exact_request: "Credentials or access tokens referenced in goal body must be provisioned",
      why_blocked: "Goal body references credentials or access that are not yet available",
      unblock_condition: "Required credentials are provisioned and accessible to the factory",
    },
    owner_decision: {
      exact_request: "Owner approval or decision referenced in goal body",
      why_blocked: "Goal body indicates owner approval is required before proceeding",
      unblock_condition: "Owner provides explicit approval or decision",
    },
    external_input: {
      exact_request: "External input referenced in goal body must be provided",
      why_blocked: "Goal body references input from an external party that is not yet available",
      unblock_condition: "External party provides the required input",
    },
  };

  const desc = descriptions[kind] || descriptions.external_input;

  // Try to extract a more specific request from the body (first sentence containing the signal)
  const sentences = body.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const relevantSentence = sentences.find((s) => {
    const lower = s.toLowerCase();
    return lower.includes("require") || lower.includes("need") || lower.includes("waiting")
      || lower.includes("blocked") || lower.includes("pending") || lower.includes("missing")
      || lower.includes("provision") || lower.includes("approval");
  });

  return {
    needs_human: true,
    blocker_kind: kind,
    exact_request: relevantSentence || desc.exact_request,
    why_blocked: desc.why_blocked,
    unblock_condition: desc.unblock_condition,
  };
}
