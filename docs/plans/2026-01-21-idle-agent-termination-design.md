# Idle Agent Termination Design

**Date:** 2026-01-21
**Status:** Approved

## Goal

Automatically terminate agents stuck waiting for user feedback, allowing sprites to hibernate and save costs.

## Approach

Linear state-based idle detection. When an agent is in a configured idle state (default: "Needs Feedback") for longer than the timeout (default: 15 minutes), the hub terminates it.

## Configuration

```yaml
global:
  idleTermination:
    enabled: true
    timeoutMinutes: 15
    idleStates:
      - "Needs Feedback"
    scanIntervalSeconds: 60
```

## Architecture

1. Hub runs an "Idle Scanner" on a configurable interval (default: 60 seconds)
2. Scanner checks heartbeat data for agents in idle states
3. If an agent has been idle longer than timeout, hub sends stop command via `/hub/proxy/stop`
4. Sprite's agent stops; if no other agents running, sprite goes dormant after 2 minutes (existing behavior)

## Tracking Idle Time

Heartbeats tell us current state, but we need to track how long an agent has been in that state.

When a heartbeat arrives:
1. For each agent, check if `linearState` is in the idle states list
2. If yes and no recorded idle start time → set `idleStartTime = now`
3. If yes and already have idle start time → keep it (still idle)
4. If no (agent is working) → clear `idleStartTime`

## Implementation

### New file: `src/hub/idle-scanner.ts`

```typescript
// ABOUTME: Scans for idle agents and terminates them to save costs.
// ABOUTME: Runs on hub, checks heartbeat data for agents stuck in idle states.

export interface IdleScannerConfig {
  enabled: boolean;
  timeoutMinutes: number;
  idleStates: string[];
  scanIntervalSeconds: number;
}

export class IdleScanner {
  constructor(
    config: IdleScannerConfig,
    registry: MachineRegistry,
    stopAgent: (machineUrl: string, agentKey: string) => Promise<void>
  ) {}

  start(): void {}
  stop(): void {}
  onAgentStateChange(machineUrl: string, agentKey: string, linearState: string): void {}
}
```

### Changes to existing files

| File | Change |
|------|--------|
| `src/hub/registry.ts` | Add idle tracking per agent, expose state change hook |
| `src/server.ts` | Initialize IdleScanner in hub/standalone mode |
| `src/config-schema.ts` | Add `idleTermination` config section |

## Edge Cases

**Stop command fails:** Log warning, retry on next scan interval.

**Agent state changes during stop:** Check state again before sending; skip if no longer idle.

**Machine dormant/unreachable:** Agent already gone, scanner skips naturally.

**Agent in "Needs Feedback" but working:** Linear state issue; agent should update state when resuming.

## Logging

```
[IdleScanner] Agent ONA-123 idle for 16m in "Needs Feedback" - terminating
[IdleScanner] Sent stop command to Intershack Sprite for ONA-123
```
