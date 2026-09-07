// @context:decision The loop-guard owns empty-blue counting and threshold enforcement.
// It also aggregates the terminate-signal from check_output (should_force_wrap) into
// trigger_force_wrap so the downstream gate only needs one condition to check.
// This keeps ownership clean: check_output detects terminate signals (stateless per-output);
// loop_guard accumulates stateful cross-turn empty-blue state; the gate routes on the
// aggregated signal. Separating detection from state is the invariant — not separating
// the output signals.
// !critical: trigger_force_wrap="true" must NOT be set for non-blue sources from the
// empty-blue counter. However, should_force_wrap from check_output is propagated
// regardless of source, since terminate-non-final applies to both red and blue callers.
// The blue_early_exit_gate only sees this node's trigger_force_wrap — it must reflect
// both the empty-blue threshold AND the check_output terminate-non-final signal.

const DEFAULT_EMPTY_BLUE_THRESHOLD = 2;

/**
 * Deterministic loop-guard for repeated empty blue turns.
 *
 * Increments a per-session empty-blue counter, resets it on non-empty blue
 * or any red turn, and triggers force-wrap once the threshold is reached.
 * Also propagates `should_force_wrap` from check_output (terminate-non-final
 * payloads) into `trigger_force_wrap` so the downstream gate is a single check.
 *
 * @param {object} opts
 * @param {string} opts.source                  - "red" | "blue" (or any other source label)
 * @param {string} opts.conversationalOutput    - raw conversational output from the current turn
 * @param {string|number} opts.previousEmptyBlueCount - counter from previous turn context
 * @param {string|number} [opts.emptyBlueThreshold]   - max consecutive empty blue turns before force-wrap
 * @param {string} [opts.shouldForceWrap]       - "true"|"false" from check_output terminate-non-final
 * @returns {{ empty_blue_count: string, trigger_force_wrap: string, suppress_round_comment: string, guard_reason: string }}
 */
export function applyBrainstormLoopGuard({
  source = "unknown",
  conversationalOutput = "",
  previousEmptyBlueCount = "0",
  emptyBlueThreshold = String(DEFAULT_EMPTY_BLUE_THRESHOLD),
  shouldForceWrap = "false",
} = {}) {
  const src = String(source).trim();
  const output = String(conversationalOutput ?? "");
  const isEmpty = !output.trim();
  const upstreamForceWrap = String(shouldForceWrap).trim() === "true";

  const prevCount = parseInt(String(previousEmptyBlueCount), 10) || 0;
  const threshold = parseInt(String(emptyBlueThreshold), 10) || DEFAULT_EMPTY_BLUE_THRESHOLD;

  let newCount = prevCount;
  let triggerForceWrap = false;
  let guardReason = "none";

  if (src === "red") {
    // Red turns reset the empty-blue counter regardless of content.
    newCount = 0;
  } else if (src === "blue") {
    if (isEmpty) {
      newCount = prevCount + 1;
      if (newCount >= threshold) {
        triggerForceWrap = true;
        guardReason = "repeated_empty_blue";
      }
    } else {
      // Non-empty blue output resets counter.
      newCount = 0;
    }
  }
  // Non-red/blue sources (e.g. force_wrap, format_repair) do not affect counter.

  // Propagate terminate-non-final signal from check_output.
  // If upstream check detected terminate:true without final-report shape, aggregate into
  // trigger_force_wrap so the downstream gate only needs a single condition.
  if (upstreamForceWrap) {
    triggerForceWrap = true;
    if (guardReason === "none") {
      guardReason = "terminate_signal_non_final";
    }
  }

  const suppressRoundComment = triggerForceWrap;

  return {
    empty_blue_count: String(newCount),
    trigger_force_wrap: triggerForceWrap ? "true" : "false",
    suppress_round_comment: suppressRoundComment ? "true" : "false",
    guard_reason: guardReason,
  };
}
