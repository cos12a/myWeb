import type { HealthChecker, HealthCheckResult } from "./types";

const checkers: HealthChecker[] = [];

export function registerChecker(checker: HealthChecker): void {
  checkers.push(checker);
}

export async function runAllChecks(): Promise<
  Record<string, HealthCheckResult>
> {
  const results: Record<string, HealthCheckResult> = {};
  for (const checker of checkers) {
    try {
      results[checker.name] = await checker.check();
    } catch (err) {
      results[checker.name] = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return results;
}

export function overallStatus(
  results: Record<string, HealthCheckResult>,
): "ok" | "degraded" {
  return Object.values(results).every((r) => r.ok) ? "ok" : "degraded";
}
