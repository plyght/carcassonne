/** "YYYY-MM" (UTC) for monthly free-tier counters. */
export const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7);
