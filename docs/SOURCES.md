# 官方接口核查 · 2026-10-13

- DeepSeek： https://api-docs.deepseek.com/api/create-chat-completion/ ， https://api-docs.deepseek.com/quick_start/pricing/ ， https://api-docs.deepseek.com/guides/thinking_mode/ 。当前型号清单采用 deepseek-flash / deepseek-v4-pro，Chat JSON 模式，关闭 thinking。价格存在时段差异，网站默认未知，用户可自行填写保守单价。
- 智谱： https://docs.bigmodel.cn/api-reference/模型-api/对话补全 。核实 Bearer 认证、官方端点、GLM 型号及 thinking 参数。未核实完整数据保留政策，界面不能宣称零保留。
- Gemini： https://ai.google.dev/api ， https://ai.google.dev/gemini-api/docs/models ， https://ai.google.dev/gemini-api/terms 。原生 generateContent，x-goog-api-key 请求头。官方型号清单包含 3.8 Flash、3.5 Flash-Lite，以及有账户限制的 2.5 Flash。
- OpenAI： https://developers.openai.com/api/reference/resources/responses/methods/create ， https://developers.openai.com/api/docs/models/gpt-4.1-mini ， https://developers.openai.com/api/docs/models/gpt-5-mini ， https://developers.openai.com/api/docs/guides/your-data 。Responses，store=false，不开启工具。JSON 输出在实际组合中仍需连接测试。
- PDF.js： https://mozilla.github.io/pdf.js/ 。采用修补后的 6.4.299 legacy 构建兼容旧浏览器；6.x 改动含 loadingTask 生命周期与新版浏览器特性。
- Noto Sans SC 字体：https://github.com/google/fonts/tree/main/ofl/notosanssc ，SIL OFL 1.1 随字体一起发布。字体仅在 PDF 导出时加载。

以上为官方文档核查，不是账号 / 浏览器 CORS 验证。没有真实 Key；四家默认待验证。Key 不写 URL、日志、持久存储或备份。供应商使用条款和地区可用性应在真实使用前核查。
