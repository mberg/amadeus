// ABOUTME: Utility for getting process memory usage on Mac.
// ABOUTME: Uses ps command to get RSS (resident set size) for a given PID.

/**
 * Get the memory usage of a process in megabytes.
 * Returns undefined if the process doesn't exist or PID is undefined.
 */
export async function getProcessMemoryMB(pid: number | undefined): Promise<number | undefined> {
  if (pid === undefined) {
    return undefined;
  }

  try {
    // ps -o rss= -p <pid> returns RSS in KB (resident set size)
    const result = await Bun.$`ps -o rss= -p ${pid}`.quiet();
    const rssKB = parseInt(result.text().trim(), 10);

    if (isNaN(rssKB)) {
      return undefined;
    }

    // Convert KB to MB
    return Math.round((rssKB / 1024) * 10) / 10;
  } catch {
    // Process doesn't exist or ps command failed
    return undefined;
  }
}
