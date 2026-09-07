function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function bumpBrainstormRound({ round = "0", maxRounds = "10" } = {}) {
  const currentRound = toInt(round, 0);
  if (currentRound < 0) {
    throw new Error("brainstorm_bump_round:invalid_round");
  }

  const ceiling = toInt(maxRounds, 10);
  if (ceiling <= 0) {
    throw new Error("brainstorm_bump_round:invalid_max_rounds");
  }

  if (currentRound >= ceiling) {
    return {
      round: String(ceiling),
      has_next: "false",
      at_limit: "true",
      termination_reason: "max_rounds_reached",
    };
  }

  const nextRound = currentRound + 1;
  const atLimit = nextRound >= ceiling;

  return {
    round: String(nextRound),
    has_next: atLimit ? "false" : "true",
    at_limit: atLimit ? "true" : "false",
    termination_reason: atLimit ? "max_rounds_reached" : "continue",
  };
}
