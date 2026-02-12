// ABOUTME: Shared mock for amadeus/db used across all test files.
// ABOUTME: Prevents mock.module collisions between test files.

import { mock } from "bun:test";

export const mockMigrate = mock(() => Promise.resolve());
export const mockEnsureOrg = mock(() => Promise.resolve());
export const mockGetConfigYaml = mock(() => Promise.resolve(null));
export const mockSaveConfigYaml = mock(() => Promise.resolve());
export const mockGetMachines = mock(() => Promise.resolve([]));
export const mockCreateMachine = mock(() =>
  Promise.resolve({ id: "mach_123", orgId: "org_1", name: "test", url: "http://test", apiKeyHash: "abc", createdAt: new Date(), lastSeen: null })
);
export const mockDeleteMachine = mock(() => Promise.resolve(false));
export const mockUpdateMachineLastSeen = mock(() => Promise.resolve());
export const mockAuthenticateMachine = mock(() => Promise.resolve(null));
export const mockGetSecret = mock(() => Promise.resolve(null));
export const mockSetSecret = mock(() => Promise.resolve());
export const mockDeleteSecret = mock(() => Promise.resolve(false));
export const mockRecordCompletedTask = mock(() => Promise.resolve());
export const mockGetCompletedTasks = mock(() => Promise.resolve([]));
export const mockGetCompletedTaskCount = mock(() => Promise.resolve(0));
export const mockClose = mock(() => Promise.resolve());

mock.module("amadeus/db", () => ({
  migrate: mockMigrate,
  ensureOrg: mockEnsureOrg,
  getConfigYaml: mockGetConfigYaml,
  saveConfigYaml: mockSaveConfigYaml,
  getMachines: mockGetMachines,
  createMachine: mockCreateMachine,
  deleteMachine: mockDeleteMachine,
  updateMachineLastSeen: mockUpdateMachineLastSeen,
  authenticateMachine: mockAuthenticateMachine,
  getSecret: mockGetSecret,
  setSecret: mockSetSecret,
  deleteSecret: mockDeleteSecret,
  recordCompletedTask: mockRecordCompletedTask,
  getCompletedTasks: mockGetCompletedTasks,
  getCompletedTaskCount: mockGetCompletedTaskCount,
  close: mockClose,
}));
