import { Database } from "bun:sqlite";
import { Hono } from "hono";
import type { Context } from "hono";
import { join } from "node:path";

const stoov = new Hono();

const mqttConfig = {
  url: "wss://r61d1d77.ala.cn-shenzhen.emqxsl.cn:8084/mqtt",
  username: "heatingBed",
  password: "cos8mos7",
  reconnectPeriod: 5000,
  connectTimeout: 10000,
};

const databaseDirectory =
  process.env.STOOV_DB_DIR || "/home/yzluo/unito/sqlit-db/stoov-bed";

const columns = {
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
} as const;

type Mode = keyof typeof columns;
type Row = Record<string, unknown>;

stoov.get("/mqtt-config", (c: Context) => c.json(mqttConfig));

stoov.post("/test-data/download", async (c: Context) => {
  const body = await c.req
    .json<{ mode?: string }>()
    .catch((): { mode?: string } => ({}));
  const mode: Mode = body.mode === "internal" ? "internal" : "external";
  const databasePath = join(
    databaseDirectory,
    mode === "internal" ? "Heating.db" : "yaokong.db",
  );

  try {
    const database = new Database(databasePath, { readonly: true });
    try {
      const csv = buildCsv(queryRows(database, mode), columns[mode]);
      const filename = `${mode === "internal" ? "heating_test_data" : "Stoov_Remote"}_${datePrefix()}.csv`;
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } finally {
      database.close();
    }
  } catch (error) {
    console.error(`Stoov ${mode} 数据导出失败:`, error);
    return c.json(
      { success: false, message: "测试数据库不可用或查询失败", mode },
      503,
    );
  }
});

function queryRows(database: Database, mode: Mode): Row[] {
  const query =
    mode === "internal"
      ? `SELECT barcode, timestamp, deviceId, deviceVer, items_json,
         strftime('%Y-%m-%d %H:%M:%S', datetime(updated_at, '+8 hours')) AS updated_at
       FROM heating_data ORDER BY updated_at DESC`
      : `SELECT barcode, timestamp, items_json,
         strftime('%Y-%m-%d %H:%M:%S', datetime(updated_at, '+8 hours')) AS updated_at
       FROM data_table ORDER BY updated_at DESC`;
  return database.query(query).all() as Row[];
}

function buildCsv(
  rows: Row[],
  columnMapping: ReadonlyArray<readonly [string, string]>,
): string {
  const lines = [columnMapping.map(([, label]) => escapeCsv(label)).join(",")];
  for (const row of rows) {
    const items = safeParseJson(row.items_json);
    const flattened: Row = { ...row };
    for (let index = 1; index <= 12; index += 1)
      flattened[`func_${index}`] = items[String(index)] ?? "";
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
  )
    return {};
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

function datePrefix(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(
    new Date(),
  );
}

export default stoov;
