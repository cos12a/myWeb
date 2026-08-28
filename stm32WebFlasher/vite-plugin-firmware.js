// vite-plugin-firmware.js
import fs from "node:fs";
import path from "node:path";

export default function firmwarePlugin() {
  return {
    name: "vite-plugin-firmware",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET") return next();
        if (!req.url || !req.url.startsWith("/stoov-bed-firmware.hex"))
          return next();

        // 从 firmware 文件夹读取（相对项目根目录）
        const filePath = path.resolve(
          process.cwd(),
          "firmware",
          "stoov-bed-firmware.hex",
        );
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.end("stoov-bed-firmware.hex not found");
          return;
        }

        try {
          const data = fs.readFileSync(filePath);
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="stoov-bed-firmware.hex"`,
          );
          res.setHeader("Content-Length", data.length);
          res.statusCode = 200;
          res.end(data);
        } catch (err) {
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      });
    },
  };
}
