export function waveClaimFixture({ claimToken, acquired = true, reason = "claim_acquired" }) {
  return {
    ok: true,
    acquired,
    reason,
    claim: {
      claim_token: claimToken,
      lease_expires_at: "2026-01-01T00:20:00.000Z",
    },
  };
}
