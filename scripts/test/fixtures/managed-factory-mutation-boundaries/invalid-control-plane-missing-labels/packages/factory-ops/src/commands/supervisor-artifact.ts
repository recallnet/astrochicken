function emitBugIssue() {
  const incidentPacket = buildIncidentPacket({
    factory_id: normalizedFactoryId,
    source_repo: normalizedSourceRepo,
    run_id: normalizedRunId,
    signature_hash: signature,
  });

  const packetValidation = validateIncidentPacket(incidentPacket);
  if (!packetValidation.ok) {
    return { error: "incident_packet_contract_failed" };
  }
}
