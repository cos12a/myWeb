import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // 相对 base：同一份 dist 既能被独立 Hono 服务托管在根路径，
  // 也能挂到主站 /i2c/ 子路径下（访问时必须带尾斜杠）。
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
