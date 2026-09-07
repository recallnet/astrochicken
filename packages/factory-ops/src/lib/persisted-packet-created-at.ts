import { existsSync, readFileSync } from "node:fs";

import { trim } from "./cli-helpers.ts";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function reusePersistedPacketCreatedAt({ packet = {}, packetPath = "", expectedPacketType = "" } = {}) {
  const resolvedPath = trim(packetPath);
  if (!resolvedPath || !existsSync(resolvedPath)) return packet;
  try {
    const persisted = JSON.parse(readFileSync(resolvedPath, "utf8"));
    if (!isPlainObject(persisted)) return packet;
    if (trim(persisted.packet_type) !== trim(expectedPacketType)) return packet;
    if (trim(persisted.packet_id) !== trim(packet.packet_id)) return packet;
    if (!trim(persisted.created_at)) return packet;
    return {
      ...packet,
      created_at: trim(persisted.created_at),
    };
  } catch {
    return packet;
  }
}
