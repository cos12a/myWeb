/**
 * i18n 国际化模块
 * 支持：中文 (zh)、英文 (en)、繁体中文 (zh-TW)、日文 (ja)、韩文 (ko)、德文 (de)、俄文 (ru)
 *
 * 约定：HTML 用 data-i18n="分组.键" 声明文案，数组用下标（tools.items.3.name）；
 * 值里含 < 标签时按 innerHTML 写入（用于 <em> / <br>），否则按 textContent 写入。
 */

const translations = {
  zh: {
    nav: { works: "作品", tools: "工具", docs: "文档", skills: "技能", about: "关于" },
    hero: {
      eyebrow: "在线工坊 · 2026 选辑",
      title1: "把有用的东西，",
      title2: "做成<em>耐看</em>的作品。",
      desc: "十一件在浏览器里直接运行的工具：串口、蓝牙、USB、I²C，还有一台会发热的垫子。没有安装包，没有注册，打开就能用。",
      btn1: "开始体验",
      btn2: "浏览全部作品",
      hint: "Chromium 浏览器 · 需要安全上下文"
    },
    stats: [
      { value: "11+", label: "在线工具" },
      { value: "6", label: "硬件协议" },
      { value: "7", label: "界面语言" },
      { value: "0", label: "安装步骤" }
    ],
    featured: {
      tag: "Selected Works",
      title: "精选作品",
      sub: "最常拿出手的四件，每一件都在真实场景里跑过。",
      viewAll: "浏览全部"
    },
    badges: { new: "新品", core: "核心", pick: "常用" },
    pieces: { open: "查看" },
    tools: {
      tag: "The Collection",
      title: "全部工具",
      subtitle: "都是干活时顺手做的，现在都能直接用。",
      items: [
        { name: "Stoov 加热垫测试", desc: "串口连上就能测，遥控、加热、数据上报一条龙。冬天来了正好用。", meta: "Serial · MQTT" },
        { name: "Stoov 控制面板", desc: "调温度、做标定，搞清楚这玩意儿到底怎么工作的。", meta: "BLE · Serial" },
        { name: "ESP 设备管理", desc: "看看设备状态，远程控制，OTA 升级也能搞。", meta: "OTA · Remote" },
        { name: "STM32 Web 烧录器", desc: "浏览器里直接烧录，不用装软件，自动复位。", meta: "UART · ISP" },
        { name: "Web 串口绘图器", desc: "串口数据变曲线，多通道一起看，调试省时间。", meta: "Canvas · CSV" },
        { name: "I²C Web 调试台", desc: "浏览器连 ESP32-Bus-Pirate，扫总线、读寄存器、写 EEPROM。", meta: "LWPKT · BLE" },
        { name: "仪器指标面板", desc: "蓝牙连仪器，VBUS/VSHUNT/IBUS/PBUS 实时看。", meta: "BLE NUS" },
        { name: "Web USB 测试", desc: "浏览器里测 USB 设备，枚举、传输都能搞。", meta: "USB 2.0" },
        { name: "WS8623 BLE 测试", desc: "蓝牙模块调试，扫描、配对、透传收发。", meta: "FFF0 · NUS" },
        { name: "ESP Web 烧录", desc: "浏览器烧录 ESP 固件，Manifest 一键安装。", meta: "Manifest" },
        { name: "ESP32 分区表构建器", desc: "可视化调分区，导出 CSV，不用靠猜。", meta: "CSV Export" }
      ]
    },
    about: {
      tag: "The Workshop",
      title: "为什么做<br>这些玩意儿？",
      p1: "说白了，就是想让日子过得舒服点。加热垫冬天用着暖和，串口工具调试起来省事，烧录器不用装软件就能用——都是些实际需求逼出来的小东西。",
      p2: "做完了放着也是放着，不如放出来，说不定能帮到谁。要是你也喜欢捣鼓这些，欢迎一起聊。",
      pillars: [
        { name: "实用", desc: "先解决自己的问题" },
        { name: "克制", desc: "能少一个依赖就少一个" },
        { name: "耐用", desc: "协议写清楚，明年还能改" }
      ]
    },
    docs: {
      tag: "Documentation",
      title: "文档",
      subtitle: "怎么写的不一定好看，但应该够用。",
      items: [
        { name: "快速开始", desc: "环境怎么配、项目怎么跑，几分钟搞定。", tags: ["入门", "配置"] },
        { name: "工具使用指南", desc: "每个工具怎么用，步骤写清楚了。", tags: ["手册", "FAQ"] },
        { name: "硬件协议", desc: "Serial、BLE、USB 这些浏览器 API 怎么用。", tags: ["Serial", "BLE", "USB"] },
        { name: "架构设计", desc: "项目怎么组织的，想加新工具看这里。", tags: ["架构", "贡献"] },
        { name: "数据流与 MQTT", desc: "设备数据怎么上报、怎么存、字段怎么分。", tags: ["MQTT", "InfluxDB"] },
        { name: "部署指南", desc: "本地怎么跑、线上怎么部署，命令都列了。", tags: ["部署", "DevOps"] }
      ]
    },
    skills: {
      tag: "Skills",
      title: "AI 技能库",
      subtitle: "给编码助手看的，让它别瞎搞。",
      items: [
        { name: "Stoov 测试控制台", desc: "产线测试台，串口状态机 + MQTT 上报" },
        { name: "Stoov 修正面板", desc: "温度标定、BLE/Serial 通信、缓存管理" },
        { name: "仪器 BLE 面板", desc: "Lit 组件 + Web Bluetooth NUS 实时渲染" },
        { name: "STM32 Web 烧录", desc: "Bootloader 命令、HEX 解析、ISP 流程" },
        { name: "Web 串口绘图器", desc: "RingStore + Canvas 实时曲线 + 导出" },
        { name: "I²C Web 调试", desc: "LWPKT 帧协议 + ESP32-Bus-Pirate 操作" },
        { name: "Web USB 测试", desc: "设备枚举、端点声明、批量传输" },
        { name: "WS8623 BLE 演示", desc: "FFF0 串口服务、244 字节分片、配对" },
        { name: "MQTT 采集管线", desc: "MQTT→InfluxDB 去重、字段分类、时间戳归一" },
        { name: "桌面封装", desc: "deno compile 单 exe + 静态资源同步" },
        { name: "主站路由与构建", desc: "Deno + Hono 静态托管 + 聚合构建脚本" },
        { name: "ESP32 固件能力", desc: "CAPS v2 自由引脚表、型号差异处理" }
      ]
    },
    cta: {
      title1: "东西不多，",
      title2: "但都用得上。",
      desc: "要是你也在捣鼓物联网、串口、蓝牙这些，也许能用上。",
      btn: "看看加热垫"
    },
    footer: { brand: "熊出没电子 DIY" },
    theme: { light: "亮色", dark: "暗色", label: "切换主题" }
  },

  en: {
    nav: { works: "Works", tools: "Tools", docs: "Docs", skills: "Skills", about: "About" },
    hero: {
      eyebrow: "Online Workshop · 2026 Collection",
      title1: "Build something useful,",
      title2: "make it <em>worth keeping</em>.",
      desc: "Eleven tools that run straight in the browser: serial, Bluetooth, USB, I²C — plus a heating pad that actually warms up. No installers, no sign-up, just open and use.",
      btn1: "Start exploring",
      btn2: "Browse all works",
      hint: "Chromium only · Secure context required"
    },
    stats: [
      { value: "11+", label: "Online Tools" },
      { value: "6", label: "Hardware Protocols" },
      { value: "7", label: "Interface Languages" },
      { value: "0", label: "Install Steps" }
    ],
    featured: {
      tag: "Selected Works",
      title: "Selected works",
      sub: "The four I reach for most — each one proven in real use.",
      viewAll: "View all"
    },
    badges: { new: "New", core: "Core", pick: "Popular" },
    pieces: { open: "View" },
    tools: {
      tag: "The Collection",
      title: "All tools",
      subtitle: "Made while working, ready to use now.",
      items: [
        { name: "Stoov Heating Pad Test", desc: "Connect serial and test — remote, heating, data reporting. Perfect for winter.", meta: "Serial · MQTT" },
        { name: "Stoov Control Panel", desc: "Adjust temperature, calibrate sensors, figure out how this thing works.", meta: "BLE · Serial" },
        { name: "ESP Device Manager", desc: "Check device status, remote control, OTA updates too.", meta: "OTA · Remote" },
        { name: "STM32 Web Flasher", desc: "Flash directly in the browser, no software needed, auto-reset.", meta: "UART · ISP" },
        { name: "Web Serial Plotter", desc: "Turn serial data into curves, multi-channel view, saves debugging time.", meta: "Canvas · CSV" },
        { name: "I²C Web Debug Bench", desc: "Connect ESP32-Bus-Pirate in the browser, scan the bus, read registers, write EEPROM.", meta: "LWPKT · BLE" },
        { name: "Instrument Metrics Panel", desc: "Connect the instrument over BLE, watch VBUS/VSHUNT/IBUS/PBUS live.", meta: "BLE NUS" },
        { name: "Web USB Test", desc: "Test USB devices in the browser — enumeration and transfers.", meta: "USB 2.0" },
        { name: "WS8623 BLE Test", desc: "Debug the BLE module: scan, pair, transparent transmit.", meta: "FFF0 · NUS" },
        { name: "ESP Web Flasher", desc: "Flash ESP firmware in the browser, one-click Manifest install.", meta: "Manifest" },
        { name: "ESP32 Partition Builder", desc: "Adjust partitions visually, export CSV, no guessing.", meta: "CSV Export" }
      ]
    },
    about: {
      tag: "The Workshop",
      title: "Why bother<br>with all this?",
      p1: "Honestly, I just want life to be more comfortable. The heating pad keeps you warm in winter, serial tools make debugging easier, the flasher works without installing software — all little things born from real needs.",
      p2: "Might as well share them once they are done — maybe they help someone. If you like tinkering too, let us talk.",
      pillars: [
        { name: "Useful", desc: "Solve my own problem first" },
        { name: "Restraint", desc: "One dependency less is a win" },
        { name: "Longevity", desc: "Documented, so next year it still works" }
      ]
    },
    docs: {
      tag: "Documentation",
      title: "Documentation",
      subtitle: "May not look pretty, but should be enough.",
      items: [
        { name: "Quick Start", desc: "How to set up the environment and run the project, done in minutes.", tags: ["Intro", "Setup"] },
        { name: "Tool Guide", desc: "How to use each tool, steps are clear.", tags: ["Manual", "FAQ"] },
        { name: "Hardware Protocols", desc: "How to use the Serial, BLE and USB browser APIs.", tags: ["Serial", "BLE", "USB"] },
        { name: "Architecture", desc: "How the project is organized, look here to add new tools.", tags: ["Arch", "Contribute"] },
        { name: "Data Flow & MQTT", desc: "How device data is reported, stored and classified.", tags: ["MQTT", "InfluxDB"] },
        { name: "Deployment Guide", desc: "How to run locally and deploy online, commands included.", tags: ["Deploy", "DevOps"] }
      ]
    },
    skills: {
      tag: "Skills",
      title: "AI Skills",
      subtitle: "For coding assistants, so they do not wander off.",
      items: [
        { name: "Stoov Test Console", desc: "Production test bench, serial state machine + MQTT reporting" },
        { name: "Stoov Correction Panel", desc: "Temperature calibration, BLE/Serial communication, cache management" },
        { name: "Instrument BLE Panel", desc: "Lit components + Web Bluetooth NUS real-time rendering" },
        { name: "STM32 Web Flasher", desc: "Bootloader commands, HEX parsing, ISP flow" },
        { name: "Web Serial Plotter", desc: "RingStore + Canvas real-time curves + export" },
        { name: "I²C Web Debug", desc: "LWPKT frame protocol + ESP32-Bus-Pirate operations" },
        { name: "Web USB Test", desc: "Device enumeration, endpoint declaration, bulk transfer" },
        { name: "WS8623 BLE Demo", desc: "FFF0 serial service, 244-byte fragmentation, pairing" },
        { name: "MQTT Pipeline", desc: "MQTT→InfluxDB dedup, field classification, timestamp normalization" },
        { name: "Desktop Packaging", desc: "deno compile single exe + static asset sync" },
        { name: "Main Site Routing", desc: "Deno + Hono static hosting + build orchestration" },
        { name: "ESP32 Firmware Caps", desc: "CAPS v2 free pin table, model difference handling" }
      ]
    },
    cta: {
      title1: "Not much stuff,",
      title2: "but all of it gets used.",
      desc: "If you also tinker with IoT, serial and Bluetooth, something here may help.",
      btn: "Check the heating pad"
    },
    footer: { brand: "Bear Electronics DIY" },
    theme: { light: "Light", dark: "Dark", label: "Toggle theme" }
  },

  "zh-TW": {
    nav: { works: "作品", tools: "工具", docs: "文件", skills: "技能", about: "關於" },
    hero: {
      eyebrow: "線上工坊 · 2026 選輯",
      title1: "把有用的東西，",
      title2: "做成<em>耐看</em>的作品。",
      desc: "十一件在瀏覽器裡直接執行的工具：串口、藍牙、USB、I²C，還有一台會發熱的墊子。沒有安裝包，沒有註冊，打開就能用。",
      btn1: "開始體驗",
      btn2: "瀏覽全部作品",
      hint: "Chromium 瀏覽器 · 需要安全上下文"
    },
    stats: [
      { value: "11+", label: "線上工具" },
      { value: "6", label: "硬體協議" },
      { value: "7", label: "介面語言" },
      { value: "0", label: "安裝步驟" }
    ],
    featured: {
      tag: "Selected Works",
      title: "精選作品",
      sub: "最常拿出手的四件，每一件都在真實場景裡跑過。",
      viewAll: "瀏覽全部"
    },
    badges: { new: "新品", core: "核心", pick: "常用" },
    pieces: { open: "查看" },
    tools: {
      tag: "The Collection",
      title: "全部工具",
      subtitle: "都是幹活時順手做的，現在都能直接用。",
      items: [
        { name: "Stoov 加熱墊測試", desc: "串口連上就能測，遙控、加熱、數據上報一條龍。冬天來了正好用。", meta: "Serial · MQTT" },
        { name: "Stoov 控制面板", desc: "調溫度、做標定，搞清楚這玩意兒到底怎麼工作的。", meta: "BLE · Serial" },
        { name: "ESP 設備管理", desc: "看看設備狀態，遠程控制，OTA 升級也能搞。", meta: "OTA · Remote" },
        { name: "STM32 Web 燒錄器", desc: "瀏覽器裡直接燒錄，不用裝軟體，自動復位。", meta: "UART · ISP" },
        { name: "Web 串口繪圖器", desc: "串口數據變曲線，多通道一起看，調試省時間。", meta: "Canvas · CSV" },
        { name: "I²C Web 調試台", desc: "瀏覽器連 ESP32-Bus-Pirate，掃總線、讀寄存器、寫 EEPROM。", meta: "LWPKT · BLE" },
        { name: "儀器指標面板", desc: "藍牙連儀器，VBUS/VSHUNT/IBUS/PBUS 實時看。", meta: "BLE NUS" },
        { name: "Web USB 測試", desc: "瀏覽器裡測 USB 設備，枚舉、傳輸都能搞。", meta: "USB 2.0" },
        { name: "WS8623 BLE 測試", desc: "藍牙模組調試，掃描、配對、透傳收發。", meta: "FFF0 · NUS" },
        { name: "ESP Web 燒錄", desc: "瀏覽器燒錄 ESP 韌體，Manifest 一鍵安裝。", meta: "Manifest" },
        { name: "ESP32 分區表構建器", desc: "可視化調分區，匯出 CSV，不用靠猜。", meta: "CSV Export" }
      ]
    },
    about: {
      tag: "The Workshop",
      title: "為什麼做<br>這些玩意兒？",
      p1: "說白了，就是想讓日子過得舒服點。加熱墊冬天用著暖和，串口工具調試起來省事，燒錄器不用裝軟體就能用——都是些實際需求逼出來的小東西。",
      p2: "做完了放著也是放著，不如放出來，說不定能幫到誰。要是你也喜歡搗鼓這些，歡迎一起聊。",
      pillars: [
        { name: "實用", desc: "先解決自己的問題" },
        { name: "克制", desc: "能少一個依賴就少一個" },
        { name: "耐用", desc: "協議寫清楚，明年還能改" }
      ]
    },
    docs: {
      tag: "Documentation",
      title: "文件",
      subtitle: "怎麼寫的不一定好看，但應該夠用。",
      items: [
        { name: "快速開始", desc: "環境怎麼配、專案怎麼跑，幾分鐘搞定。", tags: ["入門", "配置"] },
        { name: "工具使用指南", desc: "每個工具怎麼用，步驟寫清楚了。", tags: ["手冊", "FAQ"] },
        { name: "硬體協議", desc: "Serial、BLE、USB 這些瀏覽器 API 怎麼用。", tags: ["Serial", "BLE", "USB"] },
        { name: "架構設計", desc: "專案怎麼組織的，想加新工具看這裡。", tags: ["架構", "貢獻"] },
        { name: "數據流與 MQTT", desc: "設備數據怎麼上報、怎麼存、欄位怎麼分。", tags: ["MQTT", "InfluxDB"] },
        { name: "部署指南", desc: "本地怎麼跑、線上怎麼部署，命令都列了。", tags: ["部署", "DevOps"] }
      ]
    },
    skills: {
      tag: "Skills",
      title: "AI 技能庫",
      subtitle: "給編碼助手看的，讓它別瞎搞。",
      items: [
        { name: "Stoov 測試控制台", desc: "產線測試台，串口狀態機 + MQTT 上報" },
        { name: "Stoov 修正面板", desc: "溫度標定、BLE/Serial 通信、快取管理" },
        { name: "儀器 BLE 面板", desc: "Lit 元件 + Web Bluetooth NUS 實時渲染" },
        { name: "STM32 Web 燒錄", desc: "Bootloader 命令、HEX 解析、ISP 流程" },
        { name: "Web 串口繪圖器", desc: "RingStore + Canvas 實時曲線 + 匯出" },
        { name: "I²C Web 調試", desc: "LWPKT 幀協議 + ESP32-Bus-Pirate 操作" },
        { name: "Web USB 測試", desc: "設備枚舉、端點聲明、批量傳輸" },
        { name: "WS8623 BLE 演示", desc: "FFF0 串口服務、244 位元組分片、配對" },
        { name: "MQTT 採集管線", desc: "MQTT→InfluxDB 去重、欄位分類、時間戳歸一" },
        { name: "桌面封裝", desc: "deno compile 單 exe + 靜態資源同步" },
        { name: "主站路由與構建", desc: "Deno + Hono 靜態託管 + 聚合構建腳本" },
        { name: "ESP32 韌體能力", desc: "CAPS v2 自由引腳表、型號差異處理" }
      ]
    },
    cta: {
      title1: "東西不多，",
      title2: "但都用得上。",
      desc: "要是你也在搗鼓物聯網、串口、藍牙這些，也許能用上。",
      btn: "看看加熱墊"
    },
    footer: { brand: "熊出沒電子 DIY" },
    theme: { light: "亮色", dark: "暗色", label: "切換主題" }
  },

  ja: {
    nav: { works: "作品", tools: "ツール", docs: "ドキュメント", skills: "スキル", about: "について" },
    hero: {
      eyebrow: "オンライン工房 · 2026 選集",
      title1: "役に立つものを、",
      title2: "<em>手元に残る</em>作品に。",
      desc: "ブラウザでそのまま動く十一のツール。シリアル、Bluetooth、USB、I²C、そして本当に温かくなるヒートパッド。インストールも登録も要りません。",
      btn1: "使ってみる",
      btn2: "すべての作品を見る",
      hint: "Chromium 系ブラウザ · セキュアコンテキスト必須"
    },
    stats: [
      { value: "11+", label: "オンラインツール" },
      { value: "6", label: "ハードウェアプロトコル" },
      { value: "7", label: "表示言語" },
      { value: "0", label: "インストール手順" }
    ],
    featured: {
      tag: "Selected Works",
      title: "選りすぐり",
      sub: "最もよく使う四つ。すべて実際の現場で動かしています。",
      viewAll: "すべて見る"
    },
    badges: { new: "新作", core: "主要", pick: "常用" },
    pieces: { open: "見る" },
    tools: {
      tag: "The Collection",
      title: "すべてのツール",
      subtitle: "作業中に作ったもの、今すぐ使えます。",
      items: [
        { name: "Stoov ヒートパッドテスト", desc: "シリアル接続してテスト。リモコン、加熱、データ報告まで一通り。", meta: "Serial · MQTT" },
        { name: "Stoov コントロールパネル", desc: "温度調整とキャリブレーション。この機器の仕組みを把握する。", meta: "BLE · Serial" },
        { name: "ESP デバイス管理", desc: "状態確認、リモート操作、OTA アップデートも。", meta: "OTA · Remote" },
        { name: "STM32 Web フラッシャー", desc: "ブラウザで直接書き込み。ソフト不要、自動リセット。", meta: "UART · ISP" },
        { name: "Web シリアルプロッター", desc: "シリアルデータを波形に。マルチチャンネル表示でデバッグ短縮。", meta: "Canvas · CSV" },
        { name: "I²C Web デバッグ台", desc: "ブラウザで ESP32-Bus-Pirate に接続し、バススキャン、レジスタ読み書き。", meta: "LWPKT · BLE" },
        { name: "計測パネル", desc: "BLE で計測器に接続し、VBUS/VSHUNT/IBUS/PBUS をリアルタイム表示。", meta: "BLE NUS" },
        { name: "Web USB テスト", desc: "ブラウザで USB デバイスを検証。列挙も転送も。", meta: "USB 2.0" },
        { name: "WS8623 BLE テスト", desc: "BLE モジュールのデバッグ。スキャン、ペアリング、透過通信。", meta: "FFF0 · NUS" },
        { name: "ESP Web フラッシャー", desc: "ブラウザで ESP ファームウェアを書き込み。Manifest で一括。", meta: "Manifest" },
        { name: "ESP32 パーティションビルダー", desc: "パーティションを視覚的に調整し CSV 出力。勘に頼らない。", meta: "CSV Export" }
      ]
    },
    about: {
      tag: "The Workshop",
      title: "なぜこれを<br>作るのか？",
      p1: "正直に言えば、暮らしを少し楽にしたいだけです。ヒートパッドは冬に暖かく、シリアルツールはデバッグを楽にし、フラッシャーはソフトなしで動く。すべて実際の必要から生まれた小さな道具です。",
      p2: "作ったまま眠らせるより、公開した方が誰かの役に立つかもしれません。同じようにいじるのが好きなら、ぜひ話しましょう。",
      pillars: [
        { name: "実用", desc: "まず自分の課題を解く" },
        { name: "抑制", desc: "依存は一つでも少なく" },
        { name: "長持ち", desc: "手順を残せば来年も直せる" }
      ]
    },
    docs: {
      tag: "Documentation",
      title: "ドキュメント",
      subtitle: "読みやすさより、使えることを優先しています。",
      items: [
        { name: "クイックスタート", desc: "環境構築と実行方法。数分で完了。", tags: ["入門", "設定"] },
        { name: "ツールガイド", desc: "各ツールの使い方と手順。", tags: ["マニュアル", "FAQ"] },
        { name: "ハードウェアプロトコル", desc: "Serial、BLE、USB のブラウザ API の扱い方。", tags: ["Serial", "BLE", "USB"] },
        { name: "アーキテクチャ", desc: "プロジェクト構成。新しいツールを足すならここ。", tags: ["設計", "貢献"] },
        { name: "データフローと MQTT", desc: "デバイスデータの報告、保存、フィールド分類。", tags: ["MQTT", "InfluxDB"] },
        { name: "デプロイガイド", desc: "ローカル実行と本番公開の手順とコマンド。", tags: ["デプロイ", "DevOps"] }
      ]
    },
    skills: {
      tag: "Skills",
      title: "AI スキル",
      subtitle: "コーディング支援エージェント向けの手引き。",
      items: [
        { name: "Stoov テストコンソール", desc: "生産テスト台、シリアル状態マシン + MQTT 報告" },
        { name: "Stoov 補正パネル", desc: "温度キャリブレーション、BLE/Serial 通信、キャッシュ管理" },
        { name: "計測 BLE パネル", desc: "Lit コンポーネント + Web Bluetooth NUS 描画" },
        { name: "STM32 Web 書込み", desc: "Bootloader コマンド、HEX 解析、ISP 手順" },
        { name: "Web シリアルプロッター", desc: "RingStore + Canvas リアルタイム波形 + 書き出し" },
        { name: "I²C Web デバッグ", desc: "LWPKT フレーム + ESP32-Bus-Pirate 操作" },
        { name: "Web USB テスト", desc: "デバイス列挙、エンドポイント宣言、バルク転送" },
        { name: "WS8623 BLE デモ", desc: "FFF0 シリアルサービス、244 バイト分割、ペアリング" },
        { name: "MQTT パイプライン", desc: "MQTT→InfluxDB 重複排除、フィールド分類、時刻正規化" },
        { name: "デスクトップ化", desc: "deno compile 単一 exe + 静的資産同期" },
        { name: "サイト配信とビルド", desc: "Deno + Hono 静的配信 + 集約ビルド" },
        { name: "ESP32 ファーム機能", desc: "CAPS v2 自由ピン表、機種差の扱い" }
      ]
    },
    cta: {
      title1: "数は多くない、",
      title2: "でも全部使えます。",
      desc: "IoT、シリアル、Bluetooth を触っているなら、何か役に立つはずです。",
      btn: "ヒートパッドを見る"
    },
    footer: { brand: "熊電子 DIY" },
    theme: { light: "ライト", dark: "ダーク", label: "テーマ切替" }
  },

  ko: {
    nav: { works: "작품", tools: "도구", docs: "문서", skills: "스킬", about: "소개" },
    hero: {
      eyebrow: "온라인 공방 · 2026 선집",
      title1: "쓸모 있는 것을,",
      title2: "<em>오래 두고 볼</em> 작품으로.",
      desc: "브라우저에서 바로 도는 열한 가지 도구. 시리얼, 블루투스, USB, I²C, 그리고 실제로 따뜻해지는 히팅패드까지. 설치도 가입도 필요 없습니다.",
      btn1: "시작하기",
      btn2: "모든 작품 보기",
      hint: "Chromium 계열 브라우저 · 보안 컨텍스트 필요"
    },
    stats: [
      { value: "11+", label: "온라인 도구" },
      { value: "6", label: "하드웨어 프로토콜" },
      { value: "7", label: "인터페이스 언어" },
      { value: "0", label: "설치 단계" }
    ],
    featured: {
      tag: "Selected Works",
      title: "선별 작품",
      sub: "가장 자주 꺼내는 네 가지. 모두 실제 현장에서 검증했습니다.",
      viewAll: "전체 보기"
    },
    badges: { new: "신작", core: "핵심", pick: "인기" },
    pieces: { open: "보기" },
    tools: {
      tag: "The Collection",
      title: "모든 도구",
      subtitle: "일하면서 만든 것들, 지금 바로 사용할 수 있습니다.",
      items: [
        { name: "Stoov 히팅패드 테스트", desc: "시리얼로 연결해 리모컨, 가열, 데이터 보고까지 한 번에.", meta: "Serial · MQTT" },
        { name: "Stoov 제어 패널", desc: "온도 조절과 보정. 이 물건이 어떻게 동작하는지 파악합니다.", meta: "BLE · Serial" },
        { name: "ESP 장치 관리", desc: "상태 확인, 원격 제어, OTA 업데이트까지.", meta: "OTA · Remote" },
        { name: "STM32 Web 플래셔", desc: "브라우저에서 바로 플래싱. 소프트웨어 없이 자동 리셋.", meta: "UART · ISP" },
        { name: "Web 시리얼 플로터", desc: "시리얼 데이터를 곡선으로. 다채널 동시 확인.", meta: "Canvas · CSV" },
        { name: "I²C Web 디버그", desc: "브라우저에서 ESP32-Bus-Pirate 연결, 버스 스캔과 레지스터 읽기.", meta: "LWPKT · BLE" },
        { name: "계측 패널", desc: "BLE 로 계측기와 연결해 VBUS/VSHUNT/IBUS/PBUS 를 실시간 확인.", meta: "BLE NUS" },
        { name: "Web USB 테스트", desc: "브라우저에서 USB 장치 검증. 열거와 전송 모두.", meta: "USB 2.0" },
        { name: "WS8623 BLE 테스트", desc: "BLE 모듈 디버깅. 스캔, 페어링, 투명 전송.", meta: "FFF0 · NUS" },
        { name: "ESP Web 플래셔", desc: "브라우저에서 ESP 펌웨어 기록. Manifest 로 한 번에.", meta: "Manifest" },
        { name: "ESP32 파티션 빌더", desc: "파티션을 시각적으로 조정하고 CSV 로 내보내기.", meta: "CSV Export" }
      ]
    },
    about: {
      tag: "The Workshop",
      title: "왜 이걸<br>만들까요?",
      p1: "솔직히 말하면 삶을 조금 편하게 만들고 싶었습니다. 히팅패드는 겨울에 따뜻하고, 시리얼 도구는 디버깅을 줄여 주고, 플래셔는 소프트웨어 없이 동작합니다. 모두 실제 필요에서 나온 작은 도구입니다.",
      p2: "만들어 두고 방치하기보다 공개하면 누군가에게 도움이 될 수 있습니다. 이런 걸 좋아한다면 함께 이야기해요.",
      pillars: [
        { name: "실용", desc: "먼저 내 문제를 해결" },
        { name: "절제", desc: "의존성은 하나라도 줄이기" },
        { name: "지속", desc: "기록해 두면 내년에도 고칠 수 있음" }
      ]
    },
    docs: {
      tag: "Documentation",
      title: "문서",
      subtitle: "예쁘게 쓰진 않았지만 쓸 만은 합니다.",
      items: [
        { name: "빠른 시작", desc: "환경 설정과 실행 방법. 몇 분이면 충분합니다.", tags: ["입문", "설정"] },
        { name: "도구 가이드", desc: "각 도구의 사용법과 절차.", tags: ["매뉴얼", "FAQ"] },
        { name: "하드웨어 프로토콜", desc: "Serial, BLE, USB 브라우저 API 사용법.", tags: ["Serial", "BLE", "USB"] },
        { name: "아키텍처", desc: "프로젝트 구성. 새 도구를 추가할 때 참고.", tags: ["설계", "기여"] },
        { name: "데이터 흐름과 MQTT", desc: "장치 데이터 보고, 저장, 필드 분류.", tags: ["MQTT", "InfluxDB"] },
        { name: "배포 가이드", desc: "로컬 실행과 온라인 배포 절차 및 명령.", tags: ["배포", "DevOps"] }
      ]
    },
    skills: {
      tag: "Skills",
      title: "AI 스킬",
      subtitle: "코딩 에이전트가 헤매지 않도록 정리한 안내서.",
      items: [
        { name: "Stoov 테스트 콘솔", desc: "생산 테스트 벤치, 시리얼 상태 머신 + MQTT 보고" },
        { name: "Stoov 보정 패널", desc: "온도 보정, BLE/Serial 통신, 캐시 관리" },
        { name: "계측 BLE 패널", desc: "Lit 컴포넌트 + Web Bluetooth NUS 렌더링" },
        { name: "STM32 Web 플래싱", desc: "Bootloader 명령, HEX 파싱, ISP 흐름" },
        { name: "Web 시리얼 플로터", desc: "RingStore + Canvas 실시간 곡선 + 내보내기" },
        { name: "I²C Web 디버그", desc: "LWPKT 프레임 프로토콜 + ESP32-Bus-Pirate 동작" },
        { name: "Web USB 테스트", desc: "장치 열거, 엔드포인트 선언, 벌크 전송" },
        { name: "WS8623 BLE 데모", desc: "FFF0 시리얼 서비스, 244 바이트 분할, 페어링" },
        { name: "MQTT 파이프라인", desc: "MQTT→InfluxDB 중복 제거, 필드 분류, 시각 정규화" },
        { name: "데스크톱 패키징", desc: "deno compile 단일 exe + 정적 자산 동기화" },
        { name: "사이트 서빙과 빌드", desc: "Deno + Hono 정적 호스팅 + 통합 빌드" },
        { name: "ESP32 펌웨어 기능", desc: "CAPS v2 자유 핀 표, 모델 차이 처리" }
      ]
    },
    cta: {
      title1: "많지는 않지만,",
      title2: "전부 쓰입니다.",
      desc: "IoT, 시리얼, 블루투스를 다룬다면 도움이 될 만한 것이 있습니다.",
      btn: "히팅패드 보기"
    },
    footer: { brand: "곰 전자 DIY" },
    theme: { light: "라이트", dark: "다크", label: "테마 전환" }
  },

  de: {
    nav: { works: "Arbeiten", tools: "Werkzeuge", docs: "Doku", skills: "Skills", about: "Über" },
    hero: {
      eyebrow: "Online-Werkstatt · Kollektion 2026",
      title1: "Nützliches bauen,",
      title2: "das <em>bleibenden Wert</em> hat.",
      desc: "Elf Werkzeuge, die direkt im Browser laufen: Serial, Bluetooth, USB, I²C — und ein Heizkissen, das wirklich warm wird. Keine Installation, keine Anmeldung.",
      btn1: "Jetzt ausprobieren",
      btn2: "Alle Arbeiten ansehen",
      hint: "Nur Chromium · Sicherer Kontext nötig"
    },
    stats: [
      { value: "11+", label: "Online-Werkzeuge" },
      { value: "6", label: "Hardware-Protokolle" },
      { value: "7", label: "Sprachen" },
      { value: "0", label: "Installationsschritte" }
    ],
    featured: {
      tag: "Selected Works",
      title: "Ausgewählte Arbeiten",
      sub: "Die vier, die ich am häufigsten nutze — alle im Alltag erprobt.",
      viewAll: "Alle ansehen"
    },
    badges: { new: "Neu", core: "Kern", pick: "Beliebt" },
    pieces: { open: "Ansehen" },
    tools: {
      tag: "The Collection",
      title: "Alle Werkzeuge",
      subtitle: "Bei der Arbeit entstanden, sofort einsatzbereit.",
      items: [
        { name: "Stoov Heizkissen-Test", desc: "Serial verbinden und testen: Fernbedienung, Heizung, Datenmeldung.", meta: "Serial · MQTT" },
        { name: "Stoov Steuerpanel", desc: "Temperatur einstellen und kalibrieren, verstehen wie es arbeitet.", meta: "BLE · Serial" },
        { name: "ESP Geräte-Manager", desc: "Status prüfen, fernsteuern, OTA-Updates durchführen.", meta: "OTA · Remote" },
        { name: "STM32 Web-Flasher", desc: "Direkt im Browser flashen, ohne Software, mit Auto-Reset.", meta: "UART · ISP" },
        { name: "Web Serial-Plotter", desc: "Serial-Daten als Kurven, mehrere Kanäle gleichzeitig.", meta: "Canvas · CSV" },
        { name: "I²C Web-Debugbank", desc: "ESP32-Bus-Pirate im Browser verbinden, Bus scannen, Register lesen.", meta: "LWPKT · BLE" },
        { name: "Messgeräte-Panel", desc: "Messgerät per BLE verbinden, VBUS/VSHUNT/IBUS/PBUS live.", meta: "BLE NUS" },
        { name: "Web USB-Test", desc: "USB-Geräte im Browser prüfen: Enumeration und Transfer.", meta: "USB 2.0" },
        { name: "WS8623 BLE-Test", desc: "BLE-Modul debuggen: scannen, koppeln, transparent senden.", meta: "FFF0 · NUS" },
        { name: "ESP Web-Flasher", desc: "ESP-Firmware im Browser flashen, Manifest-Installation.", meta: "Manifest" },
        { name: "ESP32 Partitions-Builder", desc: "Partitionen visuell anpassen, CSV exportieren.", meta: "CSV Export" }
      ]
    },
    about: {
      tag: "The Workshop",
      title: "Warum das<br>alles überhaupt?",
      p1: "Ehrlich gesagt: Ich will, dass der Alltag bequemer wird. Das Heizkissen wärmt im Winter, Serial-Werkzeuge erleichtern das Debuggen, der Flasher läuft ohne Software. Alles kleine Dinge aus echten Notwendigkeiten.",
      p2: "Was fertig ist, kann auch geteilt werden — vielleicht hilft es jemandem. Wer ebenfalls gern bastelt, darf sich melden.",
      pillars: [
        { name: "Nützlich", desc: "Zuerst das eigene Problem lösen" },
        { name: "Zurückhaltung", desc: "Eine Abhängigkeit weniger ist ein Gewinn" },
        { name: "Beständig", desc: "Dokumentiert, damit es nächstes Jahr noch geht" }
      ]
    },
    docs: {
      tag: "Documentation",
      title: "Dokumentation",
      subtitle: "Vielleicht nicht schön, aber ausreichend.",
      items: [
        { name: "Schnellstart", desc: "Umgebung einrichten und Projekt starten, in Minuten.", tags: ["Einstieg", "Setup"] },
        { name: "Werkzeug-Handbuch", desc: "Wie jedes Werkzeug benutzt wird, Schritt für Schritt.", tags: ["Handbuch", "FAQ"] },
        { name: "Hardware-Protokolle", desc: "Serial, BLE und USB Browser-APIs richtig nutzen.", tags: ["Serial", "BLE", "USB"] },
        { name: "Architektur", desc: "Wie das Projekt aufgebaut ist, hier ansetzen für Neues.", tags: ["Arch", "Beitragen"] },
        { name: "Datenfluss & MQTT", desc: "Wie Gerätedaten gemeldet, gespeichert und klassifiziert werden.", tags: ["MQTT", "InfluxDB"] },
        { name: "Deployment", desc: "Lokal starten und online ausliefern, inklusive Befehle.", tags: ["Deploy", "DevOps"] }
      ]
    },
    skills: {
      tag: "Skills",
      title: "AI-Skills",
      subtitle: "Für Coding-Agenten, damit sie nicht raten müssen.",
      items: [
        { name: "Stoov-Testkonsole", desc: "Produktionsteststand, Serial-Zustandsmaschine + MQTT" },
        { name: "Stoov-Korrekturpanel", desc: "Temperaturkalibrierung, BLE/Serial, Cache-Verwaltung" },
        { name: "Messgeräte-BLE-Panel", desc: "Lit-Komponenten + Web Bluetooth NUS Rendering" },
        { name: "STM32 Web-Flashen", desc: "Bootloader-Befehle, HEX-Parsing, ISP-Ablauf" },
        { name: "Web Serial-Plotter", desc: "RingStore + Canvas Echtzeitkurven + Export" },
        { name: "I²C Web-Debug", desc: "LWPKT-Frameprotokoll + ESP32-Bus-Pirate" },
        { name: "Web USB-Test", desc: "Geräteaufzählung, Endpunkt-Deklaration, Bulk-Transfer" },
        { name: "WS8623 BLE-Demo", desc: "FFF0-Service, 244-Byte-Fragmentierung, Kopplung" },
        { name: "MQTT-Pipeline", desc: "MQTT→InfluxDB Dedup, Feldklassifizierung, Zeitnormierung" },
        { name: "Desktop-Verpackung", desc: "deno compile einzelne exe + Asset-Sync" },
        { name: "Site-Hosting und Build", desc: "Deno + Hono Static Hosting + Build-Kette" },
        { name: "ESP32-Firmware-Caps", desc: "CAPS v2 Pin-Tabelle, Modellunterschiede" }
      ]
    },
    cta: {
      title1: "Nicht viel,",
      title2: "aber alles wird genutzt.",
      desc: "Wer ebenfalls mit IoT, Serial und Bluetooth bastelt, findet hier vielleicht etwas.",
      btn: "Heizkissen ansehen"
    },
    footer: { brand: "Bär Elektronik DIY" },
    theme: { light: "Hell", dark: "Dunkel", label: "Design wechseln" }
  },

  ru: {
    nav: { works: "Работы", tools: "Инструменты", docs: "Документы", skills: "Навыки", about: "О проекте" },
    hero: {
      eyebrow: "Онлайн-мастерская · Коллекция 2026",
      title1: "Делать полезное,",
      title2: "что <em>хочется оставить</em>.",
      desc: "Одиннадцать инструментов, которые работают прямо в браузере: serial, Bluetooth, USB, I²C — и грелка, которая действительно греет. Без установки и регистрации.",
      btn1: "Попробовать",
      btn2: "Все работы",
      hint: "Только Chromium · Нужен защищённый контекст"
    },
    stats: [
      { value: "11+", label: "Онлайн-инструментов" },
      { value: "6", label: "Протоколов" },
      { value: "7", label: "Языков интерфейса" },
      { value: "0", label: "Шагов установки" }
    ],
    featured: {
      tag: "Selected Works",
      title: "Избранные работы",
      sub: "Четыре самых нужных — каждое проверено в реальной работе.",
      viewAll: "Смотреть все"
    },
    badges: { new: "Новое", core: "Основное", pick: "Частое" },
    pieces: { open: "Открыть" },
    tools: {
      tag: "The Collection",
      title: "Все инструменты",
      subtitle: "Сделаны по ходу работы, готовы к использованию.",
      items: [
        { name: "Тест грелки Stoov", desc: "Подключите serial и проверяйте: пульт, нагрев, отчёты.", meta: "Serial · MQTT" },
        { name: "Панель управления Stoov", desc: "Регулировка температуры и калибровка, чтобы понять устройство.", meta: "BLE · Serial" },
        { name: "Управление ESP", desc: "Статус устройства, удалённое управление, OTA-обновления.", meta: "OTA · Remote" },
        { name: "STM32 Web-прошивальщик", desc: "Прошивка прямо в браузере, без ПО, с автосбросом.", meta: "UART · ISP" },
        { name: "Web Serial-график", desc: "Serial-данные в кривые, несколько каналов одновременно.", meta: "Canvas · CSV" },
        { name: "I²C Web-отладка", desc: "ESP32-Bus-Pirate в браузере: скан шины, чтение регистров.", meta: "LWPKT · BLE" },
        { name: "Панель прибора", desc: "Прибор по BLE, VBUS/VSHUNT/IBUS/PBUS в реальном времени.", meta: "BLE NUS" },
        { name: "Web USB-тест", desc: "Проверка USB-устройств в браузере: перечисление и передачи.", meta: "USB 2.0" },
        { name: "WS8623 BLE-тест", desc: "Отладка BLE-модуля: скан, спаривание, прозрачная передача.", meta: "FFF0 · NUS" },
        { name: "ESP Web-прошивка", desc: "Прошивка ESP в браузере, установка через Manifest.", meta: "Manifest" },
        { name: "Конструктор разделов ESP32", desc: "Визуальная настройка разделов и экспорт CSV.", meta: "CSV Export" }
      ]
    },
    about: {
      tag: "The Workshop",
      title: "Зачем всё<br>это нужно?",
      p1: "Честно говоря, хочется сделать быт удобнее. Грелка греет зимой, serial-инструменты упрощают отладку, прошивальщик работает без установки ПО. Всё это выросло из реальных задач.",
      p2: "Готовое можно и показать: возможно, кому-то пригодится. Если вам тоже нравится возиться с железом — давайте общаться.",
      pillars: [
        { name: "Польза", desc: "Сначала решить свою задачу" },
        { name: "Сдержанность", desc: "Меньше зависимостей — лучше" },
        { name: "Долговечность", desc: "Задокументировано, значит починим и через год" }
      ]
    },
    docs: {
      tag: "Documentation",
      title: "Документация",
      subtitle: "Может, не красиво, зато применимо.",
      items: [
        { name: "Быстрый старт", desc: "Настройка окружения и запуск проекта за минуты.", tags: ["Старт", "Настройка"] },
        { name: "Руководство по инструментам", desc: "Как пользоваться каждым инструментом, по шагам.", tags: ["Мануал", "FAQ"] },
        { name: "Протоколы оборудования", desc: "Как применять браузерные API Serial, BLE и USB.", tags: ["Serial", "BLE", "USB"] },
        { name: "Архитектура", desc: "Как устроен проект и куда добавлять новое.", tags: ["Арх", "Вклад"] },
        { name: "Поток данных и MQTT", desc: "Как данные устройств отправляются, хранятся и классифицируются.", tags: ["MQTT", "InfluxDB"] },
        { name: "Развёртывание", desc: "Локальный запуск и публикация, с командами.", tags: ["Деплой", "DevOps"] }
      ]
    },
    skills: {
      tag: "Skills",
      title: "AI-навыки",
      subtitle: "Для кодовых агентов, чтобы не гадали.",
      items: [
        { name: "Тестовая консоль Stoov", desc: "Стенд, машина состояний serial + отчёты MQTT" },
        { name: "Панель коррекции Stoov", desc: "Калибровка температуры, BLE/Serial, кэш" },
        { name: "BLE-панель прибора", desc: "Компоненты Lit + отрисовка через Web Bluetooth NUS" },
        { name: "STM32 Web-прошивка", desc: "Команды загрузчика, разбор HEX, процедура ISP" },
        { name: "Web Serial-график", desc: "RingStore + Canvas, кривые в реальном времени, экспорт" },
        { name: "I²C Web-отладка", desc: "Протокол кадров LWPKT + работа с ESP32-Bus-Pirate" },
        { name: "Web USB-тест", desc: "Перечисление устройств, объявление эндпоинтов, bulk-передача" },
        { name: "WS8623 BLE-демо", desc: "Сервис FFF0, фрагментация по 244 байта, спаривание" },
        { name: "Конвейер MQTT", desc: "MQTT→InfluxDB: дедупликация, классификация, нормализация времени" },
        { name: "Десктопная упаковка", desc: "deno compile один exe + синхронизация статики" },
        { name: "Хостинг и сборка", desc: "Deno + Hono статика + общий скрипт сборки" },
        { name: "Возможности ESP32", desc: "Таблица пинов CAPS v2, различия моделей" }
      ]
    },
    cta: {
      title1: "Немного,",
      title2: "зато всё в дело.",
      desc: "Если вы тоже возитесь с IoT, serial и Bluetooth — возможно, пригодится.",
      btn: "Посмотреть грелку"
    },
    footer: { brand: "Медведь Электроника DIY" },
    theme: { light: "Светлая", dark: "Тёмная", label: "Сменить тему" }
  }
};

