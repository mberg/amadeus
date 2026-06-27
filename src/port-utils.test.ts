// ABOUTME: Tests for agent port probing and free-port selection.
// ABOUTME: Covers findFreePort scan/wrap logic and isPortOccupied against a real port.

import { test, expect } from "bun:test";
import { findFreePort, isPortOccupied } from "./port-utils";

test("findFreePort returns first free port at or after `from`", async () => {
  const occupied = new Set([8001, 8002, 8003]);
  const probe = async (p: number) => occupied.has(p);
  const port = await findFreePort({ from: 8001, start: 8001, end: 8999, probe });
  expect(port).toBe(8004);
});

test("findFreePort wraps to the start of the range when tail is full", async () => {
  const occupied = new Set([8005, 8006, 8007, 8008, 8009]);
  const probe = async (p: number) => occupied.has(p);
  // from=8005, end=8009 all occupied -> wrap and find 8001
  const port = await findFreePort({ from: 8005, start: 8001, end: 8009, probe });
  expect(port).toBe(8001);
});

test("findFreePort throws when the whole range is occupied", async () => {
  const probe = async () => true;
  await expect(
    findFreePort({ from: 8001, start: 8001, end: 8003, probe })
  ).rejects.toThrow(/No free agent port/);
});

test("isPortOccupied is true for a port with a live listener", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = server.port!;
  try {
    expect(await isPortOccupied(port)).toBe(true);
  } finally {
    server.stop(true);
  }
});

test("isPortOccupied is false for a closed port", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = server.port!;
  server.stop(true);
  expect(await isPortOccupied(port, 300)).toBe(false);
});
