export function enumerateWaveSlots({ maxConcurrent = "2", readyCount = "", inFlightCount = "", selectedCount = "" } = {}) {
  const parsedMax = parseInt(String(maxConcurrent ?? "2"), 10);
  const maxSlots = Math.max(1, Number.isNaN(parsedMax) ? 2 : parsedMax);

  const parsedReady = parseInt(String(readyCount ?? ""), 10);
  const parsedInFlight = parseInt(String(inFlightCount ?? ""), 10);
  const parsedSelected = parseInt(String(selectedCount ?? "0"), 10);
  const hasAvailabilityInputs = Number.isFinite(parsedReady) && Number.isFinite(parsedInFlight);

  // ready_count reflects markers that existed at dispatch time.
  // selected_count reflects NEW markers created by create_ready_markers after dispatch.
  // Total available = existing ready + newly created - already in-flight.
  const totalAvailable = hasAvailabilityInputs
    ? parsedReady + (Number.isFinite(parsedSelected) ? parsedSelected : 0) - parsedInFlight
    : maxSlots;

  const workerSlots = Math.max(0, Math.min(maxSlots, totalAvailable));

  return JSON.stringify(Array.from({ length: workerSlots }, (_, i) => ({ slot: String(i) })));
}
