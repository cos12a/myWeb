import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dbDir = "/home/yzluo/unito/sqlit-db/stoov-bed";
const externalDb = join(dbDir, "yaokong.db");
const internalDb = join(dbDir, "Heating.db");

function testDatabase(path: string, name: string) {
  console.log(`检查 ${name} (${path})`);
  if (!existsSync(path)) {
    console.error(`❌ 文件不存在`);
    return;
  }
  try {
    const db = new Database(path, { readonly: true });
    // 尝试执行一条简单查询，验证表是否存在
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    console.log(`✅ 数据库可读，包含表:`, tables.map((t) => t.name).join(", "));
    db.close();
  } catch (err) {
    console.error(`❌ 打开或查询失败:`, err);
  }
}

testDatabase(externalDb, "yaokong.db");
testDatabase(internalDb, "Heating.db");
