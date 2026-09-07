/**
 * Fleet TUI barrel — re-exports the public API surface.
 */

export {
  normalizeFleetTuiRefreshMs,
  buildFleetTuiState,
  resolveFleetDashboardLaunch,
  buildFactoryDetailState,
  reduceFleetTuiKeypress,
} from "./state.ts";

export { FactoryFleetTuiApp } from "./app.ts";
export { runFactoryFleetTui } from "./runner.ts";
