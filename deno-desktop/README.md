# deno-desktop

把 **deno-myweb**（Deno + Hono 后台服务）打包成**桌面应用**：用 `deno compile` 编译出独立可执行文件，运行时启动本地服务并自动打开系统默认浏览器。

> 本项目所有文件由 `deno-myweb/` **复制**而来并按桌面场景改造，`deno-myweb/` 及其它目录**保持不变**。

---

## 一、可行性分析（先看结论）

需求「用 Deno 做桌面应用」有两条技术路线，结合本机环境实测如下：

| 方案 | 做法 | 本机可行性 | 结论 |
|---|---|---|---|
| **A. 编译独立可执行文件 + 自动开浏览器**（本项目采用） | `deno compile` 把 Hono 服务编译成单可执行文件；启动后监听本地端口并自动弹出默认浏览器，形成「本地优先桌面应用」 | ✅ 可当场构建 + 测试通过 | **采用** |
| **B. 真·原生窗口（webview_deno / deno_desktop-Qt）** | 通过 FFI 调用系统 WebView（WebKit2GTK）或 Qt 弹出真正原生窗口 | ❌ 不可行 | 仅记录为将来路线 |

**环境探测依据**（决定为何选 A）：

- `DISPLAY` / `WAYLAND_DISPLAY` 均为空 → 本机是 **headless 容器**，无图形显示，B 方案的窗口无处渲染、也无法测试。
- `ldconfig` 未找到 `webkit2gtk` / `libQt5` → B 方案所需的系统 WebView/Qt 库缺失，且 FFI 交叉编译困难。
- 磁盘可用 26G、`deno compile` 支持 `--target`/`--output` → A 方案完全可行。

> B 方案在**带图形界面的桌面系统**（安装了 WebKit2GTK 的 Linux / macOS / Windows）上理论可行，可作为将来把本应用升级为「原生窗口」的方向；届时前端页面（`static/`）无需改动，只是把「浏览器承载」换成「WebView 承载」。

---

## 二、构建过程中踩到的关键坑（重要）

### 坑：`deno compile --include ./static` 嵌入的静态文件，hono 的 `serveStatic` 读不到

- 起初以为用 `--include ./static` 把静态资源嵌进二进制即可「单文件分发」。
- 实测：编译日志确实显示 `Embedded Files: static/* (2.53MB)`，但把二进制拷到 **没有 `static/` 目录的 `/tmp`** 运行时，所有静态路由 **404**；而从**磁盘上存在 `static/` 的目录**运行时全部 **200**。
- 根因：`@hono/hono/deno` 的 `serveStatic` 通过 `Deno.readFile` 按**相对运行时 CWD** 的路径读**真实磁盘**文件，并不会去读 `deno compile` 嵌入的虚拟文件系统副本。
- 结论：**放弃「单文件嵌入静态资源」**，改为桌面应用的标准形态——**可执行文件 + 同级 `static/` 资源目录**一起分发。

### 解法：把静态根解析成「基于可执行文件位置的绝对路径」

为避免「必须 cd 到程序目录才能运行」的脆弱性，`main.ts` 新增 `resolveStaticRoot()`，按优先级解析静态根：

1. `STATIC_ROOT` 环境变量（显式覆盖）
2. `Deno.execPath()` 所在目录的同级 `static`，或其上一级 `static`（**编译版**桌面程序走这条）
3. `import.meta.url` 同级的 `static`（**开发版** `deno run` 走这条）
4. 兜底 `./static`（相对 CWD）

这样编译后的程序**从任意目录启动都能定位到随程序分发的 `static/`**。已实测：从 `CWD=/` 启动 `/tmp/dapp/deno-desktop`，日志输出 `📁 静态资源根目录：/tmp/dapp/static`，全部路由 200。

---

## 三、目录结构与文件来源

```text
deno-desktop/
├── desktop.ts        # 【新增】桌面启动器：复用 main.ts 服务 + 就绪后自动开浏览器
├── main.ts           # 【复制自 deno-myweb 并改造】Hono 服务；新增 resolveStaticRoot 绝对路径解析
├── src/              # 【复制自 deno-myweb，未改】
│   ├── health.ts     #   /health 存活检查
│   └── routes/
│       ├── api.ts    #   /api/iot-data
│       └── stoov.ts  #   /api/stoov/mqtt-config
├── static/           # 【复制自 deno-myweb】8 个前端站点的构建产物（2.8M）
├── build.sh          # 【新增】构建脚本：deno compile（支持交叉编译）
├── deno.json         # 【复制并改造】新增 desktop/compile 任务
├── deno.lock         # 【复制自 deno-myweb】依赖锁定
├── deno-desktop.desktop  # 【新增】Linux 桌面菜单启动器模板
├── .gitignore        # 【复制并追加】忽略 bin/ 编译产物
├── bin/
│   └── deno-desktop  # 编译产物（约 101MB，已 gitignore，不入库）
└── README.md         # 本文档
```

与 deno-myweb 的差异仅在：新增 `desktop.ts` / `build.sh` / `.desktop` / 本文档；`main.ts` 增加静态根解析；`deno.json` 增加任务。**业务路由与静态内容完全一致**。

