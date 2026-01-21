// ABOUTME: System resource monitoring for machine mode.
// ABOUTME: Reports CPU, memory, and disk usage.

import os from "os";

export interface SystemResources {
  cpuPercent: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  memoryPercent: number;
  diskUsedGB?: number;
  diskTotalGB?: number;
  diskPercent?: number;
}

export async function getSystemResources(): Promise<SystemResources> {
  // Get memory info
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Get CPU load average (1 minute)
  const loadAvg = os.loadavg()[0];
  const cpuCount = os.cpus().length;
  const cpuPercent = Math.min(100, (loadAvg / cpuCount) * 100);

  return {
    cpuPercent: Math.round(cpuPercent),
    memoryUsedMB: Math.round(usedMem / 1024 / 1024),
    memoryTotalMB: Math.round(totalMem / 1024 / 1024),
    memoryPercent: Math.round((usedMem / totalMem) * 100),
  };
}
