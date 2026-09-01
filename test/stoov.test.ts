import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import stoov from "../src/routes/stoov"; // 假设你的路由文件导出了 app

describe("STOOV 数据下载接口测试", () => {
  // 创建一个临时目录来模拟数据库文件
  const testDbDir = join(import.meta.dir, "temp_db");
  const externalDbPath = join(testDbDir, "yaokong.db");
  const internalDbPath = join(testDbDir, "Heating.db");

  beforeAll(async () => {
    // 创建测试目录并写入两个空数据库（或者包含有效结构的数据库）
    await mkdir(testDbDir, { recursive: true });
    // 创建空文件（或者你可以用 Bun.write 写一个有效的 SQLite 文件）
    await Bun.write(externalDbPath, ""); // 注意：空文件不是有效的 SQLite 文件，但这里只是为了测试文件存在
    await Bun.write(internalDbPath, "");
  });

  afterAll(async () => {
    // 清理临时目录
    await rm(testDbDir, { recursive: true, force: true });
  });

  test("当数据库文件存在时，应返回 CSV 文件", async () => {
    // 需要重写环境变量，让程序使用测试目录
    const originalEnv = process.env.STOOV_DB_DIR;
    process.env.STOOV_DB_DIR = testDbDir;

    try {
      const response = await stoov.request("/test-data/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "external" }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/csv");
      // 可选：检查 CSV 内容
    } finally {
      process.env.STOOV_DB_DIR = originalEnv;
    }
  });

  test("当数据库文件不存在时，应返回 503 及错误信息", async () => {
    // 设置一个不存在的目录
    const originalEnv = process.env.STOOV_DB_DIR;
    process.env.STOOV_DB_DIR = join(testDbDir, "nonexistent");

    try {
      const response = await stoov.request("/test-data/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "external" }),
      });
      expect(response.status).toBe(503);
      const json = await response.json();
      expect(json).toMatchObject({
        success: false,
        message: expect.stringContaining("数据库不可用"),
      });
    } finally {
      process.env.STOOV_DB_DIR = originalEnv;
    }
  });
});