---

## 四、如何构建

```bash
# 0) 若当前终端未加载 deno（旧会话），先执行：
source /root/.deno/env

cd deno-desktop

# 1) 编译当前平台 → bin/deno-desktop
./build.sh
#   等价于：deno compile --allow-net --allow-read --allow-env --allow-run \
#            --output bin/deno-desktop desktop.ts
#   或用任务：deno task compile

# 2) 交叉编译到其它平台（Deno 会自动下载对应目标运行时）
./build.sh x86_64-unknown-linux-gnu      # 常见云服务器 / Intel-Linux 桌面
./build.sh x86_64-pc-windows-msvc        # Windows（产物自动加 .exe）
./build.sh aarch64-apple-darwin          # Apple Silicon macOS
./build.sh x86_64-apple-darwin           # Intel macOS
```

编译期已固化权限 `--allow-net/read/env/run`，运行时无需再加参数。

---

## 五、如何运行

### 方式 1：直接跑编译好的可执行文件（桌面形态）

```bash
# 分发/运行时，保证「可执行文件」与「static/」在同一目录（或 static 在其上一级）
./bin/deno-desktop
# → 监听 http://127.0.0.1:30000，并自动打开默认浏览器
```

自定义端口 / 监听地址 / 静态根：

```bash
PORT=8080 HOST=127.0.0.1 ./bin/deno-desktop
STATIC_ROOT=/abs/path/to/static ./bin/deno-desktop
```

> headless 服务器上没有 `xdg-open`，程序会打印「请手动访问 http://127.0.0.1:30000/」并正常提供服务。

### 方式 2：开发模式（需已安装 Deno，热重载）

```bash
deno task desktop    # = deno run --allow-net --allow-read --allow-env --allow-run desktop.ts
deno task start      # 仅服务、不开浏览器（等价原 deno-myweb）
```

### Linux 桌面菜单集成

编辑 `deno-desktop.desktop`，把 `Exec=` / `Icon=` 改成你的绝对路径，放到 `~/.local/share/applications/`：

```bash
mkdir -p ~/.local/share/applications
cp deno-desktop.desktop ~/.local/share/applications/
# 之后即可在应用菜单里点击启动
```

---

## 六、验证结果（本机实测）

| 测试 | 结果 |
|---|---|
| `deno check main.ts desktop.ts` | ✅ 通过，无类型错误 |
| `deno compile`（本机 aarch64） | ✅ 产物 `bin/deno-desktop` 101MB ELF |
| 从 `CWD=/` 启动 `/tmp/dapp/deno-desktop`（exe 与 static 同级） | ✅ 静态根解析为 `/tmp/dapp/static` |
| `/health`、`/api/iot-data`、`/api/stoov/mqtt-config` | ✅ 200 JSON |
| 8 个静态站点首页 + 深层 JS/CSS 资源 | ✅ 全 200，content-type 正确 |
| SPA 兜底（随机路径→public/index.html） | ✅ 200（与原版一致） |
| headless 无浏览器 | ✅ 优雅降级为文字提示，服务照常 |

---

## 七、分发方式

桌面应用 = **一个可执行文件 + 一个 `static/` 目录**，二者需保持同级（或 static 在 exe 上一级）。示例：

```text
MyWebDesktop/
├── deno-desktop        # 或 deno-desktop.exe（Windows）
└── static/             # 8 个前端站点
```

把整个文件夹拷给用户即可，双击/命令行运行 `deno-desktop` 就会启动本地服务并弹出浏览器。

---

## 八、与 deno-myweb 的功能对应

| 能力 | 是否具备 |
|---|---|
| 8 个静态站点托管 + SPA 兜底 | ✅ 一致 |
| `/api/iot-data` | ✅ 一致 |
| `/api/stoov/mqtt-config`（支持 `STOOV_MQTT_*` 环境变量覆盖） | ✅ 一致 |
| `/health` | ✅ 一致 |
| `/api/stoov/test-data/download`、`/health/db`（依赖 `bun:sqlite`） | ❌ 未移植（与 deno-myweb 约定一致，不含 SQLite） |
| 自动打开浏览器 / 编译成可执行文件 | 🆕 桌面版新增 |

> ⚠️ 安全提示：`/api/stoov/mqtt-config` 默认值内置于 `src/routes/stoov.ts`（含 MQTT 账号口令）。对外分发前建议用 `STOOV_MQTT_URL/USER/PASS` 环境变量注入，避免密钥随程序扩散。

---

## 九、限制与将来

- 本方案是「本地服务 + 系统浏览器」形态，**不是原生窗口**。若将来需要真·原生窗口（无浏览器地址栏、独立图标/菜单），可在带图形界面的机器上引入 `webview_deno`（WebKit2GTK）或 `deno_desktop`（Qt）承载同一套 `static/` 前端。
- `deno compile` 产物内嵌整个 Deno 运行时，体积约 100MB 属正常；可用 `--engine quickjs`（实验性，更小）权衡体积与兼容性。