// 语言列表（原生名称 + 代码，不用旗帜 emoji：Windows 下旗帜无法渲染）
const languages = [
  { code: "zh", name: "中文", label: "ZH" },
  { code: "en", name: "English", label: "EN" },
  { code: "zh-TW", name: "繁體中文", label: "ZH-TW" },
  { code: "ja", name: "日本語", label: "JA" },
  { code: "ko", name: "한국어", label: "KO" },
  { code: "de", name: "Deutsch", label: "DE" },
  { code: "ru", name: "Русский", label: "RU" }
];

const DEFAULT_LANG = "zh";

function getLang() {
  const saved = localStorage.getItem("lang");
  return saved && translations[saved] ? saved : DEFAULT_LANG;
}

function setLang(lang) {
  if (!translations[lang]) return;
  localStorage.setItem("lang", lang);
  applyTranslations();
}

// 按 "tools.items.3.name" 取嵌套值
function resolvePath(source, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

// 应用翻译
function applyTranslations() {
  const lang = getLang();
  const t = translations[lang];
  if (!t) return;

  document.documentElement.lang = lang;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const value = resolvePath(t, el.dataset.i18n);
    if (typeof value !== "string") return;
    if (value.indexOf("<") !== -1) {
      el.innerHTML = value;
    } else {
      el.textContent = value;
    }
  });

  // 主题按钮文案跟随语言（图标由 theme.js 负责）
  const theme = document.documentElement.getAttribute("data-theme") || "dark";
  const themeLabel = theme === "dark" ? t.theme.light : t.theme.dark;
  const themeButton = document.getElementById("theme-toggle");
  if (themeButton) themeButton.setAttribute("aria-label", t.theme.label);
  const themeText = document.querySelector("#theme-toggle .toggle-text");
  if (themeText) themeText.textContent = themeLabel;

  updateLangSelector(lang);
}

