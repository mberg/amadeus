// ABOUTME: Provider factory for creating issue tracking providers.
// ABOUTME: Exports all provider types and factory function.

export * from "./types";
export { LinearProvider } from "./linear";
export { GitHubProvider } from "./github";

import type { IssueTrackingProvider, ProviderConfig } from "./types";
import { LinearProvider } from "./linear";
import { GitHubProvider } from "./github";

/**
 * Create an issue tracking provider from configuration.
 */
export function createProvider(config: ProviderConfig): IssueTrackingProvider {
  switch (config.type) {
    case "linear":
      return new LinearProvider(config);
    case "github":
      return new GitHubProvider(config);
    default:
      throw new Error(`Unknown provider type: ${(config as ProviderConfig).type}`);
  }
}
