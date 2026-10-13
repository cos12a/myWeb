import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

Deno.test("STOOV 数据下载接口读取 SQLite 并返回 CSV", async () => {
  const testDbDir = await Deno.makeTempDir();
  const previousDbDir = Deno.env.get("STOOV_DB_DIR");

  try {
    Deno.env.set("STOOV_DB_DIR", testDbDir);
    const { default: stoov } = await import("../src/routes/stoov.ts");

    const database = new DatabaseSync(join(testDbDir, "yaokong.db"));
    database.exec(
      `CREATE TABLE data_table (
        barcode TEXT,
        timestamp TEXT,
        items_json TEXT,
        updated_at TEXT
      )`,
    );
    database.prepare(
      `INSERT INTO data_table (barcode, timestamp, items_json, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(
      "B-01",
      "14:30",
      JSON.stringify({ "1": "ON" }),
      "2026-10-13 14:30:00",
    );
    database.close();

    const response = await stoov.request("/test-data/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "external" }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type") ?? "", /text\/csv/);
    const csv = await response.text();
    assert.match(csv, /B-01/);
    assert.match(csv, /ON/);

    const missingDatabaseResponse = await stoov.request(
      "/test-data/download",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "internal" }),
      },
    );
    assert.equal(missingDatabaseResponse.status, 404);
  } finally {
    if (previousDbDir === undefined) {
      Deno.env.delete("STOOV_DB_DIR");
    } else {
      Deno.env.set("STOOV_DB_DIR", previousDbDir);
    }
    await Deno.remove(testDbDir, { recursive: true });
  }
});
