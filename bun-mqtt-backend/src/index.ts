import { config, configSnapshot } from "./config";
import { logger } from "./logger";
import { startConsumer } from "./consumer";
import { startHealthServer } from "./health";
import { shutdownInflux } from "./influx";

/**
 * bun-mqtt-backend 统一入口。
 *
 * 装配顺序：
 *   1. 加载并校验环境变量（config.ts 顶层副作用）
 *   2. 初始化 Pino 日志（logger.ts 顶层副作用）
 *   3. 初始化 InfluxDB WriteApi（influx.ts 顶层副作用）
 *   4. 启动 MQTT 消费者
 *   5. 启动健康检查 HTTP 端点
 *   6. 注册信号处理，实现优雅关闭
 */

logger.info({ config: configSnapshot() }, "启动 bun-mqtt-backend");

const mqttClient = startConsumer();
const healthServer = startHealthServer({ mqttClient });

let shuttingDown = false;

async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, "开始优雅关闭…");

  // 兜底：5s 内没关完就强制退出，防止 InfluxDB/MQTT 卡住导致进程僵死
  const forceExitTimer = setTimeout(() => {
    logger.error("关闭超时（5s），强制退出");
    process.exit(1);
  }, 5000);
  // Bun/Node 中 setTimeout 会保持事件循环，关闭流程结束后要主动 clear
  forceExitTimer.unref?.();

  try {
    // 1) 停止接受新的健康检查请求
    healthServer.stop(true);

    // 2) 断开 MQTT（true = 立即断开，不等待发送队列）
    await new Promise<void>((resolve) => {
      mqttClient.end(true, () => resolve());
    });

    // 3) 刷出 InfluxDB 缓冲区（内部已 catch 错误，不会抛出）
    await shutdownInflux();

    logger.info("已安全退出");
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "关闭过程发生异常");
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "未处理的 Promise 拒绝");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "未捕获异常，即将关闭进程");
  void shutdown("uncaughtException");
});

// 便于开发时观察配置生效情况
logger.debug({ healthPort: config.health.port }, "启动完成");
