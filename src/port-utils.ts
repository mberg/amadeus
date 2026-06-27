// ABOUTME: Utilities for probing agent ports and selecting a free one.
// ABOUTME: Used by the orchestrator to avoid binding to occupied ports.

export type PortProbe = (port: number) => Promise<boolean>;

/**
 * Returns true if something is listening on the port (any HTTP response
 * to /status counts). A connection refusal or timeout is treated as free.
 */
export async function isPortOccupied(port: number, timeoutMs = 500): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scans [from..end] then wraps to [start..from) and returns the first port
 * the probe reports as free. Throws if every port in the range is occupied.
 */
export async function findFreePort(opts: {
  from: number;
  start: number;
  end: number;
  probe: PortProbe;
}): Promise<number> {
  const { start, end, probe } = opts;
  const from = Math.max(opts.from, start);
  for (let p = from; p <= end; p++) {
    if (!(await probe(p))) return p;
  }
  for (let p = start; p < from; p++) {
    if (!(await probe(p))) return p;
  }
  throw new Error(`No free agent port in range ${start}-${end}`);
}
