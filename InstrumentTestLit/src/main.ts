/** 应用入口：注册 <instrument-panel> 自定义元素。最终产物是标准 Web Components，框架无关。 */
import { APP_VERSION } from "./core/version.js";
console.log(`[InstrumentTestLit] v${APP_VERSION}`);
import "./components/instrument-panel.js";