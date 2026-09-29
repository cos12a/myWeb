// ---------------------------------------------------------------------------
// 桌面版本地测试数据存储：用 Deno 内置的 node:sqlite（DatabaseSync），
// 无需 bun、无需 FFI，可被 deno compile 内置进单文件 exe。
//
// 表结构与列映射逐字对齐服务端 src/routes/stoov.ts，
// 使“写本地库”与“下载导出 CSV”的语义和线上完全一致：
//   external -> data_table   （/unito/stoov/heating-bed/save/yaokong）
//   internal -> heating_data （/unito/stoov/heating-bed/save/heating）
//   updated_at 存 epoch 秒，导出时 datetime(updated_at,'+8 hours')
// ---------------------------------------------------------------------------

import { DatabaseSync } from "node:sqlite";

type Mode = "external" | "internal";
type Row = Record<string, unknown>;

const COLUMNS: Record<Mode, ReadonlyArray<readonly [string, string]>> = {
  external: [
    ["barcode", "条码"],
    ["timestamp", "时间戳"],
    ["updated_at", "更新时间"],
    ["func_1", "ON/OFF 功能"],
    ["func_2", "时间设置功能"],
    ["func_3", "身体温度设置功能"],
    ["func_4", "脚温度设置功能"],
    ["func_5", "串口通信功能"],
  ],
  internal: [
    ["barcode", "条码"],
    ["timestamp", "时间戳"],
    ["deviceId", "设备ID"],
    ["deviceVer", "设备版本"],
    ["updated_at", "更新时间"],
    ["func_1", "检测设备ID"],
    ["func_2", "故障代码"],
    ["func_3", "身体温度传感器"],
    ["func_4", "脚温度传感器"],
    ["func_5", "身体设置温度(0或25~36°C)"],
    ["func_6", "脚设置温度(0或25~40°C)"],
    ["func_7", "运行状态(开+关)"],
    ["func_8", "设置运行时间(1~12h)"],
    ["func_9", "身体关电流"],
    ["func_10", "身体加热电流"],
    ["func_11", "脚关电流"],
    ["func_12", "脚加热电流"],
  ],
};

export type SavePayload = {
  mode?: Mode;
  barcode?: string;
  timestamp?: string;
  deviceId?: string;
  deviceVer?: string;
  items?: Record<string, unknown>;
};

export class StoovStore {
  #db: DatabaseSync;

  constructor(dbPath: string) {
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS data_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT,
        timestamp TEXT,
        items_json TEXT,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS heating_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT,
        timestamp TEXT,
        deviceId TEXT,
        deviceVer TEXT,
        items_json TEXT,
        updated_at INTEGER
      );
    `);
  }

  /** 写入一条测试结果（按 payload.mode 选择表）。updated_at 用 epoch 秒。 */
  save(payload: SavePayload): void {
    const mode: Mode = payload.mode === "internal" ? "internal" : "external";
    const itemsJson = JSON.stringify(payload.items ?? {});
    const updatedAt = Math.floor(Date.now() / 1000);
    if (mode === "internal") {
      this.#db
        .prepare(
          `INSERT INTO heating_data (barcode, timestamp, deviceId, deviceVer, items_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          payload.barcode ?? "",
          payload.timestamp ?? "",
          payload.deviceId ?? "未知",
          payload.deviceVer ?? "未知",
          itemsJson,
          updatedAt,
        );
    } else {
      this.#db
        .prepare(
          `INSERT INTO data_table (barcode, timestamp, items_json, updated_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          payload.barcode ?? "",
          payload.timestamp ?? "",
          itemsJson,
          updatedAt,
        );
    }
  }

  /** 导出某模式全部数据为 CSV（含 BOM，逻辑对齐服务端 buildCsv）。 */
  exportCsv(mode: Mode): string {
    return buildCsv(this.#queryRows(mode), COLUMNS[mode]);
  }

  #queryRows(mode: Mode): Row[] {
    const sql =
      mode === "internal"
        ? `SELECT barcode, timestamp, deviceId, deviceVer, items_json,
             strftime('%Y-%m-%d %H:%M:%S', datetime(updated_at, '+8 hours')) AS updated_at
           FROM heating_data ORDER BY updated_at DESC`
        : `SELECT barcode, timestamp, items_json,
             strftime('%Y-%m-%d %H:%M:%S', datetime(updated_at, '+8 hours')) AS updated_at
           FROM data_table ORDER BY updated_at DESC`;
    return this.#db.prepare(sql).all() as Row[];
  }

  count(mode: Mode): number {
    const table = mode === "internal" ? "heating_data" : "data_table";
    const row = this.#db
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .get() as { n: number };
    return Number(row?.n ?? 0);
  }
}

function buildCsv(
  rows: Row[],
  columnMapping: ReadonlyArray<readonly [string, string]>,
): string {
  const lines = [columnMapping.map(([, label]) => escapeCsv(label)).join(",")];
  for (const row of rows) {
    const items = safeParseJson(row.items_json);
    const flattened: Row = { ...row };
    for (let index = 1; index <= 12; index += 1) {
      flattened[`func_${index}`] = items[String(index)] ?? "";
    }
    lines.push(
      columnMapping.map(([key]) => escapeCsv(flattened[key])).join(","),
    );
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

function safeParseJson(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "string" ||
    !value ||
    value === "null" ||
    value === "undefined"
  ) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function escapeCsv(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[,"\n\r]/.test(text) || text.startsWith(" ") || text.endsWith(" ")
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}
