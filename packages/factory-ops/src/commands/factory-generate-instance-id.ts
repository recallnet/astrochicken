import { generateFactoryInstanceId, isValidFactoryInstanceId } from "hatch";

export function generateFactoryInstanceIdPayload() {
  const instanceId = generateFactoryInstanceId();
  return {
    ok: isValidFactoryInstanceId(instanceId),
    instance_id: instanceId,
  };
}
