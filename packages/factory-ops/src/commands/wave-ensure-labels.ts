import {
  FACTORY_LABEL_KEYS,
  ensureFactoryLabels,
} from "../lib/factory-label-contract.ts";

const DEFAULT_WAVE_LABEL_KEYS = Object.freeze([
  FACTORY_LABEL_KEYS.READY,
  FACTORY_LABEL_KEYS.WAVE_IN_PROGRESS,
  FACTORY_LABEL_KEYS.PRIORITIES,
  FACTORY_LABEL_KEYS.QUARANTINED,
  FACTORY_LABEL_KEYS.BLOCKED_CONTROL_PLANE,
]);

export function waveEnsureLabels({ repo, factoryId = "mothership", keys = DEFAULT_WAVE_LABEL_KEYS, ghExec } = {}) {
  if (!repo) return { ok: false, error: "missing --repo" };
  const ensured = ensureFactoryLabels({ repo, factoryId, keys, ghExec });
  return { ok: ensured.ok, labels: ensured.ensured_labels, factory_id: factoryId };
}
