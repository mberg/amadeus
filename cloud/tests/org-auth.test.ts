// ABOUTME: Tests for org resolution from Better Auth sessions.
// ABOUTME: Verifies session-based org extraction and ensureOrg integration.

import { describe, test, expect, mock, beforeEach } from "bun:test";

// Import shared amadeus/db mock (must happen before any src imports)
import { mockEnsureOrg } from "./mocks/amadeus-db";

// Mock the Better Auth module
const mockGetSession = mock(() => Promise.resolve(null));
mock.module("amadeus/better-auth", () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

// Mock the DB user and org-member modules (using amadeus package paths)
const mockGetUserByEmailAnyOrg = mock(() => Promise.resolve(null));
mock.module("amadeus/src/db/users", () => ({
  getUserByEmailAnyOrg: mockGetUserByEmailAnyOrg,
}));

const mockGetOrgsForUser = mock(() => Promise.resolve([]));
mock.module("amadeus/src/db/org-members", () => ({
  getOrgsForUser: mockGetOrgsForUser,
}));

const { resolveOrgId } = await import("../src/org-auth");

beforeEach(() => {
  mockGetSession.mockReset();
  mockEnsureOrg.mockReset();
  mockGetUserByEmailAnyOrg.mockReset();
  mockGetOrgsForUser.mockReset();
  // Default: no hub user found
  mockGetUserByEmailAnyOrg.mockResolvedValue(null);
  mockGetOrgsForUser.mockResolvedValue([]);
});

describe("resolveOrgId", () => {
  test("returns null when no session exists", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const req = new Request("http://localhost/test");
    const result = await resolveOrgId(req);
    expect(result).toBeNull();
  });

  test("returns null when session has no email", async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user_123", name: "Test", email: null },
      session: { id: "sess_123" },
    });

    const req = new Request("http://localhost/test");
    const result = await resolveOrgId(req);
    expect(result).toBeNull();
  });

  test("returns null when getSession throws", async () => {
    mockGetSession.mockRejectedValueOnce(new Error("Session expired"));

    const req = new Request("http://localhost/test", {
      headers: { Cookie: "better-auth.session_token=expired" },
    });
    const result = await resolveOrgId(req);
    expect(result).toBeNull();
  });

  test("returns 'default' org for authenticated session without hub user", async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user_123", name: "Test", email: "test@example.com" },
      session: { id: "sess_123" },
    });
    mockEnsureOrg.mockResolvedValueOnce(undefined);

    const req = new Request("http://localhost/test", {
      headers: { Cookie: "better-auth.session_token=valid" },
    });
    const result = await resolveOrgId(req);
    expect(result).toBe("default");
    expect(mockEnsureOrg).toHaveBeenCalledWith("default");
  });

  test("returns user's org from org_members", async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user_123", name: "Test", email: "test@example.com" },
      session: { id: "sess_123" },
    });
    mockGetUserByEmailAnyOrg.mockResolvedValueOnce({
      id: "hub_user_1",
      orgId: "acme",
      name: "Test",
      email: "test@example.com",
    });
    mockGetOrgsForUser.mockResolvedValueOnce([
      { orgId: "acme", userId: "hub_user_1", role: "admin" },
    ]);
    mockEnsureOrg.mockResolvedValueOnce(undefined);

    const req = new Request("http://localhost/test", {
      headers: { Cookie: "better-auth.session_token=valid" },
    });
    const result = await resolveOrgId(req);
    expect(result).toBe("acme");
    expect(mockEnsureOrg).toHaveBeenCalledWith("acme");
  });
});
