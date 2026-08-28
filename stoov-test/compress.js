import { minify } from "html-minifier-terser";

async function compressHTML() {
  // Bun.file() 是懒加载的，比 readFileSync 更高效
  const file = Bun.file("dist/index.html");
  const html = await file.text();

  const result = await minify(html, {
    removeComments: true,
    collapseWhitespace: true,
    removeAttributeQuotes: true,
    minifyCSS: true,
    minifyJS: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    useShortDoctype: true,
    removeEmptyAttributes: true,
    removeOptionalTags: true,
    removeEmptyElements: false,
    sortAttributes: true,
    sortClassName: true,
  });

  // Bun.write() 比 writeFileSync 快，且自动处理编码
  await Bun.write("dist/index.html", result);

  console.log("✅ HTML 压缩完成！");
  console.log(`📦 压缩前: ${html.length} 字节`);
  console.log(`📦 压缩后: ${result.length} 字节`);
  console.log(
    `📉 减少: ${((1 - result.length / html.length) * 100).toFixed(2)}%`,
  );
}

compressHTML();