// 构建下拉（只建一次，避免重建打断焦点）
function buildLangSelector() {
  const host = document.getElementById("lang-selector");
  if (!host || host.dataset.ready === "true") return;
  host.dataset.ready = "true";

  host.innerHTML = [
    '<button id="lang-toggle" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="lang-menu">',
    '<svg class="ic" aria-hidden="true"><use href="#i-globe"></use></svg>',
    '<span id="lang-current">' + languages[0].name + "</span>",
    '<svg class="ic chev" aria-hidden="true"><use href="#i-chevron"></use></svg>',
    "</button>",
    '<ul id="lang-menu" role="listbox" aria-label="Language" hidden>',
    languages
      .map(
        (l) =>
          '<li class="lang-option" role="option" tabindex="-1" data-lang="' +
          l.code +
          '" aria-selected="false"><span>' +
          l.name +
          '</span><span class="code">' +
          l.label +
          "</span></li>"
      )
      .join(""),
    "</ul>"
  ].join("");

  const toggle = host.querySelector("#lang-toggle");
  const menu = host.querySelector("#lang-menu");
  const options = Array.from(menu.querySelectorAll(".lang-option"));

  const open = () => {
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    const current = options.find((o) => o.getAttribute("aria-selected") === "true") || options[0];
    current.focus();
  };

  const close = (restoreFocus) => {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) toggle.focus();
  };

  toggle.addEventListener("click", () => (menu.hidden ? open() : close(false)));
  toggle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });

  options.forEach((option, index) => {
    option.addEventListener("click", () => {
      setLang(option.dataset.lang);
      close(true);
    });
    option.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setLang(option.dataset.lang);
        close(true);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        options[(index + 1) % options.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        options[(index - 1 + options.length) % options.length].focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        options[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        options[options.length - 1].focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      } else if (e.key === "Tab") {
        close(false);
      }
    });
  });

  document.addEventListener("click", (e) => {
    if (!menu.hidden && !host.contains(e.target)) close(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) close(true);
  });
}

// 同步下拉当前项（不重建 DOM）
function updateLangSelector(currentLang) {
  const host = document.getElementById("lang-selector");
  if (!host) return;
  const current = languages.find((l) => l.code === currentLang) || languages[0];
  const nameEl = host.querySelector("#lang-current");
  if (nameEl) nameEl.textContent = current.name;

  host.querySelectorAll(".lang-option").forEach((option) => {
    const selected = option.dataset.lang === currentLang;
    option.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  buildLangSelector();
  applyTranslations();
});

window.i18n = { getLang, setLang, apply: applyTranslations, languages, translations };
