// vite.config.js
import { defineConfig } from "vite";
import firmwarePlugin from "./vite-plugin-firmware.js";

export default defineConfig({
  base: "./", // 相对路径
  plugins: [
    firmwarePlugin(), // 添加你的自定义插件
    // 如果你还用了其他 Vite 插件（如 vue、react 等），继续在这里添加
  ],
  // 其他可选配置，例如：
  // server: { port: 5173 },
  // base: '/',
});
