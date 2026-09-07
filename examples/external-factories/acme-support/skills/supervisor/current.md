# Acme Support supervisor skill

This example external factory intentionally reuses the shared control-plane supervisor tick graph.

## Purpose

- Demonstrate a managed external-factory config where `target_repo` is **not** the control plane repo.
- Keep lifecycle behavior on the proven shared path (`factories/mothership/graphs/factory_supervisor_tick.dot`).
