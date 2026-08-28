import { Hono } from "hono";
import type { Context } from "hono";

const stoov = new Hono();

const mqttConfig = {
  url: "wss://r61d1d77.ala.cn-shenzhen.emqxsl.cn:8084/mqtt",
  username: "heatingBed",
  password: "cos8mos7",
  reconnectPeriod: 5000,
  connectTimeout: 10000,
};

stoov.get("/mqtt-config", (c: Context) => {
  return c.json(mqttConfig);
});

stoov.post("/test-data/download", async (c: Context) => {
  const body = await c.req
    .json<{ mode?: string; barcode?: string }>()
    .catch((): { mode?: string; barcode?: string } => ({}));

  const mode = body.mode || "external";
  const barcode = body.barcode || "";

  const csv = [
    "mode,barcode,downloaded_at",
    `${escapeCsv(mode)},${escapeCsv(barcode)},${new Date().toISOString()}`,
  ].join("\n");

  return new Response(`\uFEFF${csv}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="heat-bed-test-${mode}.csv"`,
    },
  });
});

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export default stoov;
