export const MANAGED_FACTORY_DAEMON_STATE_SNAPSHOT_SCHEMA = Object.freeze({
  required_fields: Object.freeze([
    "factory_id",
    "branch",
    "canonical_checkout_path",
    "running_from_canonical",
  ]),
});
