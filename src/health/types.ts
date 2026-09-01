export interface HealthCheckResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown; // 允许附加额外信息
}

export interface HealthChecker {
  name: string;
  check(): Promise<HealthCheckResult> | HealthCheckResult;
}
