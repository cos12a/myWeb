import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HealthChecker, HealthCheckResult } from "../types.ts";

export function createDatabaseChecker(dbDir: string): HealthChecker {
  const databases = [
    { name: "db_external", file: "yaokong.db" },
    { name: "db_internal", file: "Heating.db" },
  ];

  return {
    name: "database",
    async check(): Promise<HealthCheckResult> {
      const details: Record<string, HealthCheckResult> = {};
      for (const { name, file } of databases) {
        const path = join(dbDir, file);
        try {
          if (!existsSync(path)) {
            details[name] = { ok: false, error: "File not found" };
            continue;
          }
          const db = new DatabaseSync(path, { readOnly: true });
          db.prepare("SELECT 1").get();
          db.close();
          details[name] = { ok: true };
        } catch (err) {
          details[name] = {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      const allOk = Object.values(details).every((r) => r.ok);
      return {
        ok: allOk,
        details,
      };
    },
  };
}
