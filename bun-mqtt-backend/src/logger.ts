import pino from "pino";
import { config } from "./config";

/**
 * 全局结构化日志实例。
 * - 输出 JSON，便于 Loki/ELK/CloudWatch 等采集
 * - level 由 LOG_LEVEL 环境变量控制
 * - base 字段固定标记应用名，方便多服务过滤
 */
export const logger = pino({
  level: config.log.level,
  base: { app: "bun-mqtt-backend" },
  timestamp: pino.stdTimeFunctions.isoTime,
  // 让 Error 对象在 JSON 里能正确序列化 stack/message
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export type Logger = typeof logger;
