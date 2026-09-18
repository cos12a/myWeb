import { InfluxDB, WriteApi } from "@influxdata/influxdb-client";
import { config } from "./config";

export const influxDB = new InfluxDB({
  url: config.influx.url,
  token: config.influx.token,
});

export const writeApi: WriteApi = influxDB.getWriteApi(
  config.influx.org,
  config.influx.bucket,
  "ns", // 纳秒精度，与 Point.timestamp 的默认单位一致
  {
    batchSize: 500,
    flushInterval: 1000,
    maxRetries: 3,
    maxRetryDelay: 30000,
  },
);

// 所有写入的点都会带上这些标签，方便后续查询
writeApi.useDefaultTags({ app: "mqtt-consumer" });

export async function shutdownInflux() {
  try {
    await writeApi.close();
    console.log("✅ InfluxDB 缓冲区已刷出");
  } catch (err) {
    console.error("❌ 关闭 InfluxDB 失败:", err);
  }
}
