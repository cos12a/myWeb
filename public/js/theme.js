/**
 * 主题模块 - 暗色/亮色切换
 * 默认暗色模式
 */

const Theme = {
  // 获取当前主题
  get() {
    return localStorage.getItem("theme") || "dark";
  },

  // 设置主题
  set(theme) {
    if (theme !== "dark" && theme !== "light") return;
    localStorage.setItem("theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
    this.updateToggle(theme);
  },

  // 切换主题
  toggle() {
    const current = this.get();
    this.set(current === "dark" ? "light" : "dark");
  },

  // 更新切换按钮状态（图标用 SVG 精灵，文案交给 i18n）
  updateToggle(theme) {
    const toggle = document.getElementById("theme-toggle");
    if (!toggle) return;

    const iconId = theme === "dark" ? "i-sun" : "i-moon";
    toggle.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#${iconId}"></use></svg><span class="toggle-text"></span>`;

    if (window.i18n && typeof window.i18n.apply === "function") {
      window.i18n.apply();
      return;
    }
    const text = toggle.querySelector(".toggle-text");
    if (text) text.textContent = theme === "dark" ? "亮色" : "暗色";
  },

  // 初始化
  init() {
    const theme = this.get();
    document.documentElement.setAttribute("data-theme", theme);
    this.updateToggle(theme);

    // 绑定切换事件
    const toggle = document.getElementById("theme-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => this.toggle());
    }
  }
};

// 初始化
document.addEventListener("DOMContentLoaded", () => Theme.init());

// 导出
window.Theme = Theme;
