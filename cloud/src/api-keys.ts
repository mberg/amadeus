// ABOUTME: Machine API key generation and verification for amadeus-cloud.
// ABOUTME: Keys use amk_ prefix with SHA-256 hashing for storage.

import { createMachine, authenticateMachine } from "../../src/db";

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
  return { machineId: machine.id, apiKey };
}

export async function verifyMachineApiKey(
  apiKey: string
): Promise<{ orgId: string; machineName: string; machineId: string } | null> {
  const hash = hashApiKey(apiKey);
  return authenticateMachine(hash);
}
