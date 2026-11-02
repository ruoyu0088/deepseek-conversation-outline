/*
 * Prism 配置（必须在 prism-core 之前加载）
 *  - manual 模式：禁止 Prism 自己去扫描并高亮整页，只处理我们要求高亮的代码块，
 *    避免和 DeepSeek 页面自己的代码块/性能打架。
 *  - 语言别名：把围栏里常见的写法映射到 Prism 已注册的语言名。
 */
window.Prism = window.Prism || {};
window.Prism.manual = true;

window.__dsLangAlias = {
  py: "python", python3: "python", python2: "python",
  js: "javascript", node: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", jsx: "jsx", tsx: "tsx",
  sh: "bash", shell: "bash", zsh: "bash", console: "bash", terminal: "bash",
  yml: "yaml", html: "markup", htm: "markup", xml: "markup", svg: "markup",
  jsonc: "json", json5: "json",
  ps1: "powershell", pwsh: "powershell",
  rb: "ruby", cs: "csharp", "c++": "cpp", cplusplus: "cpp",
  golang: "go", kt: "kotlin", rs: "rust",
  scss: "css", less: "css"
};

/** 不认识的/纯文本语言 → 不做高亮 */
window.__dsSkipLangs = { text: 1, plaintext: 1, plain: 1, txt: 1, none: 1, output: 1, log: 1, csv: 1 };
