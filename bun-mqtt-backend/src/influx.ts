import { InfluxDB } from "@influxdata/influxdb-client";
import type { WriteApi } from "@influxdata/influxdb-client";
import { config } from "./config";
import { logger } from "./logger";

export const influxDB = new InfluxDB({
  url: config.influx.url,
  token: config.influx.token,
});

/**
 * 批量写入 API：
 * - batchSize 500 / flushInterval 1000ms：吞吐与实时性平衡
 * - maxRetries 3 + 指数退避（≤30s）：网络抖动可自愈
 *
 * 这里的参数与生产环境实测一致，重构中保持不变。
 */
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

export async function shutdownInflux(): Promise<void> {
  try {
    await writeApi.close();
    logger.info("InfluxDB 缓冲区已刷出");
  } catch (err) {
    logger.error({ err }, "关闭 InfluxDB 失败");
  }
}
