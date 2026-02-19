// ABOUTME: Machine API key generation and verification for amadeus-cloud.
// ABOUTME: Keys use amk_ prefix with SHA-256 hashing for storage.

import { createMachine, authenticateMachine, setSecret } from "../../src/db";
import { updateMachineApiKeyHash } from "../../src/db/machines";

function hashApiKey(apiKey: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(apiKey);
  return hasher.digest("hex");
}

export async function generateMachineApiKey(
  orgId: string,
  name: string,
  url: string
): Promise<{ machineId: string; apiKey: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const apiKey = `amk_${Buffer.from(bytes).toString("base64url")}`;
  const hash = hashApiKey(apiKey);
  const machine = await createMachine(orgId, name, url, hash);
  // Store plaintext key as secret so hub can use it for webhook forwarding
  await setSecret(orgId, `machine:${machine.id}:api_key`, apiKey);
  return { machineId: machine.id, apiKey };
}

export async function regenerateMachineApiKey(
  orgId: string,
  machineId: string
): Promise<{ apiKey: string } | null> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const apiKey = `amk_${Buffer.from(bytes).toString("base64url")}`;
  const hash = hashApiKey(apiKey);
  const machine = await updateMachineApiKeyHash(machineId, hash);
  if (!machine || machine.orgId !== orgId) return null;
  await setSecret(orgId, `machine:${machineId}:api_key`, apiKey);
  return { apiKey };
}

export async function verifyMachineApiKey(
  apiKey: string
): Promise<{ orgId: string; machineName: string; machineId: string } | null> {
  const hash = hashApiKey(apiKey);
  return authenticateMachine(hash);
}
