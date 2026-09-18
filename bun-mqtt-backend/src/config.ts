function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`缺少环境变量: ${key}`);
  }
  return value;
}

export const config = {
  mqtt: {
    url: required("MQTT_URL"),
    username: required("MQTT_USER"),
    password: required("MQTT_PASS"),
    clientId: process.env.MQTT_CLIENT_ID || "bun-mqtt-consumer",
    subscribeTopic: "sensors/#",
    qos: 1 as const,
  },
  influx: {
    url: required("INFLUX_URL"),
    token: required("INFLUX_TOKEN"),
    org: required("INFLUX_ORG"),
    bucket: required("INFLUX_BUCKET"),
  },
};
