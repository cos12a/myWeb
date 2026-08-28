let deferredPrompt = null;
const installBtn = document.getElementById("pwaInstallBtn");
const statusBadge = document.getElementById("pwaStatusBadge");

// 检测是否已安装 (standalone 模式)
function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone ||
    document.referrer.includes("android-app://")
  );
}

// 检测是否是 HTTP(S) 协议
function isHttpProtocol() {
  const proto = window.location.protocol;
  return proto === "http:" || proto === "https:";
}

// 更新 PWA 状态指示
function updatePwaStatus() {
  if (isStandalone()) {
    statusBadge.textContent = "✓ 已安装";
    statusBadge.className = "pwa-status-badge installed";
    if (installBtn) installBtn.classList.remove("show");
  } else if (!isHttpProtocol()) {
    statusBadge.textContent = "⚠ 需 HTTP 服务器";
    statusBadge.className = "pwa-status-badge need-http";
  } else if (deferredPrompt) {
    statusBadge.textContent = "可安装";
    statusBadge.className = "pwa-status-badge ready";
  } else {
    statusBadge.textContent = "PWA 就绪";
    statusBadge.className = "pwa-status-badge ready";
  }
}

// 监听 beforeinstallprompt
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.classList.add("show");
  updatePwaStatus();
  console.log("[PWA] beforeinstallprompt 已触发，可安装");
});

// 安装按钮点击
if (installBtn) {
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) {
      alert(
        "当前环境不支持安装。\n请通过 HTTP 服务器打开此页面（如 http://localhost）。\n\n启动方式：\n  npx serve .\n  或 python -m http.server 8080",
      );
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log("[PWA] 用户选择:", outcome);
    deferredPrompt = null;
    installBtn.classList.remove("show");
    updatePwaStatus();
  });
}

// 监听安装完成
window.addEventListener("appinstalled", () => {
  console.log("[PWA] 应用已安装");
  deferredPrompt = null;
  if (installBtn) installBtn.classList.remove("show");
  updatePwaStatus();
});

// 注册 Service Worker (仅 HTTP(S) 协议)
if ("serviceWorker" in navigator && isHttpProtocol()) {
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      console.log("[PWA] Service Worker 注册成功:", reg.scope);
      updatePwaStatus();
    })
    .catch((err) => {
      console.warn("[PWA] Service Worker 注册失败:", err);
    });
} else if ("serviceWorker" in navigator && !isHttpProtocol()) {
  console.warn(
    "[PWA] file:// 协议不支持 Service Worker，请使用 HTTP 服务器打开",
  );
}

// 初始状态
updatePwaStatus();
