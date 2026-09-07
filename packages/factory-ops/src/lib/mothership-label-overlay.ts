import { mergeFactoryLabelRegistryOverlay } from "./factory-label-overlay.ts";
import { globalFactoryLabelRegistry } from "./factory-label-registry.ts";

export const mothershipFactoryLabelOverlay = Object.freeze([
  Object.freeze({
    name: "blocked-control-plane",
    category: "control",
    owner: "supervisor",
    description: "Blocked on an upstream control-plane condition",
    color: "d93f0b",
    include_by_default: true,
    wave_ready: false,
  }),
  Object.freeze({
    name: "merge-followup",
    category: "control",
    owner: "wave_execute",
    description: "Merge conveyor follow-up",
    color: "fbca04",
    include_by_default: true,
    wave_ready: false,
  }),
  Object.freeze({
    name: "human",
    category: "control",
    owner: "supervisor",
    description: "Human input requested by factory",
    color: "fbca04",
    include_by_default: true,
    wave_ready: false,
  }),
  Object.freeze({
    name: "awaiting-human",
    category: "control",
    owner: "supervisor",
    description: "Blocked waiting on human input",
    color: "d4c5f9",
    include_by_default: true,
    wave_ready: false,
  }),
  Object.freeze({
    name: "blocked",
    category: "control",
    owner: "triage",
    description: "Issue blocked pending prerequisite completion",
    color: "cfd3d7",
    include_by_default: true,
    wave_ready: false,
  }),
  Object.freeze({
    name: "managed-factory-bug",
    category: "type",
    owner: "supervisor",
    description: "Managed factory bug routed to control-plane triage",
    color: "d73a4a",
    include_by_default: true,
    wave_ready: false,
  }),
  Object.freeze({
    name: "factory:example-trading",
    category: "type",
    owner: "supervisor",
    description: "Bug originated from example-trading managed factory",
    color: "5319e7",
    include_by_default: true,
    wave_ready: false,
  }),
  Object.freeze({
    name: "needs-triage",
    category: "control",
    owner: "supervisor",
    description: "Upstream bug requires triage classification",
    color: "fbca04",
    include_by_default: true,
    wave_ready: false,
  }),
]);

export function mothershipFactoryLabelRegistry() {
  return mergeFactoryLabelRegistryOverlay({
    coreRegistry: globalFactoryLabelRegistry,
    overlay: mothershipFactoryLabelOverlay,
  });
}
